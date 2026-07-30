import { getDatabase } from "@netlify/database";

let schemaReady = null;

async function ensureSchema(pool) {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS feedback (
        id SERIAL PRIMARY KEY,
        message TEXT NOT NULL,
        group_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }
  await schemaReady;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// GET is gated by a password checked against the FEEDBACK_ADMIN_PASSWORD
// env var (set in the Netlify site's environment settings) — there's no
// login/admin auth system in this app, so this is the one lightweight gate
// standing between "/admin/feedback" and the raw submissions table. If the
// env var isn't set, GET is refused entirely (fail closed) rather than
// falling open to an unauthenticated read.
export default async (req) => {
  const { pool } = getDatabase();
  await ensureSchema(pool);

  if (req.method === "GET") {
    const adminPassword = process.env.FEEDBACK_ADMIN_PASSWORD;
    const url = new URL(req.url);
    const supplied = url.searchParams.get("password") || "";
    if (!adminPassword || supplied !== adminPassword) {
      return json({ error: "unauthorized" }, 401);
    }
    try {
      const { rows } = await pool.query(
        "SELECT id, message, group_id, created_at FROM feedback ORDER BY created_at DESC"
      );
      return json({ feedback: rows });
    } catch (err) {
      console.error("feedback function error", err);
      return json({ error: "server_error" }, 500);
    }
  }

  if (req.method !== "POST") return json({ error: "not_found" }, 404);

  try {
    const body = await req.json().catch(() => ({}));
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return json({ error: "empty_message" }, 400);
    const groupId = typeof body.groupId === "string" && body.groupId ? body.groupId : null;

    await pool.query("INSERT INTO feedback (message, group_id) VALUES ($1, $2)", [message, groupId]);
    return json({ ok: true }, 201);
  } catch (err) {
    console.error("feedback function error", err);
    return json({ error: "server_error" }, 500);
  }
};

export const config = {
  path: "/api/feedback",
};
