import { useRef, useState } from "react";
import {
  User,
  MapPin,
  Navigation,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Settings,
  Plus,
  Bell,
  Calendar as CalendarIcon,
  X,
  Megaphone,
  Users,
  Lock,
  Trash2,
} from "lucide-react";

const QUICK_START = {
  family: {
    label: "가족으로 시작",
    defaultName: "우리 가족",
    accent: "#0F6E56",
    accentBg: "#E1F5EE",
    members: [
      { id: "dad", name: "아빠", tier: 0 },
      { id: "mom", name: "엄마", tier: 0 },
      { id: "kid", name: "지호", tier: 0 },
    ],
  },
  company: {
    label: "회사/팀으로 시작",
    defaultName: "기획 1팀",
    accent: "#854F0B",
    accentBg: "#FAEEDA",
    members: [
      { id: "ceo", name: "김사장", tier: 3 },
      { id: "dir", name: "박부장", tier: 2 },
      { id: "mgr", name: "이과장", tier: 1 },
      { id: "stf", name: "최사원", tier: 0 },
    ],
  },
  school: {
    label: "학급으로 시작",
    defaultName: "3학년 2반",
    accent: "#534AB7",
    accentBg: "#EEEDFE",
    members: [
      { id: "teacher", name: "담임", tier: 1 },
      { id: "s1", name: "학생1", tier: 0 },
    ],
  },
  custom: {
    label: "직접 만들기",
    defaultName: "",
    accent: "#993556",
    accentBg: "#FBEAF0",
    members: [{ id: "me", name: "나", tier: 0 }],
  },
};

const INITIAL_GROUPS = [
  {
    id: "g1",
    kind: "family",
    name: "우리 가족",
    accent: "#0F6E56",
    accentBg: "#E1F5EE",
    members: QUICK_START.family.members,
    tasks: [
      { id: 1, title: "분리수거 내놓기", assignee: "dad", due: "7/28", done: true, location: null, broadcast: false },
      { id: 2, title: "저녁 설거지", assignee: "mom", due: "7/28", done: false, location: null, broadcast: false },
      {
        id: 3,
        title: "지호 소아과 예약",
        assignee: "mom",
        due: "7/28 15:00",
        done: false,
        location: { name: "튼튼소아청소년과의원", address: "울산 남구 삼산로 123" },
        broadcast: false,
        locked: true,
      },
      { id: 4, title: "이번 주말 외갓집 방문", assignee: null, due: "7/30", done: false, location: null, broadcast: true, private: false },
      { id: 5, title: "병원 검진 예약 (개인)", assignee: "mom", due: "7/29", done: false, location: null, broadcast: false, private: true },
    ],
    events: [
      { id: 1, date: 28, title: "지호 학부모 상담", time: "15:00", assignees: ["kid"] },
      { id: 2, date: 30, title: "엄마 생신", time: "종일", assignees: ["mom"] },
    ],
  },
  {
    id: "g2",
    kind: "company",
    name: "기획 1팀",
    accent: "#854F0B",
    accentBg: "#FAEEDA",
    members: QUICK_START.company.members,
    tasks: [
      { id: 1, title: "주간 보고서 작성", assignee: "mgr", due: "7/28", done: false, location: null, broadcast: false },
      {
        id: 2,
        title: "거래처 미팅",
        assignee: "dir",
        due: "7/28 14:00",
        done: false,
        location: { name: "테크노밸리 3층 회의실", address: "울산 남구 테크노산업로 55" },
        broadcast: false,
      },
      { id: 3, title: "다음 주 금요일 조기 퇴근 안내", assignee: null, due: "8/1", done: false, location: null, broadcast: true },
    ],
    events: [
      { id: 1, date: 28, title: "임원 보고", time: "10:00", assignees: ["ceo"] },
      { id: 2, date: 28, title: "기획안 마감", time: "18:00", assignees: ["mgr"] },
    ],
  },
];

function Avatar({ tier, size = 28, photo }) {
  const border = tier === 0 ? 0.5 : tier === 1 ? 1.5 : tier === 2 ? 2 : 2.5;
  if (photo) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          border: `${border}px solid var(--text-primary)`,
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      </div>
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--surface-2)",
        border: `${border}px solid var(--text-primary)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <User size={size * 0.5} strokeWidth={2} />
    </div>
  );
}

export default function GroupApp() {
  const [groups, setGroups] = useState(INITIAL_GROUPS);
  const [view, setView] = useState("groups"); // groups | create | app
  const [activeId, setActiveId] = useState(null);
  const [tab, setTab] = useState("home");
  const [selectedDay, setSelectedDay] = useState(28);
  const [openTask, setOpenTask] = useState(null);

  const [createChoice, setCreateChoice] = useState(null);
  const [createStep, setCreateStep] = useState("choose");
  const [newName, setNewName] = useState("");

  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskTime, setNewTaskTime] = useState("");
  const [newTaskBroadcast, setNewTaskBroadcast] = useState(false);
  const [newTaskPrivate, setNewTaskPrivate] = useState(false);

  const [today, setToday] = useState(28);
  const [todayMonth, setTodayMonth] = useState(7);
  const [todayYear, setTodayYear] = useState(2026);
  const [toast, setToast] = useState(null); // { message, undo }

  const active = groups.find((g) => g.id === activeId);
  const memberById = active ? Object.fromEntries(active.members.map((m) => [m.id, m])) : {};

  const avatarFileInputRef = useRef(null);
  const [avatarUploadMemberId, setAvatarUploadMemberId] = useState(null);

  function handleAvatarClick(memberId) {
    setAvatarUploadMemberId(memberId);
    avatarFileInputRef.current?.click();
  }

  function handleAvatarFileChange(e) {
    const file = e.target.files?.[0];
    const memberId = avatarUploadMemberId;
    e.target.value = "";
    if (!file || !memberId) return;
    const reader = new FileReader();
    reader.onload = () => {
      const photo = reader.result;
      setGroups((prev) =>
        prev.map((g) =>
          g.id !== activeId ? g : { ...g, members: g.members.map((m) => (m.id === memberId ? { ...m, photo } : m)) }
        )
      );
    };
    reader.readAsDataURL(file);
  }

  function openGroup(id) {
    setActiveId(id);
    setTab("home");
    setView("app");
  }

  function startCreate() {
    setCreateChoice(null);
    setNewName("");
    setCreateStep("choose");
    setView("create");
  }

  function pickChoice(key) {
    setCreateChoice(key);
    setNewName(QUICK_START[key].defaultName);
    setCreateStep("name");
  }

  function confirmCreate() {
    const q = QUICK_START[createChoice];
    const id = "g" + (groups.length + 1) + "-" + Date.now();
    const group = {
      id,
      kind: createChoice,
      name: newName || q.defaultName || "새 그룹",
      accent: q.accent,
      accentBg: q.accentBg,
      members: q.members,
      tasks: [],
      events: [],
    };
    setGroups((prev) => [...prev, group]);
    openGroup(id);
  }

  function toggleTask(id) {
    setGroups((prev) =>
      prev.map((g) => (g.id !== activeId ? g : { ...g, tasks: g.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) }))
    );
    setOpenTask((prev) => (prev && prev.id === id ? { ...prev, done: !prev.done } : prev));
  }

  function taskDay(t) {
    const m = t.due.match(/\/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  function deleteTask(task) {
    if (task.locked) {
      setToast({ message: "잠긴 항목은 삭제할 수 없어요", undo: null });
      setTimeout(() => setToast(null), 2500);
      return;
    }
    const gid = activeId;
    setGroups((prev) => prev.map((g) => (g.id !== gid ? g : { ...g, tasks: g.tasks.filter((t) => t.id !== task.id) })));
    setOpenTask(null);
    const timer = setTimeout(() => setToast(null), 4000);
    setToast({
      message: `"${task.title}" 삭제됨`,
      undo: () => {
        clearTimeout(timer);
        setGroups((prev) => prev.map((g) => (g.id !== gid ? g : { ...g, tasks: [...g.tasks, task].sort((a, b) => a.id - b.id) })));
        setToast(null);
      },
    });
  }

  function carryOverToNextDay() {
    const gid = activeId;
    const daysInTodayMonth = new Date(todayYear, todayMonth, 0).getDate();
    let nextDay = today + 1;
    let nextMonth = todayMonth;
    let nextYear = todayYear;
    if (nextDay > daysInTodayMonth) {
      nextDay = 1;
      nextMonth = todayMonth + 1;
      if (nextMonth > 12) {
        nextMonth = 1;
        nextYear = todayYear + 1;
      }
    }
    setGroups((prev) =>
      prev.map((g) =>
        g.id !== gid
          ? g
          : {
              ...g,
              tasks: g.tasks.map((t) => {
                if (t.broadcast || t.done || taskDay(t) !== today) return t;
                const timePart = t.due.includes(" ") ? " " + t.due.split(" ")[1] : "";
                return { ...t, due: `${nextMonth}/${nextDay}${timePart}` };
              }),
            }
      )
    );
    setToday(nextDay);
    setTodayMonth(nextMonth);
    setTodayYear(nextYear);
  }

  function addTask() {
    if (!newTaskTitle.trim()) return;
    setGroups((prev) =>
      prev.map((g) =>
        g.id !== activeId
          ? g
          : {
              ...g,
              tasks: [
                ...g.tasks,
                {
                  id: Date.now(),
                  title: newTaskTitle,
                  assignee: newTaskBroadcast ? null : g.members[0]?.id ?? null,
                  due: newTaskTime ? `${todayMonth}/${today} ${newTaskTime}` : `${todayMonth}/${today}`,
                  done: false,
                  location: null,
                  broadcast: newTaskBroadcast,
                  private: newTaskPrivate,
                },
              ],
            }
      )
    );
    setNewTaskTitle("");
    setNewTaskTime("");
    setNewTaskBroadcast(false);
    setNewTaskPrivate(false);
  }

  const [viewYear, setViewYear] = useState(2026);
  const [viewMonth, setViewMonth] = useState(7); // 1-indexed

  function getWeeks(year, month) {
    const firstDay = new Date(year, month - 1, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    const rows = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }

  function goPrevMonth() {
    setViewMonth((m) => {
      if (m === 1) {
        setViewYear((y) => y - 1);
        return 12;
      }
      return m - 1;
    });
  }

  function goNextMonth() {
    setViewMonth((m) => {
      if (m === 12) {
        setViewYear((y) => y + 1);
        return 1;
      }
      return m + 1;
    });
  }

  const weeks = getWeeks(viewYear, viewMonth);
  const isSampleMonth = viewYear === 2026 && viewMonth === 7;
  const dayHasEvent = (d) => (active && isSampleMonth ? active.events.filter((e) => e.date === d) : []);
  const dayEvents = active && isSampleMonth ? active.events.filter((e) => e.date === selectedDay) : [];

  // ---------- GROUP LIST ----------
  if (view === "groups") {
    return (
      <div style={{ fontFamily: "var(--font-sans)", maxWidth: 420, margin: "0 auto" }}>
        <div
          style={{
            background: "var(--surface-2)",
            borderRadius: 16,
            border: "0.5px solid var(--border)",
            padding: "1.1rem 1.25rem",
          }}
        >
          <p style={{ fontWeight: 500, fontSize: 16, margin: "0 0 14px" }}>내 그룹</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            {groups.map((g) => (
              <div
                key={g.id}
                onClick={() => openGroup(g.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  border: "0.5px solid var(--border)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: g.accentBg,
                    color: g.accent,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Users size={17} />
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>{g.name}</p>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>{g.members.length}명</p>
                </div>
                <ChevronRight size={16} color="var(--text-muted)" />
              </div>
            ))}
          </div>
          <button onClick={startCreate} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Plus size={15} /> 새 그룹 만들기
          </button>
        </div>
      </div>
    );
  }

  // ---------- CREATE GROUP ----------
  if (view === "create") {
    return (
      <div style={{ fontFamily: "var(--font-sans)", maxWidth: 420, margin: "0 auto" }}>
        <div
          style={{
            background: "var(--surface-2)",
            borderRadius: 16,
            border: "0.5px solid var(--border)",
            padding: "1.1rem 1.25rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <ChevronLeft
              size={18}
              color="var(--text-secondary)"
              style={{ cursor: "pointer" }}
              onClick={() => (createStep === "name" ? setCreateStep("choose") : setView("groups"))}
            />
            <p style={{ fontWeight: 500, fontSize: 15, margin: 0 }}>새 그룹 만들기</p>
          </div>

          {createStep === "choose" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {Object.entries(QUICK_START).map(([key, q]) => (
                <div
                  key={key}
                  onClick={() => pickChoice(key)}
                  style={{
                    border: "0.5px solid var(--border)",
                    borderRadius: 10,
                    padding: "14px 16px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: q.accentBg,
                      color: q.accent,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Users size={16} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>{q.label}</p>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                      {key === "custom" ? "이름, 멤버를 자유롭게 정해요" : `예: ${q.defaultName}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {createStep === "name" && (
            <div>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 6px" }}>그룹 이름</p>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="그룹 이름을 입력하세요"
                style={{ width: "100%", marginBottom: 16 }}
              />
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 16px" }}>
                만든 뒤에도 멤버 초대와 이름 변경은 언제든 가능해요.
              </p>
              <button onClick={confirmCreate} style={{ width: "100%" }}>
                그룹 만들기
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------- MAIN APP ----------
  if (!active) return null;

  return (
    <div style={{ fontFamily: "var(--font-sans)", maxWidth: 420, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <ChevronLeft size={17} color="var(--text-secondary)" style={{ cursor: "pointer" }} onClick={() => setView("groups")} />
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>내 그룹</span>
      </div>

      <div
        style={{
          background: "var(--surface-2)",
          borderRadius: 16,
          border: "0.5px solid var(--border)",
          padding: "1.1rem 1.25rem",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <p style={{ fontWeight: 500, fontSize: 16, margin: 0 }}>{active.name}</p>
            <span style={{ fontSize: 11, background: active.accentBg, color: active.accent, padding: "2px 8px", borderRadius: 6 }}>
              {active.members.length}명
            </span>
          </div>
          <Settings size={19} color="var(--text-secondary)" />
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {active.members.map((m) => (
            <div key={m.id} style={{ textAlign: "center" }}>
              <div
                onClick={() => handleAvatarClick(m.id)}
                style={{ position: "relative", width: 28, height: 28, margin: "0 auto", cursor: "pointer" }}
                title="사진 업로드"
              >
                <Avatar tier={m.tier} photo={m.photo} />
                <div
                  style={{
                    position: "absolute",
                    right: -2,
                    bottom: -2,
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: "var(--text-primary)",
                    color: "var(--surface-2)",
                    border: "1.5px solid var(--surface-2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Camera size={8} />
                </div>
              </div>
              <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "3px 0 0" }}>{m.name}</p>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          <button
            onClick={() => setTab("home")}
            style={{
              flex: 1,
              fontSize: 13,
              padding: "8px",
              borderRadius: 8,
              border: tab === "home" ? `1px solid ${active.accent}` : "0.5px solid var(--border)",
              background: tab === "home" ? active.accentBg : "transparent",
              color: tab === "home" ? active.accent : "var(--text-secondary)",
            }}
          >
            홈
          </button>
          <button
            onClick={() => setTab("calendar")}
            style={{
              flex: 1,
              fontSize: 13,
              padding: "8px",
              borderRadius: 8,
              border: tab === "calendar" ? `1px solid ${active.accent}` : "0.5px solid var(--border)",
              background: tab === "calendar" ? active.accentBg : "transparent",
              color: tab === "calendar" ? active.accent : "var(--text-secondary)",
            }}
          >
            전체 캘린더
          </button>
        </div>

        {tab === "home" && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0, display: "flex", alignItems: "center", gap: 5 }}>
                <Check size={14} /> {todayMonth}월 {today}일 할일 / 공지
              </p>
              <button
                onClick={carryOverToNextDay}
                style={{ fontSize: 11, padding: "4px 8px", background: "transparent", border: "0.5px solid var(--border)", color: "var(--text-secondary)" }}
              >
                다음 날로 넘기기 →
              </button>
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "4px 0 8px" }}>
              완료 안 된 할일은 다음 날로 넘기면 자동 이월돼요. 자물쇠는 나만 보기(또는 잠긴 항목)를 뜻해요.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              {active.tasks
                .filter((t) => t.broadcast || taskDay(t) === today)
                .map((t) => (
                <div
                  key={t.id}
                  onClick={() => setOpenTask(t)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    border: t.broadcast ? `1px solid ${active.accent}` : "0.5px solid var(--border)",
                    background: t.broadcast ? active.accentBg : "transparent",
                    borderRadius: 8,
                    padding: "8px 10px",
                    cursor: "pointer",
                    opacity: t.private ? 0.85 : 1,
                  }}
                >
                  {t.broadcast ? (
                    <Megaphone size={16} color={active.accent} />
                  ) : (
                    <input type="checkbox" checked={t.done} onClick={(e) => e.stopPropagation()} onChange={() => toggleTask(t.id)} />
                  )}
                  <span
                    style={{
                      fontSize: 14,
                      flex: 1,
                      color: t.done ? "var(--text-muted)" : "var(--text-primary)",
                      textDecoration: t.done ? "line-through" : "none",
                    }}
                  >
                    {t.title}
                  </span>
                  {(t.private || t.locked) && <Lock size={13} color="var(--text-muted)" />}
                  {t.location && <MapPin size={14} color="var(--text-muted)" />}
                  {t.due.includes(" ") && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t.due.split(" ")[1]}</span>}
                  {!t.broadcast && !t.private && t.assignee && (
                    <Avatar tier={memberById[t.assignee]?.tier ?? 0} size={14} photo={memberById[t.assignee]?.photo} />
                  )}
                  <span style={{ fontSize: 11, color: t.broadcast ? active.accent : "var(--text-muted)" }}>
                    {t.broadcast ? "전체 공지" : t.private ? "나만 보기" : memberById[t.assignee]?.name}
                  </span>
                  <Trash2
                    size={14}
                    color="var(--text-muted)"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteTask(t);
                    }}
                  />
                </div>
              ))}
              {active.tasks.filter((t) => t.broadcast || taskDay(t) === today).length === 0 && (
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>오늘은 남은 할일이 없어요.</p>
              )}
            </div>

            {toast && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "var(--text-primary)",
                  color: "var(--surface-2)",
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontSize: 12,
                  marginBottom: 12,
                }}
              >
                <span>{toast.message}</span>
                {toast.undo && (
                  <span style={{ cursor: "pointer", fontWeight: 500, textDecoration: "underline" }} onClick={toast.undo}>
                    되돌리기
                  </span>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <input
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                placeholder="할일 또는 공지 내용"
                style={{ flex: 1 }}
              />
              <input
                type="time"
                value={newTaskTime}
                onChange={(e) => setNewTaskTime(e.target.value)}
                style={{ width: 110 }}
              />
            </div>
            <div style={{ display: "flex", gap: 16, marginBottom: 10, marginTop: -2 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={newTaskBroadcast}
                  onChange={(e) => {
                    setNewTaskBroadcast(e.target.checked);
                    if (e.target.checked) setNewTaskPrivate(false);
                  }}
                />
                전체에게 공지로 보내기
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={newTaskPrivate}
                  onChange={(e) => {
                    setNewTaskPrivate(e.target.checked);
                    if (e.target.checked) setNewTaskBroadcast(false);
                  }}
                />
                나만 보기
              </label>
            </div>
            <button onClick={addTask} style={{ width: "100%", marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Plus size={15} /> 추가하기
            </button>

            <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 8px", display: "flex", alignItems: "center", gap: 5 }}>
              <CalendarIcon size={14} /> 다가오는 일정
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {active.events.map((e) => (
                <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                  <div style={{ width: 34, textAlign: "center", fontSize: 11, color: "var(--text-secondary)" }}>7/{e.date}</div>
                  <div style={{ flex: 1 }}>{e.title}</div>
                  <Bell size={13} color="var(--text-muted)" />
                </div>
              ))}
            </div>

            <button onClick={() => setTab("calendar")} style={{ width: "100%" }}>
              전체 일정 보기
            </button>
          </>
        )}

        {tab === "calendar" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <ChevronLeft size={17} color="var(--text-secondary)" style={{ cursor: "pointer" }} onClick={goPrevMonth} />
              <p style={{ fontWeight: 500, fontSize: 14, margin: 0 }}>{viewYear}년 {viewMonth}월</p>
              <ChevronRight size={17} color="var(--text-secondary)" style={{ cursor: "pointer" }} onClick={goNextMonth} />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7,minmax(0,1fr))",
                gap: 2,
                fontSize: 10,
                color: "var(--text-muted)",
                textAlign: "center",
                marginBottom: 4,
              }}
            >
              {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: 2 }}>
              {weeks.flat().map((d, i) => {
                if (!d) return <div key={i} style={{ height: 48 }} />;
                const evs = dayHasEvent(d);
                const isSelected = d === selectedDay;
                return (
                  <div
                    key={i}
                    onClick={() => setSelectedDay(d)}
                    style={{
                      height: 48,
                      border: isSelected ? `1px solid ${active.accent}` : "0.5px solid var(--border)",
                      background: isSelected ? active.accentBg : "transparent",
                      borderRadius: 6,
                      padding: 3,
                      fontSize: 10,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ color: isSelected ? active.accent : "var(--text-primary)", fontWeight: isSelected ? 500 : 400 }}>{d}</div>
                    {evs.length > 0 && (
                      <div style={{ display: "flex", gap: 1, marginTop: 2 }}>
                        {evs
                          .flatMap((e) => e.assignees)
                          .slice(0, 2)
                          .map((a, idx) => (
                            <Avatar key={idx} tier={memberById[a]?.tier ?? 0} size={13} photo={memberById[a]?.photo} />
                          ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 14, borderTop: "0.5px solid var(--border)", paddingTop: 10 }}>
              <p style={{ fontSize: 12, fontWeight: 500, margin: "0 0 6px" }}>{viewMonth}월 {selectedDay}일</p>
              {dayEvents.length === 0 && <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>일정이 없어요.</p>}
              {dayEvents.map((e) => (
                <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 4 }}>
                  <Avatar tier={memberById[e.assignees[0]]?.tier ?? 0} size={16} photo={memberById[e.assignees[0]]?.photo} />
                  <span style={{ flex: 1 }}>{e.title}</span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{e.time}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <input
        ref={avatarFileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleAvatarFileChange}
      />

      {openTask && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
          }}
          onClick={() => setOpenTask(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--surface-2)",
              borderRadius: 16,
              padding: "1.25rem 1.4rem",
              width: 340,
              maxWidth: "90vw",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <p style={{ fontWeight: 500, fontSize: 15, margin: 0 }}>{openTask.broadcast ? "전체 공지" : "할일 상세"}</p>
              <X size={18} color="var(--text-secondary)" style={{ cursor: "pointer" }} onClick={() => setOpenTask(null)} />
            </div>

            <p style={{ fontSize: 17, fontWeight: 500, margin: "0 0 4px" }}>{openTask.title}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16, fontSize: 13, color: "var(--text-secondary)" }}>
              {openTask.broadcast ? (
                <span>그룹 전체에게 알림</span>
              ) : (
                <>
                  <Avatar tier={memberById[openTask.assignee]?.tier ?? 0} size={18} photo={memberById[openTask.assignee]?.photo} />
                  <span>{memberById[openTask.assignee]?.name} 담당</span>
                </>
              )}
              <span style={{ color: "var(--text-muted)" }}>· {openTask.due}</span>
            </div>

            {openTask.location && (
              <div style={{ borderTop: "0.5px solid var(--border)", paddingTop: 12, marginBottom: 12 }}>
                <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 8px", display: "flex", alignItems: "center", gap: 5 }}>
                  <MapPin size={14} /> 장소
                </p>
                <div style={{ border: "0.5px solid var(--border)", borderRadius: 8, padding: "10px 12px" }}>
                  <p style={{ fontSize: 14, margin: "0 0 2px" }}>{openTask.location.name}</p>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>{openTask.location.address}</p>
                </div>
                <button style={{ width: "100%", marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <Navigation size={15} /> 길찾기 시작
                </button>
              </div>
            )}

            <div style={{ borderTop: "0.5px solid var(--border)", paddingTop: 12, marginBottom: 12 }}>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 8px", display: "flex", alignItems: "center", gap: 5 }}>
                <Camera size={14} /> 첨부 사진
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 8,
                    border: "1px dashed var(--border-strong)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Plus size={17} color="var(--text-muted)" />
                </div>
              </div>
            </div>

            {!openTask.broadcast && (
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, borderTop: "0.5px solid var(--border)", paddingTop: 12, marginBottom: 12 }}>
                <input type="checkbox" checked={openTask.done} onChange={() => toggleTask(openTask.id)} />
                완료로 표시
              </label>
            )}

            <button
              onClick={() => deleteTask(openTask)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                background: "transparent",
                border: "0.5px solid var(--border)",
                color: openTask.locked ? "var(--text-muted)" : "var(--text-danger)",
              }}
            >
              <Trash2 size={14} /> {openTask.locked ? "잠긴 항목 (삭제 불가)" : "삭제하기"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
