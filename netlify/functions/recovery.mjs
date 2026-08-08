import { getDatabase } from "@netlify/database";

let schemaReady = null;

function db() {
  return getDatabase();
}

async function ensureSchema(pool) {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS recovery_tokens (
        token TEXT PRIMARY KEY,
        group_ids JSONB NOT NULL DEFAULT '[]',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }
  await schemaReady;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

// A generous but bounded cap — this is one browser's own bookmark list, not
// anything meant to hold many groups, so this just guards against a
// malformed/abusive client writing an unbounded array.
const MAX_GROUP_IDS = 200;

// No login here either: `token` is just an opaque, unguessable id a browser
// makes for itself (see RECOVERY_KEY client-side) and carries in its own
// URL, so a *different* storage context that later sees the same URL (an
// iOS "Add to Home Screen" install is the main case — it starts with empty
// storage, separate from the Safari tab the link was opened in) can ask
// "what group ids did this token last have?" and rehydrate its bookmark
// list. It's exactly as trusted as a group id itself: anyone holding it can
// read/write the group ids it lists, same trust level as everything else in
// this app.
export default async (req) => {
  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean); // ["api", "recovery", ":token"]
  const token = segments[2];
  if (!token || token.length > 100) return json({ error: "bad_request" }, 400);

  const { pool } = db();
  await ensureSchema(pool);

  try {
    if (req.method === "GET") {
      const { rows } = await pool.query("SELECT group_ids FROM recovery_tokens WHERE token = $1", [token]);
      return json({ groupIds: rows[0]?.group_ids || [] });
    }

    if (req.method === "PUT") {
      const body = await req.json().catch(() => ({}));
      const groupIds = Array.isArray(body.groupIds)
        ? body.groupIds.filter((id) => typeof id === "string").slice(0, MAX_GROUP_IDS)
        : [];
      await pool.query(
        `INSERT INTO recovery_tokens (token, group_ids, updated_at) VALUES ($1, $2::jsonb, now())
         ON CONFLICT (token) DO UPDATE SET group_ids = $2::jsonb, updated_at = now()`,
        [token, JSON.stringify(groupIds)]
      );
      return json({ ok: true });
    }

    return json({ error: "not_found" }, 404);
  } catch (err) {
    console.error("recovery function error", err);
    return json({ error: "server_error" }, 500);
  }
};

export const config = {
  path: ["/api/recovery/:token"],
};
