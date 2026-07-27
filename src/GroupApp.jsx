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
  const [newTaskAssignee, setNewTaskAssignee] = useState(null);
  const [newTaskPhotos, setNewTaskPhotos] = useState([]);
  const [showNewTaskLocation, setShowNewTaskLocation] = useState(false);
  const [newTaskLocationName, setNewTaskLocationName] = useState("");
  const [newTaskLocationAddress, setNewTaskLocationAddress] = useState("");

  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [tempAmPm, setTempAmPm] = useState("오전");
  const [tempHour, setTempHour] = useState(12);
  const [tempMinute, setTempMinute] = useState(0);

  const [showTaskLocationInput, setShowTaskLocationInput] = useState(false);
  const [taskLocationName, setTaskLocationName] = useState("");
  const [taskLocationAddress, setTaskLocationAddress] = useState("");

  // draft edits for the open task detail modal — only committed to `groups` on 수정 완료
  const [draftLocation, setDraftLocation] = useState(null);
  const [draftPhotos, setDraftPhotos] = useState([]);
  const [draftPrivate, setDraftPrivate] = useState(false);
  const [draftAssignee, setDraftAssignee] = useState(null);

  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [draftMembers, setDraftMembers] = useState([]);

  const [today, setToday] = useState(28);
  const [todayMonth, setTodayMonth] = useState(7);
  const [todayYear, setTodayYear] = useState(2026);
  const [toast, setToast] = useState(null); // { message, undo }
  const [carryOverExcluded, setCarryOverExcluded] = useState(() => new Set());

  const active = groups.find((g) => g.id === activeId);
  const memberById = active ? Object.fromEntries(active.members.map((m) => [m.id, m])) : {};
  const selectedAssignee =
    active && active.members.some((m) => m.id === newTaskAssignee) ? newTaskAssignee : active?.members[0]?.id ?? "";

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

  const taskPhotoInputRef = useRef(null);

  function handleTaskPhotoClick() {
    taskPhotoInputRef.current?.click();
  }

  function handleTaskPhotoFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !openTask) return;
    const reader = new FileReader();
    reader.onload = () => {
      setDraftPhotos((prev) => [...prev, reader.result]);
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

  function openGroupSettings() {
    setDraftMembers(active.members);
    setShowAddMember(false);
    setNewMemberName("");
    setGroupSettingsOpen(true);
  }

  function closeGroupSettings() {
    setGroupSettingsOpen(false);
    setShowAddMember(false);
    setNewMemberName("");
  }

  function addDraftMember() {
    if (!newMemberName.trim()) return;
    const id = "m" + Date.now();
    setDraftMembers((prev) => [...prev, { id, name: newMemberName.trim(), tier: 0 }]);
    setNewMemberName("");
    setShowAddMember(false);
  }

  function removeDraftMember(memberId) {
    setDraftMembers((prev) => prev.filter((m) => m.id !== memberId));
  }

  function saveGroupSettings() {
    const removedIds = active.members.filter((m) => !draftMembers.some((dm) => dm.id === m.id)).map((m) => m.id);
    setGroups((prev) =>
      prev.map((g) =>
        g.id !== activeId
          ? g
          : {
              ...g,
              members: draftMembers,
              tasks: g.tasks.map((t) => (removedIds.includes(t.assignee) ? { ...t, assignee: null } : t)),
              events: g.events.map((e) => ({ ...e, assignees: e.assignees.filter((a) => !removedIds.includes(a)) })),
            }
      )
    );
    closeGroupSettings();
  }

  function toggleEventNotify(eventId) {
    setGroups((prev) =>
      prev.map((g) =>
        g.id !== activeId
          ? g
          : { ...g, events: g.events.map((e) => (e.id === eventId ? { ...e, notify: e.notify === false ? true : false } : e)) }
      )
    );
  }

  function toggleTask(id) {
    setGroups((prev) =>
      prev.map((g) => (g.id !== activeId ? g : { ...g, tasks: g.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) }))
    );
    setOpenTask((prev) => (prev && prev.id === id ? { ...prev, done: !prev.done } : prev));
  }

  function toggleCarryOverSelection(id) {
    setCarryOverExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openTaskDetail(t) {
    setOpenTask(t);
    setDraftLocation(t.location || null);
    setDraftPhotos(t.photos || []);
    setDraftPrivate(!!t.private);
    setDraftAssignee(t.assignee || null);
    setShowTaskLocationInput(false);
    setTaskLocationName("");
    setTaskLocationAddress("");
  }

  function closeTaskDetail() {
    setOpenTask(null);
    setShowTaskLocationInput(false);
    setTaskLocationName("");
    setTaskLocationAddress("");
  }

  function saveTaskDetailEdits() {
    const taskId = openTask.id;
    setGroups((prev) =>
      prev.map((g) =>
        g.id !== activeId
          ? g
          : {
              ...g,
              tasks: g.tasks.map((t) =>
                t.id === taskId
                  ? { ...t, location: draftLocation, photos: draftPhotos, private: draftPrivate, assignee: draftAssignee }
                  : t
              ),
            }
      )
    );
    closeTaskDetail();
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
                if (t.broadcast || t.done || taskDay(t) !== today || carryOverExcluded.has(t.id)) return t;
                const timePart = t.due.includes(" ") ? " " + t.due.split(" ")[1] : "";
                return { ...t, due: `${nextMonth}/${nextDay}${timePart}` };
              }),
            }
      )
    );
    setToday(nextDay);
    setTodayMonth(nextMonth);
    setTodayYear(nextYear);
    setCarryOverExcluded(new Set());
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
                  assignee: newTaskBroadcast ? null : selectedAssignee || null,
                  due: newTaskTime ? `${todayMonth}/${today} ${newTaskTime}` : `${todayMonth}/${today}`,
                  done: false,
                  location:
                    newTaskLocationName.trim() || newTaskLocationAddress.trim()
                      ? {
                          name: newTaskLocationName.trim() || newTaskLocationAddress.trim(),
                          address: newTaskLocationAddress.trim(),
                        }
                      : null,
                  broadcast: newTaskBroadcast,
                  private: newTaskPrivate,
                  photos: newTaskPhotos,
                },
              ],
            }
      )
    );
    setNewTaskTitle("");
    setNewTaskTime("");
    setNewTaskBroadcast(false);
    setNewTaskPrivate(false);
    setNewTaskPhotos([]);
    setShowNewTaskLocation(false);
    setNewTaskLocationName("");
    setNewTaskLocationAddress("");
  }

  const newTaskPhotoInputRef = useRef(null);

  function handleNewTaskPhotoFileChange(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setNewTaskPhotos((prev) => [...prev, reader.result]);
      };
      reader.readAsDataURL(file);
    });
  }

  function from24Hour(hhmm) {
    const [hStr, mStr] = hhmm.split(":");
    const h = parseInt(hStr, 10);
    const minute = parseInt(mStr, 10);
    const ampm = h >= 12 ? "오후" : "오전";
    let hour12 = h % 12;
    if (hour12 === 0) hour12 = 12;
    return { ampm, hour12, minute };
  }

  function formatDisplayTime(hhmm) {
    const { ampm, hour12, minute } = from24Hour(hhmm);
    return `${ampm} ${hour12}:${String(minute).padStart(2, "0")}`;
  }

  function openTimePicker() {
    if (newTaskTime) {
      const { ampm, hour12, minute } = from24Hour(newTaskTime);
      setTempAmPm(ampm);
      setTempHour(hour12);
      setTempMinute(minute);
    } else {
      setTempAmPm("오전");
      setTempHour(12);
      setTempMinute(0);
    }
    setTimePickerOpen(true);
  }

  function confirmTimePicker() {
    let h24 = tempHour % 12;
    if (tempAmPm === "오후") h24 += 12;
    const hh = String(h24).padStart(2, "0");
    const mm = String(tempMinute).padStart(2, "0");
    setNewTaskTime(`${hh}:${mm}`);
    setTimePickerOpen(false);
  }

  function loadDaumPostcodeScript(callback) {
    if (window.daum && window.daum.Postcode) {
      callback();
      return;
    }
    const existing = document.getElementById("daum-postcode-script");
    if (existing) {
      existing.addEventListener("load", callback, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = "daum-postcode-script";
    script.src = "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
    script.onload = callback;
    document.body.appendChild(script);
  }

  function searchAddress(onAddress) {
    loadDaumPostcodeScript(() => {
      new window.daum.Postcode({
        oncomplete: (data) => {
          const address = data.roadAddress || data.jibunAddress || data.address;
          onAddress(address, data.buildingName || "");
        },
      }).open();
    });
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
          <Settings
            size={19}
            color="var(--text-secondary)"
            style={{ cursor: "pointer" }}
            onClick={openGroupSettings}
          />
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
                  onClick={() => openTaskDetail(t)}
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
                  <input type="checkbox" checked={t.done} onClick={(e) => e.stopPropagation()} onChange={() => toggleTask(t.id)} />
                  {t.broadcast && <Megaphone size={16} color={active.accent} />}
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
                  {!t.broadcast && !t.done && taskDay(t) === today && (
                    <input
                      type="checkbox"
                      checked={!carryOverExcluded.has(t.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleCarryOverSelection(t.id)}
                      title="다음 날로 넘기기 선택"
                      style={{ accentColor: active.accent }}
                    />
                  )}
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
              <div
                onClick={openTimePicker}
                style={{
                  minWidth: 130,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "0.5px solid var(--border)",
                  background: "var(--surface-2)",
                  color: newTaskTime ? "var(--text-primary)" : "var(--text-muted)",
                  fontSize: 14,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  whiteSpace: "nowrap",
                }}
              >
                {newTaskTime ? formatDisplayTime(newTaskTime) : "시간 선택"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <select
                value={selectedAssignee}
                onChange={(e) => setNewTaskAssignee(e.target.value)}
                disabled={newTaskBroadcast}
                style={{ flex: 1 }}
              >
                {active.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
              {newTaskPhotos.map((src, idx) => (
                <div key={idx} style={{ position: "relative", width: 40, height: 40 }}>
                  <img
                    src={src}
                    alt=""
                    style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover", border: "0.5px solid var(--border)" }}
                  />
                  <div
                    onClick={() => setNewTaskPhotos((prev) => prev.filter((_, i) => i !== idx))}
                    style={{
                      position: "absolute",
                      top: -5,
                      right: -5,
                      width: 15,
                      height: 15,
                      borderRadius: "50%",
                      background: "var(--text-primary)",
                      color: "var(--surface-2)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                    }}
                  >
                    <X size={9} />
                  </div>
                </div>
              ))}
              <button
                onClick={() => newTaskPhotoInputRef.current?.click()}
                style={{
                  fontSize: 12,
                  padding: "6px 10px",
                  background: "transparent",
                  border: "0.5px dashed var(--border-strong)",
                  color: "var(--text-secondary)",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Plus size={13} /> 사진 추가
              </button>
              <button
                onClick={() => setShowNewTaskLocation(true)}
                style={{
                  fontSize: 12,
                  padding: "6px 10px",
                  background: "transparent",
                  border: "0.5px dashed var(--border-strong)",
                  color: "var(--text-secondary)",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  maxWidth: "100%",
                }}
              >
                {newTaskLocationName || newTaskLocationAddress ? (
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    📍 {newTaskLocationName || newTaskLocationAddress}
                  </span>
                ) : (
                  <>
                    <MapPin size={13} /> 주소 추가
                  </>
                )}
              </button>
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
                <div
                  key={e.id}
                  onClick={() => {
                    setViewYear(2026);
                    setViewMonth(7);
                    setSelectedDay(e.date);
                    setTab("calendar");
                  }}
                  style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, cursor: "pointer" }}
                >
                  <div style={{ width: 34, textAlign: "center", fontSize: 11, color: "var(--text-secondary)" }}>7/{e.date}</div>
                  <div style={{ flex: 1 }}>{e.title}</div>
                  <Bell
                    size={13}
                    color={e.notify === false ? "var(--border-strong)" : active.accent}
                    fill={e.notify === false ? "none" : active.accent}
                    style={{ cursor: "pointer", opacity: e.notify === false ? 0.6 : 1 }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      toggleEventNotify(e.id);
                    }}
                  />
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

      <input
        ref={taskPhotoInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleTaskPhotoFileChange}
      />

      <input
        ref={newTaskPhotoInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={handleNewTaskPhotoFileChange}
      />

      {timePickerOpen && (
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
          onClick={() => setTimePickerOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--surface-2)",
              borderRadius: 16,
              padding: "1.25rem 1.4rem",
              width: 280,
              maxWidth: "90vw",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <p style={{ fontWeight: 500, fontSize: 15, margin: 0 }}>시간 선택</p>
              <X size={18} color="var(--text-secondary)" style={{ cursor: "pointer" }} onClick={() => setTimePickerOpen(false)} />
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              <select value={tempAmPm} onChange={(e) => setTempAmPm(e.target.value)} style={{ flex: 1 }}>
                <option value="오전">오전</option>
                <option value="오후">오후</option>
              </select>
              <select value={tempHour} onChange={(e) => setTempHour(Number(e.target.value))} style={{ flex: 1 }}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                  <option key={h} value={h}>
                    {h}시
                  </option>
                ))}
              </select>
              <select value={tempMinute} onChange={(e) => setTempMinute(Number(e.target.value))} style={{ flex: 1 }}>
                {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
                  <option key={m} value={m}>
                    {String(m).padStart(2, "0")}분
                  </option>
                ))}
              </select>
            </div>
            <button onClick={confirmTimePicker} style={{ width: "100%" }}>
              확인
            </button>
          </div>
        </div>
      )}

      {showNewTaskLocation && (
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
          onClick={() => setShowNewTaskLocation(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--surface-2)",
              borderRadius: 16,
              padding: "1.25rem 1.4rem",
              width: 320,
              maxWidth: "90vw",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <p style={{ fontWeight: 500, fontSize: 15, margin: 0 }}>장소 검색</p>
              <X
                size={18}
                color="var(--text-secondary)"
                style={{ cursor: "pointer" }}
                onClick={() => setShowNewTaskLocation(false)}
              />
            </div>
            <input
              value={newTaskLocationName}
              onChange={(e) => setNewTaskLocationName(e.target.value)}
              placeholder="장소 이름"
              style={{ width: "100%", marginBottom: 8 }}
            />
            <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
              <input value={newTaskLocationAddress} readOnly placeholder="주소 검색으로 입력돼요" style={{ flex: 1 }} />
              <button
                onClick={() =>
                  searchAddress((address, buildingName) => {
                    setNewTaskLocationAddress(address);
                    setNewTaskLocationName((prev) => prev || buildingName);
                  })
                }
              >
                주소 검색
              </button>
            </div>
            <button onClick={() => setShowNewTaskLocation(false)} style={{ width: "100%" }}>
              확인
            </button>
          </div>
        </div>
      )}

      {showTaskLocationInput && openTask && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 11,
          }}
          onClick={() => setShowTaskLocationInput(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--surface-2)",
              borderRadius: 16,
              padding: "1.25rem 1.4rem",
              width: 320,
              maxWidth: "90vw",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <p style={{ fontWeight: 500, fontSize: 15, margin: 0 }}>{draftLocation ? "장소 수정" : "장소 검색"}</p>
              <X
                size={18}
                color="var(--text-secondary)"
                style={{ cursor: "pointer" }}
                onClick={() => setShowTaskLocationInput(false)}
              />
            </div>
            <input
              value={taskLocationName}
              onChange={(e) => setTaskLocationName(e.target.value)}
              placeholder="장소 이름"
              style={{ width: "100%", marginBottom: 8 }}
            />
            <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
              <input value={taskLocationAddress} readOnly placeholder="주소 검색으로 입력돼요 (선택)" style={{ flex: 1 }} />
              <button
                onClick={() =>
                  searchAddress((address, buildingName) => {
                    setTaskLocationAddress(address);
                    setTaskLocationName((prev) => prev || buildingName);
                  })
                }
              >
                주소 검색
              </button>
            </div>
            <button
              onClick={() => {
                const name = taskLocationName.trim();
                const address = taskLocationAddress.trim();
                setDraftLocation(name || address ? { name: name || address, address } : null);
                setShowTaskLocationInput(false);
                setTaskLocationName("");
                setTaskLocationAddress("");
              }}
              style={{ width: "100%" }}
            >
              확인
            </button>
          </div>
        </div>
      )}

      {groupSettingsOpen && (
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
          onClick={closeGroupSettings}
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
              <p style={{ fontWeight: 500, fontSize: 15, margin: 0 }}>그룹 설정</p>
              <X size={18} color="var(--text-secondary)" style={{ cursor: "pointer" }} onClick={closeGroupSettings} />
            </div>

            <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 8px" }}>구성원 ({draftMembers.length}명)</p>
            <div style={{ display: "flex", flexDirection: "column", marginBottom: 12 }}>
              {draftMembers.map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 0",
                    borderBottom: "0.5px solid var(--border)",
                  }}
                >
                  <Avatar tier={m.tier} photo={m.photo} size={24} />
                  <span style={{ flex: 1, fontSize: 14 }}>{m.name}</span>
                  <Trash2
                    size={16}
                    color="var(--text-danger)"
                    style={{ cursor: "pointer" }}
                    onClick={() => removeDraftMember(m.id)}
                  />
                </div>
              ))}
              {draftMembers.length === 0 && (
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "8px 0" }}>구성원이 없어요.</p>
              )}
            </div>

            {showAddMember ? (
              <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                <input
                  autoFocus
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addDraftMember();
                  }}
                  placeholder="멤버 이름"
                  style={{ flex: 1 }}
                />
                <button onClick={addDraftMember}>추가</button>
              </div>
            ) : (
              <button
                onClick={() => setShowAddMember(true)}
                style={{ width: "100%", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <Plus size={15} /> 멤버 추가
              </button>
            )}

            <button onClick={saveGroupSettings} style={{ width: "100%" }}>
              수정 완료
            </button>
          </div>
        </div>
      )}

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
          onClick={closeTaskDetail}
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
              <X size={18} color="var(--text-secondary)" style={{ cursor: "pointer" }} onClick={closeTaskDetail} />
            </div>

            <p style={{ fontSize: 17, fontWeight: 500, margin: "0 0 4px" }}>{openTask.title}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16, fontSize: 13, color: "var(--text-secondary)" }}>
              {openTask.broadcast ? (
                <span>그룹 전체에게 알림</span>
              ) : (
                <>
                  <Avatar tier={memberById[draftAssignee]?.tier ?? 0} size={18} photo={memberById[draftAssignee]?.photo} />
                  <select
                    value={draftAssignee ?? ""}
                    onChange={(e) => setDraftAssignee(e.target.value)}
                    style={{ fontSize: 13, padding: "3px 6px" }}
                  >
                    {active.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <span>담당</span>
                </>
              )}
              <span style={{ color: "var(--text-muted)" }}>· {openTask.due}</span>
            </div>

            {draftLocation && (
              <div style={{ borderTop: "0.5px solid var(--border)", paddingTop: 12, marginBottom: 12 }}>
                <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 8px", display: "flex", alignItems: "center", gap: 5 }}>
                  <MapPin size={14} /> 장소
                </p>
                <div
                  onClick={() => {
                    setTaskLocationName(draftLocation.name || "");
                    setTaskLocationAddress(draftLocation.address || "");
                    setShowTaskLocationInput(true);
                  }}
                  style={{ border: "0.5px solid var(--border)", borderRadius: 8, padding: "10px 12px", cursor: "pointer" }}
                >
                  <p style={{ fontSize: 14, margin: "0 0 2px" }}>{draftLocation.name}</p>
                  {draftLocation.address && (
                    <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>{draftLocation.address}</p>
                  )}
                </div>
                {draftLocation.address && (
                  <button
                    onClick={() =>
                      window.open(
                        `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(draftLocation.address)}`,
                        "_blank",
                        "noopener,noreferrer"
                      )
                    }
                    style={{ width: "100%", marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                  >
                    <Navigation size={15} /> 길찾기 시작
                  </button>
                )}
              </div>
            )}

            {!draftLocation && (
              <div style={{ borderTop: "0.5px solid var(--border)", paddingTop: 12, marginBottom: 12 }}>
                <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 8px", display: "flex", alignItems: "center", gap: 5 }}>
                  <MapPin size={14} /> 장소
                </p>
                <button
                  onClick={() => {
                    setTaskLocationName("");
                    setTaskLocationAddress("");
                    setShowTaskLocationInput(true);
                  }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    background: "transparent",
                    border: "0.5px dashed var(--border-strong)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <Plus size={15} /> 주소 추가
                </button>
              </div>
            )}

            <div style={{ borderTop: "0.5px solid var(--border)", paddingTop: 12, marginBottom: 12 }}>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 8px", display: "flex", alignItems: "center", gap: 5 }}>
                <Camera size={14} /> 첨부 사진
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {draftPhotos.map((src, idx) => (
                  <img
                    key={idx}
                    src={src}
                    alt=""
                    style={{ width: 52, height: 52, borderRadius: 8, objectFit: "cover", border: "0.5px solid var(--border)" }}
                  />
                ))}
                <div
                  onClick={handleTaskPhotoClick}
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 8,
                    border: "1px dashed var(--border-strong)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                  }}
                >
                  <Plus size={17} color="var(--text-muted)" />
                </div>
              </div>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, borderTop: "0.5px solid var(--border)", paddingTop: 12, marginBottom: 12 }}>
              <input type="checkbox" checked={openTask.done} onChange={() => toggleTask(openTask.id)} />
              완료로 표시
            </label>

            {!openTask.broadcast && (
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, marginBottom: 12 }}>
                <input type="checkbox" checked={draftPrivate} onChange={() => setDraftPrivate((prev) => !prev)} />
                나만 보기 (해제하면 전체 일정으로 전환돼요)
              </label>
            )}

            <button onClick={saveTaskDetailEdits} style={{ width: "100%", marginBottom: 12 }}>
              수정 완료
            </button>

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
