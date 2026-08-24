import webpush from "web-push";

let vapidConfigured = false;

function ensureVapid() {
  if (vapidConfigured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", publicKey, privateKey);
  vapidConfigured = true;
}

// Silently does nothing if VAPID keys aren't configured, so push stays
// optional infrastructure rather than something that can break posting a
// task if it's unset in a given environment.
export async function sendPushToGroup(pool, groupId, payload) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  ensureVapid();

  const { rows } = await pool.query(
    "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE group_id = $1",
    [groupId]
  );
  if (rows.length === 0) return;

  const body = JSON.stringify(payload);
  await Promise.all(
    rows.map(async (row) => {
      const subscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
      try {
        await webpush.sendNotification(subscription, body);
      } catch (err) {
        // 404/410 = the browser/OS dropped this subscription (uninstalled,
        // permission revoked, etc.) — stop trying to send to it.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [row.endpoint]).catch(() => {});
        } else {
          console.error("push send error", err.statusCode, err.body);
        }
      }
    })
  );
}

export async function ensurePushSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      group_id TEXT NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS push_subscriptions_group_id_idx ON push_subscriptions (group_id);
    -- Which member (if any) this device's subscription belongs to, so a
    -- member removal (see groups.mjs's updateGroupSettings) can delete
    -- exactly that member's subscriptions instead of leaving them to keep
    -- notifying a device that can no longer open the group. Nullable: a
    -- subscription made before this column existed, or by a device that
    -- never claimed an identity, just won't be attributable to anyone.
    ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS member_id TEXT;
  `);
}
