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

async function updateGroup(pool, id, body) {
  const existing = await getGroup(pool, id);
  if (!existing) return null;

  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : existing.name;
  const accent = typeof body.accent === "string" ? body.accent : existing.accent;
  const accentBg = typeof body.accentBg === "string" ? body.accentBg : existing.accentBg;
  const members = Array.isArray(body.members) ? body.members : existing.members;
  const tasks = Array.isArray(body.tasks) ? body.tasks : existing.tasks;
  const events = Array.isArray(body.events) ? body.events : existing.events;

  const { rows } = await pool.query(
    `UPDATE groups
     SET name = $2, accent = $3, accent_bg = $4, members = $5::jsonb, tasks = $6::jsonb, events = $7::jsonb, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, name, accent, accentBg, JSON.stringify(members), JSON.stringify(tasks), JSON.stringify(events)]
  );
  return rowToGroup(rows[0]);
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
      const group = await updateGroup(pool, id, body);
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
    console.error("groups function error", err);
    return json({ error: "server_error" }, 500);
  }
};

export const config = {
  path: ["/api/groups", "/api/groups/:id"],
};
