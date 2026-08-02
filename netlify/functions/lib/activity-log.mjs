export async function ensureActivityLogSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id SERIAL PRIMARY KEY,
      group_id TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS activity_log_group_id_idx ON activity_log (group_id, created_at DESC);
  `);
}

export async function logActivity(pool, groupId, message) {
  await pool.query("INSERT INTO activity_log (group_id, message) VALUES ($1, $2)", [groupId, message]);
}

const MAX_ACTIVITY_ROWS = 50;

export async function listActivity(pool, groupId) {
  const { rows } = await pool.query(
    "SELECT id, message, created_at FROM activity_log WHERE group_id = $1 ORDER BY created_at DESC LIMIT $2",
    [groupId, MAX_ACTIVITY_ROWS]
  );
  return rows;
}
