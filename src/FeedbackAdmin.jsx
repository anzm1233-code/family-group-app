import { useState } from "react";

// Reachable at /admin/feedback — not linked from anywhere in the main app UI.
// Gated by FEEDBACK_ADMIN_PASSWORD (set in Netlify's site environment
// variables); the server refuses to list anything without it. Session-only:
// the password isn't persisted, so it has to be re-entered each visit.
export default function FeedbackAdmin() {
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function load(pw) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/feedback?password=${encodeURIComponent(pw)}`);
      if (res.status === 401) {
        setError("비밀번호가 틀렸어요.");
        setFeedback(null);
        return;
      }
      if (!res.ok) throw new Error("load_failed");
      const data = await res.json();
      setFeedback(data.feedback);
    } catch {
      setError("불러오지 못했어요. 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <p style={{ fontWeight: 500, fontSize: 15, margin: "0 0 12px" }}>피드백 목록</p>

      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") load(password);
          }}
          placeholder="비밀번호"
          style={{ flex: 1 }}
        />
        <button onClick={() => load(password)} disabled={loading}>
          {loading ? "확인 중..." : "보기"}
        </button>
      </div>

      {error && <p style={{ fontSize: 13, color: "var(--text-danger)", margin: "0 0 12px" }}>{error}</p>}

      {feedback && (
        <>
          <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 8px" }}>{feedback.length}건</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {feedback.length === 0 && (
              <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>아직 접수된 피드백이 없어요.</p>
            )}
            {feedback.map((f) => (
              <div
                key={f.id}
                style={{
                  border: "0.5px solid var(--border)",
                  borderRadius: 8,
                  padding: "10px 12px",
                }}
              >
                <p style={{ fontSize: 14, whiteSpace: "pre-wrap", margin: "0 0 6px" }}>{f.message}</p>
                <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
                  {new Date(f.created_at).toLocaleString("ko-KR")}
                  {f.group_id ? ` · 그룹 ${f.group_id}` : " · 그룹 없음"}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
