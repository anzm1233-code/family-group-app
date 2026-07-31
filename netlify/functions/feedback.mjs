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
      );
      CREATE TABLE IF NOT EXISTS feedback_comments (
        id SERIAL PRIMARY KEY,
        feedback_id INTEGER NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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

const PAGE_SIZE = 10;

// Feedback is visible to anyone using the app (no login exists to gate it
// with), same trust model as everything else here — anyone can read the
// list and comment on any entry.
export default async (req) => {
  const { pool } = getDatabase();
  await ensureSchema(pool);

  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean); // ["api", "feedback", id?, "comments"?]
  const commentsFeedbackId = segments[3] === "comments" ? segments[2] : null;

  try {
    if (req.method === "POST" && commentsFeedbackId) {
      const body = await req.json().catch(() => ({}));
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message) return json({ error: "empty_message" }, 400);

      const { rows } = await pool.query(
        "INSERT INTO feedback_comments (feedback_id, message) VALUES ($1, $2) RETURNING id, message, created_at",
        [commentsFeedbackId, message]
      );
      return json({ comment: rows[0] }, 201);
    }

    if (req.method === "GET" && !commentsFeedbackId) {
      const page = Math.max(1, parseInt(url.searchParams.get("page"), 10) || 1);
      const offset = (page - 1) * PAGE_SIZE;

      const { rows: countRows } = await pool.query("SELECT COUNT(*)::int AS count FROM feedback");
      const total = countRows[0].count;

      const { rows: items } = await pool.query(
        "SELECT id, message, created_at FROM feedback ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        [PAGE_SIZE, offset]
      );

      const ids = items.map((i) => i.id);
      const commentsByFeedback = {};
      if (ids.length > 0) {
        const { rows: comments } = await pool.query(
          "SELECT id, feedback_id, message, created_at FROM feedback_comments WHERE feedback_id = ANY($1::int[]) ORDER BY created_at ASC",
          [ids]
        );
        for (const c of comments) {
          (commentsByFeedback[c.feedback_id] ??= []).push(c);
        }
      }

      const withComments = items.map((i) => ({ ...i, comments: commentsByFeedback[i.id] || [] }));
      return json({ items: withComments, total, page, pageSize: PAGE_SIZE });
    }

    if (req.method === "POST" && !commentsFeedbackId) {
      const body = await req.json().catch(() => ({}));
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message) return json({ error: "empty_message" }, 400);
      const groupId = typeof body.groupId === "string" && body.groupId ? body.groupId : null;

      await pool.query("INSERT INTO feedback (message, group_id) VALUES ($1, $2)", [message, groupId]);
      return json({ ok: true }, 201);
    }

    return json({ error: "not_found" }, 404);
  } catch (err) {
    console.error("feedback function error", err);
    return json({ error: "server_error" }, 500);
  }
};

export const config = {
  path: ["/api/feedback", "/api/feedback/:id/comments"],
};
