import { getDatabase } from "@netlify/database";
import { ensurePushSchema } from "./lib/push-send.mjs";

let schemaReady = null;

async function ensureSchema(pool) {
  if (!schemaReady) schemaReady = ensurePushSchema(pool);
  await schemaReady;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export default async (req) => {
  const { pool } = getDatabase();
  await ensureSchema(pool);

  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean); // ["api", "push", action]
  const action = segments[2];

  try {
    if (req.method === "GET" && action === "public-key") {
      return json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
    }

    if (req.method === "POST" && action === "subscribe") {
      const body = await req.json().catch(() => ({}));
      const groupId = typeof body.groupId === "string" ? body.groupId : "";
      const memberId = typeof body.memberId === "string" && body.memberId ? body.memberId : null;
      const sub = body.subscription;
      if (!groupId || !sub || typeof sub.endpoint !== "string" || !sub.keys?.p256dh || !sub.keys?.auth) {
        return json({ error: "bad_request" }, 400);
      }
      await pool.query(
        `INSERT INTO push_subscriptions (group_id, member_id, endpoint, p256dh, auth)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (endpoint) DO UPDATE SET group_id = $1, member_id = $2, p256dh = $4, auth = $5`,
        [groupId, memberId, sub.endpoint, sub.keys.p256dh, sub.keys.auth]
      );
      return json({ ok: true }, 201);
    }

    if (req.method === "POST" && action === "unsubscribe") {
      const body = await req.json().catch(() => ({}));
      const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
      if (!endpoint) return json({ error: "bad_request" }, 400);
      await pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]);
      return json({ ok: true });
    }

    return json({ error: "not_found" }, 404);
  } catch (err) {
    console.error("push function error", err);
    return json({ error: "server_error" }, 500);
  }
};

export const config = {
  path: ["/api/push/public-key", "/api/push/subscribe", "/api/push/unsubscribe"],
};
