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

// Intentionally no GET here — this is a separate table from `groups` and has
// no read endpoint at all, since there's no login/admin auth in this app to
// gate it with. Submissions are meant to be checked via direct DB access
// (e.g. `netlify db` / psql), not through the deployed site.
export default async (req) => {
  if (req.method !== "POST") return json({ error: "not_found" }, 404);

  const { pool } = getDatabase();
  await ensureSchema(pool);

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
