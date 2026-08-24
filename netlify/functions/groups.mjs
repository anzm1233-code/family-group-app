import { randomBytes } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { ensurePushSchema, sendPushToGroup } from "./lib/push-send.mjs";
import { ensureActivityLogSchema, logActivity, listActivity } from "./lib/activity-log.mjs";

let schemaReady = null;

function db() {
  return getDatabase();
}

async function ensureSchema(pool) {
  if (!schemaReady) {
    schemaReady = pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        accent TEXT NOT NULL,
        accent_bg TEXT NOT NULL,
        members JSONB NOT NULL DEFAULT '[]',
        tasks JSONB NOT NULL DEFAULT '[]',
        events JSONB NOT NULL DEFAULT '[]',
        owner_member_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE groups ADD COLUMN IF NOT EXISTS owner_member_id TEXT;
    `
      )
      .then(() => ensurePushSchema(pool))
      .then(() => ensureActivityLogSchema(pool));
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
    ownerMemberId: row.owner_member_id,
  };
}

// no-store: this is live, shared, frequently-polled data — any intermediary
// (mobile carrier caching proxies especially, which are common on Korean
// cellular networks) serving a cached copy would silently show stale group
// state on that device while everyone else sees the current data.
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function createGroup(pool, body) {
  const kind = typeof body.kind === "string" && body.kind ? body.kind : "custom";
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "새 그룹";
  const accent = typeof body.accent === "string" ? body.accent : "#993556";
  const accentBg = typeof body.accentBg === "string" ? body.accentBg : "#FBEAF0";
  const members = Array.isArray(body.members) ? body.members : [];
  const ownerMemberId = typeof body.ownerMemberId === "string" && body.ownerMemberId ? body.ownerMemberId : null;

  for (let attempt = 0; attempt < 5; attempt++) {
    const id = generateId();
    try {
      const { rows } = await pool.query(
        `INSERT INTO groups (id, kind, name, accent, accent_bg, members, tasks, events, owner_member_id)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, '[]'::jsonb, '[]'::jsonb, $7)
         RETURNING *`,
        [id, kind, name, accent, accentBg, JSON.stringify(members), ownerMemberId]
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

// push_subscriptions and activity_log both key off group_id with no foreign
// key (this schema has never used them), so a group delete has to clean
// those up itself — otherwise they'd sit there forever as orphaned rows,
// permanently inflating things like the admin stats' "알림 켠 기기 수" for a
// group nobody can ever push to again.
async function deleteGroup(pool, id) {
  const { rowCount } = await pool.query("DELETE FROM groups WHERE id = $1", [id]);
  if (rowCount > 0) {
    await Promise.all([
      pool.query("DELETE FROM push_subscriptions WHERE group_id = $1", [id]),
      pool.query("DELETE FROM activity_log WHERE group_id = $1", [id]),
    ]);
  }
  return rowCount > 0;
}

class BadOpError extends Error {}

// A member's `tokens` array (see claimIdentity below) is this app's only
// notion of "is this device really that member" — checked against whatever
// memberId/token the caller presents. A member being removed from `members`
// takes their whole tokens array with them, which is what makes removal an
// actual, immediate access revocation instead of just deleting a name tag:
// every device that had claimed that identity starts failing this check on
// its very next request.
function isValidMemberToken(members, memberId, token) {
  if (!memberId || !token) return false;
  const member = (members || []).find((m) => m.id === memberId);
  return !!member && Array.isArray(member.tokens) && member.tokens.includes(token);
}

// Applies one named, targeted operation to a group's members/tasks/events —
// never a whole-document overwrite. The row is locked with SELECT ... FOR
// UPDATE for the duration of the transaction, so every op sees the true
// latest state (including anyone else's concurrent change) and can never
// clobber it with a stale snapshot the way a "send the whole list back"
// PUT would. This is the fix for a real data-loss bug: two people editing
// around the same time used to have whoever saved second silently erase
// whatever the first person had just added, because each save resent their
// own (possibly stale) full copy of tasks/members/events.
//
// `requester` is whatever memberId/token the caller presented (see the
// handler below) — not part of the op payload itself, just who's asking.
// Returns: null (group not found), { forbidden, message } (identity check
// or an owner-only op failed), { memberNotFound } (claimIdentity targeted a
// member that doesn't/no-longer exists), or { group, claimedToken? }.
async function applyGroupOp(pool, id, body, requester) {
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
    let ownerMemberId = existing.owner_member_id;

    // Anyone whose device has previously claimed an identity for this group
    // must keep presenting a token that still resolves to a real member on
    // every write — a device with no claimed identity at all (requester?.memberId
    // absent) is unaffected, same no-login trust model as before this
    // existed. claimIdentity is exempt since establishing a token is
    // exactly what it's for.
    if (body.op !== "claimIdentity" && requester?.memberId) {
      if (!isValidMemberToken(members, requester.memberId, requester.token)) {
        await client.query("ROLLBACK");
        return { forbidden: true, message: "identity revoked" };
      }
    }

    let claimedToken;

    switch (body.op) {
      // First-claim-wins: only takes effect if nobody has claimed ownership
      // of this group yet. Lets a device that already thinks it's the owner
      // (see OWNED_GROUPS_KEY client-side) record which member that
      // corresponds to, so ownership can later be recovered on a different
      // device by picking the same member identity — same trust level as
      // everything else here, not tamper-proof.
      case "claimOwner": {
        if (!body.memberId || typeof body.memberId !== "string") throw new BadOpError("memberId required");
        if (!ownerMemberId) ownerMemberId = body.memberId;
        break;
      }
      // How a device gets a token for a member identity in the first place
      // — clicking a name in "당신은 누구인가요?" (or the "나:" picker) calls
      // this, which is why it's the one op allowed to run without already
      // presenting a valid token. Anyone can still claim any listed member
      // (no password gate on *which* name you pick — same trust level the
      // app has always had for that choice); what's new is that the token
      // this hands back is the thing that can later be revoked.
      case "claimIdentity": {
        if (!body.memberId || typeof body.memberId !== "string") throw new BadOpError("memberId required");
        const target = members.find((m) => m.id === body.memberId);
        if (!target) {
          await client.query("ROLLBACK");
          return { memberNotFound: true };
        }
        claimedToken = randomBytes(24).toString("base64url");
        // Capped so an endlessly-reloading client can't grow this without
        // bound — only the most recent devices to claim this identity stay
        // valid, which is a fine trade-off for what's meant to be a handful
        // of a person's own devices.
        const MAX_TOKENS_PER_MEMBER = 20;
        members = members.map((m) =>
          m.id === body.memberId
            ? { ...m, tokens: [...(m.tokens || []), claimedToken].slice(-MAX_TOKENS_PER_MEMBER) }
            : m
        );
        break;
      }
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
        const addedIds = newMembers.filter((nm) => !members.some((m) => m.id === nm.id)).map((nm) => nm.id);
        // Only restricted once a group actually has an owner on record —
        // an older/ownerless group (never went through the owner-claim
        // flow) keeps the original open behavior rather than becoming
        // impossible for anyone to add members to.
        if (addedIds.length > 0 && ownerMemberId) {
          const requesterIsOwner =
            requester?.memberId === ownerMemberId && isValidMemberToken(members, requester.memberId, requester.token);
          if (!requesterIsOwner) {
            await client.query("ROLLBACK");
            return { forbidden: true, message: "owner only" };
          }
        }
        members = newMembers;
        name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : name;
        tasks = tasks.map((t) => (removedIds.includes(t.assignee) ? { ...t, assignee: null } : t));
        events = events.map((e) => ({ ...e, assignees: e.assignees.filter((a) => !removedIds.includes(a)) }));
        // A removed member's tokens (see claimIdentity) go with them
        // automatically since they're just part of the member object being
        // dropped — but their push subscription is a separate table keyed
        // by member_id, so it needs its own cleanup or a removed member's
        // device would keep getting notified about a group it can no
        // longer open.
        if (removedIds.length > 0) {
          await client.query("DELETE FROM push_subscriptions WHERE group_id = $1 AND member_id = ANY($2::text[])", [
            id,
            removedIds,
          ]);
        }
        break;
      }
      default:
        throw new BadOpError(`unknown op: ${body.op}`);
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE groups
       SET name = $2, members = $3::jsonb, tasks = $4::jsonb, events = $5::jsonb, owner_member_id = $6, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, name, JSON.stringify(members), JSON.stringify(tasks), JSON.stringify(events), ownerMemberId]
    );
    await client.query("COMMIT");
    return { group: rowToGroup(updatedRows[0]), claimedToken };
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
  // Whichever member identity (see claimIdentity) this device has claimed
  // for this group, if any — a device that's never claimed one sends
  // neither and is treated exactly as before this feature existed.
  const requesterMemberId = url.searchParams.get("memberId") || null;
  const requesterToken = url.searchParams.get("token") || null;

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

    if (req.method === "GET" && id && segments[3] === "activity") {
      const group = await getGroup(pool, id);
      if (!group) return json({ error: "not_found" }, 404);
      if (requesterMemberId && !isValidMemberToken(group.members, requesterMemberId, requesterToken)) {
        return json({ error: "forbidden" }, 403);
      }
      const items = await listActivity(pool, id);
      return json({ items });
    }

    if (req.method === "GET" && id) {
      const group = await getGroup(pool, id);
      if (!group) return json({ error: "not_found" }, 404);
      if (requesterMemberId && !isValidMemberToken(group.members, requesterMemberId, requesterToken)) {
        return json({ error: "forbidden" }, 403);
      }
      return json(group);
    }

    if (req.method === "PUT" && id) {
      const body = await req.json().catch(() => ({}));
      const result = await applyGroupOp(pool, id, body, { memberId: requesterMemberId, token: requesterToken });
      if (!result) return json({ error: "not_found" }, 404);
      if (result.forbidden) return json({ error: "forbidden", message: result.message }, 403);
      if (result.memberNotFound) return json({ error: "member_not_found" }, 404);
      const { group, claimedToken } = result;
      if (body.op === "addTask" && !body.task?.private) {
        const actorName = typeof body.actorName === "string" && body.actorName.trim() ? body.actorName.trim() : null;
        const what = body.task?.note ? "메모를" : body.task?.broadcast ? "공지를" : "할일을";
        const title = body.task?.title || "";
        const message = `${actorName ? actorName + "님이 " : ""}${what} 추가했어요${title ? `: ${title}` : ""}`;
        await logActivity(pool, id, message).catch((err) => console.error("activity log failed", err));
        await sendPushToGroup(pool, id, {
          title: group.name,
          body: body.task?.title || "새 일정이 올라왔어요",
          url: `/g/${id}`,
        }).catch((err) => console.error("push send failed", err));
      }
      return json(claimedToken ? { ...group, claimedToken } : group);
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
  path: ["/api/groups", "/api/groups/:id", "/api/groups/:id/activity"],
};
