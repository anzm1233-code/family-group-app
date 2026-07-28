import { randomBytes } from "node:crypto";
import { getDatabase } from "@netlify/database";

let schemaReady = null;

function db() {
  return getDatabase();
}

async function ensureSchema(pool) {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        accent TEXT NOT NULL,
        accent_bg TEXT NOT NULL,
        members JSONB NOT NULL DEFAULT '[]',
        tasks JSONB NOT NULL DEFAULT '[]',
        events JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }
  await schemaReady;
}

function generateId() {
  return randomBytes(6).toString("base64url");
}

function rowToGroup(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    accent: row.accent,
    accentBg: row.accent_bg,
    members: row.members,
    tasks: row.tasks,
    events: row.events,
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function createGroup(pool, body) {
  const kind = typeof body.kind === "string" && body.kind ? body.kind : "custom";
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "새 그룹";
  const accent = typeof body.accent === "string" ? body.accent : "#993556";
  const accentBg = typeof body.accentBg === "string" ? body.accentBg : "#FBEAF0";
  const members = Array.isArray(body.members) ? body.members : [];

  for (let attempt = 0; attempt < 5; attempt++) {
    const id = generateId();
    try {
      const { rows } = await pool.query(
        `INSERT INTO groups (id, kind, name, accent, accent_bg, members, tasks, events)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, '[]'::jsonb, '[]'::jsonb)
         RETURNING *`,
        [id, kind, name, accent, accentBg, JSON.stringify(members)]
      );
      return rowToGroup(rows[0]);
    } catch (err) {
      if (err && err.code === "23505") continue; // id collision, retry
      throw err;
    }
  }
  throw new Error("Failed to allocate a unique group id");
}

async function getGroup(pool, id) {
  const { rows } = await pool.query("SELECT * FROM groups WHERE id = $1", [id]);
  return rows[0] ? rowToGroup(rows[0]) : null;
}

async function listGroupSummaries(pool, ids) {
  if (ids.length === 0) return [];
  const { rows } = await pool.query(
    "SELECT id, kind, name, accent, accent_bg, members FROM groups WHERE id = ANY($1::text[])",
    [ids]
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    accent: row.accent,
    accentBg: row.accent_bg,
    memberCount: Array.isArray(row.members) ? row.members.length : 0,
  }));
}

async function deleteGroup(pool, id) {
  const { rowCount } = await pool.query("DELETE FROM groups WHERE id = $1", [id]);
  return rowCount > 0;
}

class BadOpError extends Error {}

// Applies one named, targeted operation to a group's members/tasks/events —
// never a whole-document overwrite. The row is locked with SELECT ... FOR
// UPDATE for the duration of the transaction, so every op sees the true
// latest state (including anyone else's concurrent change) and can never
// clobber it with a stale snapshot the way a "send the whole list back"
// PUT would. This is the fix for a real data-loss bug: two people editing
// around the same time used to have whoever saved second silently erase
// whatever the first person had just added, because each save resent their
// own (possibly stale) full copy of tasks/members/events.
async function applyGroupOp(pool, id, body) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT * FROM groups WHERE id = $1 FOR UPDATE", [id]);
    const existing = rows[0];
    if (!existing) {
      await client.query("ROLLBACK");
      return null;
    }

    let { name, members, tasks, events } = existing;

    switch (body.op) {
      case "addTask": {
        if (!body.task || typeof body.task !== "object") throw new BadOpError("task required");
        tasks = [...tasks, body.task];
        break;
      }
      case "restoreTask": {
        if (!body.task || typeof body.task !== "object") throw new BadOpError("task required");
        tasks = [...tasks, body.task].sort((a, b) => a.id - b.id);
        break;
      }
      case "deleteTask": {
        tasks = tasks.filter((t) => t.id !== body.taskId);
        break;
      }
      case "toggleTaskDone": {
        tasks = tasks.map((t) => (t.id === body.taskId ? { ...t, done: !!body.done } : t));
        break;
      }
      case "editTask": {
        if (!body.patch || typeof body.patch !== "object") throw new BadOpError("patch required");
        tasks = tasks.map((t) => (t.id === body.taskId ? { ...t, ...body.patch } : t));
        break;
      }
      case "bulkSetTaskDue": {
        const dueById = new Map((Array.isArray(body.updates) ? body.updates : []).map((u) => [u.taskId, u.due]));
        tasks = tasks.map((t) => (dueById.has(t.id) ? { ...t, due: dueById.get(t.id) } : t));
        break;
      }
      case "patchMember": {
        if (!body.patch || typeof body.patch !== "object") throw new BadOpError("patch required");
        members = members.map((m) => (m.id === body.memberId ? { ...m, ...body.patch } : m));
        break;
      }
      case "updateGroupSettings": {
        const newMembers = Array.isArray(body.members) ? body.members : members;
        const removedIds = members.filter((m) => !newMembers.some((nm) => nm.id === m.id)).map((m) => m.id);
        members = newMembers;
        name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : name;
        tasks = tasks.map((t) => (removedIds.includes(t.assignee) ? { ...t, assignee: null } : t));
        events = events.map((e) => ({ ...e, assignees: e.assignees.filter((a) => !removedIds.includes(a)) }));
        break;
      }
      default:
        throw new BadOpError(`unknown op: ${body.op}`);
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE groups
       SET name = $2, members = $3::jsonb, tasks = $4::jsonb, events = $5::jsonb, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, name, JSON.stringify(members), JSON.stringify(tasks), JSON.stringify(events)]
    );
    await client.query("COMMIT");
    return rowToGroup(updatedRows[0]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export default async (req) => {
  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean); // ["api", "groups", ":id"?]
  const id = segments[2];

  const { pool } = db();
  await ensureSchema(pool);

  try {
    if (req.method === "POST" && !id) {
      const body = await req.json().catch(() => ({}));
      const group = await createGroup(pool, body);
      return json(group, 201);
    }

    if (req.method === "GET" && !id) {
      const ids = (url.searchParams.get("ids") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const groups = await listGroupSummaries(pool, ids);
      return json({ groups });
    }

    if (req.method === "GET" && id) {
      const group = await getGroup(pool, id);
      if (!group) return json({ error: "not_found" }, 404);
      return json(group);
    }

    if (req.method === "PUT" && id) {
      const body = await req.json().catch(() => ({}));
      const group = await applyGroupOp(pool, id, body);
      if (!group) return json({ error: "not_found" }, 404);
      return json(group);
    }

    if (req.method === "DELETE" && id) {
      const deleted = await deleteGroup(pool, id);
      if (!deleted) return json({ error: "not_found" }, 404);
      return json({ ok: true });
    }

    return json({ error: "not_found" }, 404);
  } catch (err) {
    if (err instanceof BadOpError) return json({ error: "bad_request", message: err.message }, 400);
    console.error("groups function error", err);
    return json({ error: "server_error" }, 500);
  }
};

export const config = {
  path: ["/api/groups", "/api/groups/:id"],
};
