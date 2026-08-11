import { getDatabase } from "@netlify/database";

// Owner-only usage dashboard, gated by a shared-secret query param (there's
// no login system in this app to hang real auth off of). Visit
// /.netlify/functions/admin-stats?key=<ADMIN_STATS_KEY> to view it.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function formatDate(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, "0")}.${String(dt.getDate()).padStart(2, "0")}`;
}

function page(body) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>톡캘린더 사용 현황</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", Roboto, sans-serif;
    background: #F4F4F5;
    color: #08060D;
    padding: 24px 16px 60px;
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { font-size: 13px; color: #6B7280; margin: 0 0 20px; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 24px; }
  .card {
    background: #fff; border-radius: 14px; padding: 16px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  }
  .card .label { font-size: 13px; color: #6B7280; margin: 0 0 6px; }
  .card .value { font-size: 26px; font-weight: 800; margin: 0; color: #4F7CFF; }
  h2 { font-size: 15px; margin: 0 0 10px; color: #374151; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 14px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  th, td { text-align: left; padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #F0F0F2; }
  th { color: #6B7280; font-weight: 600; background: #FAFAFB; }
  tr:last-child td { border-bottom: none; }
  .muted { color: #9CA3AF; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function unauthorized() {
  return new Response(page(`<h1>접근 불가</h1><p class="sub">key 파라미터가 올바르지 않아요.</p>`), {
    status: 403,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export default async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const expected = process.env.ADMIN_STATS_KEY;
  if (!expected || key !== expected) return unauthorized();

  const { pool } = getDatabase();

  // "실사용 그룹" = a group that's ever actually been used for something
  // (task/notice added — see activity_log, populated from groups.mjs'
  // addTask op), as opposed to one someone created via "새 그룹 만들기" and
  // then abandoned without ever inviting anyone or adding anything. Total
  // group/member counts and the recent-groups list are scoped to these so
  // the dashboard reflects real usage rather than every row that still
  // happens to exist in the table (a *deleted* group is a real DELETE and
  // can never appear here at all — this is specifically about groups that
  // were created but never used).
  // Deletes predate the cascade cleanup added to deleteGroup() in
  // groups.mjs, so a viewing of this admin page also sweeps out any
  // subscriptions/activity rows still orphaned from before that fix —
  // self-healing on an otherwise-idle admin-only endpoint, rather than
  // needing a one-off migration.
  await Promise.all([
    pool.query(`DELETE FROM push_subscriptions p WHERE NOT EXISTS (SELECT 1 FROM groups g WHERE g.id = p.group_id)`),
    pool.query(`DELETE FROM activity_log a WHERE NOT EXISTS (SELECT 1 FROM groups g WHERE g.id = a.group_id)`),
  ]).catch((err) => console.error("admin-stats orphan cleanup failed", err));

  const [totals, pushTotal, active7d, active30d, groups7d, recent] = await Promise.all([
    pool.query(`
      SELECT COUNT(*)::int AS total_groups, COALESCE(SUM(jsonb_array_length(g.members)),0)::int AS total_members
      FROM groups g
      WHERE EXISTS (SELECT 1 FROM activity_log a WHERE a.group_id = g.id)
    `),
    pool.query(`SELECT COUNT(*)::int AS n FROM push_subscriptions`),
    pool.query(`SELECT COUNT(DISTINCT group_id)::int AS n FROM activity_log WHERE created_at > now() - interval '7 days'`),
    pool.query(`SELECT COUNT(DISTINCT group_id)::int AS n FROM activity_log WHERE created_at > now() - interval '30 days'`),
    pool.query(`SELECT COUNT(*)::int AS n FROM groups WHERE created_at > now() - interval '7 days'`),
    pool.query(`
      SELECT g.id, g.name, g.kind, jsonb_array_length(g.members)::int AS member_count, g.created_at
      FROM groups g
      WHERE EXISTS (SELECT 1 FROM activity_log a WHERE a.group_id = g.id)
      ORDER BY g.created_at DESC LIMIT 20
    `),
  ]);

  const t = totals.rows[0];
  const cards = [
    ["실사용 그룹 수", t.total_groups],
    ["실사용 그룹 인원(멤버 합)", t.total_members],
    ["알림 켠 기기 수", pushTotal.rows[0].n],
    ["최근 7일 활동 그룹", active7d.rows[0].n],
    ["최근 30일 활동 그룹", active30d.rows[0].n],
    ["최근 7일 신규 그룹", groups7d.rows[0].n],
  ]
    .map(([label, value]) => `<div class="card"><p class="label">${escapeHtml(label)}</p><p class="value">${value}</p></div>`)
    .join("");

  const rows = recent.rows
    .map(
      (g) =>
        `<tr><td>${escapeHtml(g.name)}</td><td>${escapeHtml(g.kind)}</td><td>${g.member_count}명</td><td class="muted">${formatDate(g.created_at)}</td></tr>`
    )
    .join("");

  const body = `
    <h1>톡캘린더 사용 현황</h1>
    <p class="sub" id="sub">실시간 집계 · ${escapeHtml(new Date().toLocaleString("ko-KR"))} 기준 · 15초마다 자동 갱신</p>
    <div class="grid" id="grid">${cards}</div>
    <h2>최근 실사용 그룹 (최신 20개, 한 번이라도 사용된 그룹만)</h2>
    <table>
      <thead><tr><th>그룹명</th><th>종류</th><th>멤버</th><th>생성일</th></tr></thead>
      <tbody id="groups-tbody">${rows || `<tr><td colspan="4" class="muted">아직 그룹이 없어요.</td></tr>`}</tbody>
    </table>
    <script>
      (function () {
        // Re-fetches this same page every 15s and swaps in just the cards,
        // timestamp, and table — not a full navigation/reload — so numbers
        // stay current for anyone leaving this tab open, without losing
        // scroll position or flashing a blank page each time.
        function refresh() {
          fetch(window.location.href, { cache: "no-store" })
            .then(function (res) { return res.text(); })
            .then(function (html) {
              var doc = new DOMParser().parseFromString(html, "text/html");
              ["grid", "sub", "groups-tbody"].forEach(function (id) {
                var next = doc.getElementById(id);
                var current = document.getElementById(id);
                if (next && current) current.innerHTML = next.innerHTML;
              });
            })
            .catch(function () {});
        }
        setInterval(refresh, 15000);
      })();
    </script>
  `;

  return new Response(page(body), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
};

export const config = {
  path: "/.netlify/functions/admin-stats",
};
