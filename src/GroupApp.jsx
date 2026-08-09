import { useEffect, useRef, useState } from "react";
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
  Share2,
  Home,
  StickyNote,
  PartyPopper,
  Info,
} from "lucide-react";
import KoreanLunarCalendar from "korean-lunar-calendar";
import QRCode from "qrcode";

// Group deletion asks for this fixed phrase instead of the group's actual
// name — comparing against a literal we control avoids invisible-character
// mismatches (NFC/NFD Hangul encoding, stray double/non-breaking spaces)
// that a real, possibly-legacy group name can carry without anyone noticing.
const DELETE_CONFIRM_PHRASE = "삭제합니다";

// Monotonically increasing, so ids stay unique even if two are requested in
// the same millisecond (e.g. an eager double-click/double-tap on "추가").
// Plain Date.now() can collide there, which produces duplicate React `key`s
// and crashes reconciliation with "Failed to execute 'removeChild'...".
let lastGeneratedId = 0;
function generateLocalId() {
  lastGeneratedId = Math.max(Date.now(), lastGeneratedId + 1);
  return lastGeneratedId;
}

function addDaysToYMD(day, month, year, daysToAdd) {
  let d = day;
  let m = month;
  let y = year;
  for (let i = 0; i < daysToAdd; i++) {
    const daysInMonth = new Date(y, m, 0).getDate();
    d += 1;
    if (d > daysInMonth) {
      d = 1;
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  }
  return { day: d, month: m, year: y };
}

function getLunarLabel(year, month, day) {
  const cal = new KoreanLunarCalendar();
  if (!cal.setSolarDate(year, month, day)) return null;
  const lunar = cal.getLunarCalendar();
  return `음력 ${lunar.month}월 ${lunar.day}일${lunar.intercalation ? " (윤달)" : ""}`;
}

function formatRelativeTime(isoString) {
  const then = new Date(isoString).getTime();
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return "방금 전";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}일 전`;
}

// Only actual user-set event notification choices survive a reload — everything
// else (checkboxes, drafts, etc.) intentionally resets to its default each time.
const NOTIFY_STORAGE_KEY = "familyGroupApp:eventNotifications";

function loadNotifyPrefs() {
  try {
    const raw = localStorage.getItem(NOTIFY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveNotifyPref(groupId, eventId, notify) {
  try {
    const prefs = loadNotifyPrefs();
    prefs[groupId] = { ...(prefs[groupId] || {}), [eventId]: notify };
    localStorage.setItem(NOTIFY_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage failures (e.g. private mode)
  }
}

// Registering an event implies wanting a reminder for it, so notifications
// default to on; a user can still switch a specific event off, and that
// explicit choice (on or off) is what persists across reloads.
function applyNotifyPrefs(groups) {
  const prefs = loadNotifyPrefs();
  return groups.map((g) => ({
    ...g,
    events: g.events.map((e) => {
      const stored = prefs[g.id]?.[e.id];
      return { ...e, notify: stored === undefined ? true : stored };
    }),
  }));
}

// Per-item color tag, independent of the group's own accent color — lets
// someone visually distinguish individual tasks/events on the calendar and
// in lists, matching how the reference design uses a colored dot per row.
const TASK_COLORS = ["#4F7CFF", "#22C55E", "#FFB020", "#EC4899", "#8B5CF6", "#6B7280"];

const QUICK_START = {
  family: {
    label: "가족으로 시작",
    defaultName: "우리 가족",
    accent: "#4F7CFF",
    accentBg: "#EAF0FF",
    members: [
      { id: "dad", name: "아빠", tier: 0 },
      { id: "mom", name: "엄마", tier: 0 },
      { id: "kid", name: "지호", tier: 0 },
    ],
  },
  company: {
    label: "회사/팀으로 시작",
    defaultName: "기획 1팀",
    accent: "#FFB020",
    accentBg: "#FFF4E0",
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
    accent: "#8B5CF6",
    accentBg: "#F2EDFE",
    members: [
      { id: "teacher", name: "담임", tier: 1 },
      { id: "s1", name: "학생1", tier: 0 },
    ],
  },
  custom: {
    label: "직접 만들기",
    defaultName: "",
    accent: "#22C55E",
    accentBg: "#E8F9EF",
    members: [{ id: "me", name: "나", tier: 0 }],
  },
};

// No login: a group's data lives in Postgres keyed by its id, and that id is
// the only thing that gates access — anyone with the /g/:id link reads and
// writes the same shared group.
function parseGroupIdFromPath() {
  const match = window.location.pathname.match(/^\/g\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function navigateToGroupUrl(id) {
  const path = withRecoveryParam(`/g/${id}`);
  if (window.location.pathname + window.location.search !== path) {
    window.history.pushState({ groupId: id }, "", path);
  }
}

function navigateToGroupsListUrl() {
  const path = withRecoveryParam("/");
  if (window.location.pathname + window.location.search !== path) {
    window.history.pushState({}, "", path);
  }
}

// Lets "내 그룹" (see BOOKMARKS_KEY below) be recovered in a storage context
// that's never seen it before — most importantly an iOS "Add to Home
// Screen" install, which on iOS starts with empty storage completely
// separate from whatever Safari tab the invite link was opened in, so the
// bookmark list would otherwise look like every group had vanished. The
// token is not a password or account: it's just an opaque, unguessable id
// this browser makes for itself once and keeps re-attaching to its own
// URLs (see withRecoveryParam), mapped server-side to this browser's last
// known bookmark list (see recovery.mjs). A fresh storage context that
// later opens a URL carrying it can ask the server "what did this token
// have?" and restore its list — see the `recovering` boot sequence in
// GroupApp() below.
const RECOVERY_KEY = "familyGroupApp:recoveryToken";

function loadRecoveryToken() {
  try {
    return localStorage.getItem(RECOVERY_KEY) || null;
  } catch {
    return null;
  }
}

function saveRecoveryToken(token) {
  try {
    localStorage.setItem(RECOVERY_KEY, token);
  } catch {
    // ignore storage failures (e.g. private mode)
  }
}

function generateRecoveryToken() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function parseRecoveryTokenFromUrl() {
  return new URLSearchParams(window.location.search).get("r");
}

// Appends this browser's recovery token to a same-origin path so it travels
// into wherever the URL ends up next — most importantly, iOS's "Add to Home
// Screen" bookmarks whatever URL is in the address bar at the time.
function withRecoveryParam(path) {
  const token = loadRecoveryToken();
  return token ? `${path}${path.includes("?") ? "&" : "?"}r=${encodeURIComponent(token)}` : path;
}

// Purely a personal shortcut list (per browser, not authoritative) so "내 그룹"
// has something to show without any login — the real data always comes from
// the server by id.
const BOOKMARKS_KEY = "familyGroupApp:myGroups";

function loadBookmarks() {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveBookmarks(list) {
  try {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(list));
  } catch {
    // ignore storage failures (e.g. private mode)
  }
  syncBookmarksToRecovery(list);
}

// Best-effort push of the current bookmark list up to this browser's
// recovery token record — fire-and-forget, same "not guaranteed, just good
// enough" trust level as the rest of this app. This is what keeps the
// server's copy fresh enough for a future recovery fetch (see the
// `recovering` boot sequence in GroupApp()) to actually have something
// current to hand back.
function syncBookmarksToRecovery(list) {
  const token = loadRecoveryToken();
  if (!token) return;
  fetch(`/api/recovery/${encodeURIComponent(token)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupIds: list.map((b) => b.id) }),
  }).catch(() => {});
}

// No login, so "who am I" is just a per-browser, per-group choice — not real
// identity, just enough to label actions like "OOO님이 삭제함" on this device.
const WHOAMI_KEY = "familyGroupApp:whoAmI";

function loadWhoAmIMap() {
  try {
    const raw = localStorage.getItem(WHOAMI_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveWhoAmIMap(map) {
  try {
    localStorage.setItem(WHOAMI_KEY, JSON.stringify(map));
  } catch {
    // ignore storage failures (e.g. private mode)
  }
}

// Tracks which groups' "당신은 누구인가요?" prompt has been skipped on this
// device, so declining once doesn't nag on every future visit.
const WHOAMI_PROMPT_DISMISSED_KEY = "familyGroupApp:whoAmIPromptDismissed";

function loadWhoAmIPromptDismissed() {
  try {
    const raw = localStorage.getItem(WHOAMI_PROMPT_DISMISSED_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveWhoAmIPromptDismissed(map) {
  try {
    localStorage.setItem(WHOAMI_PROMPT_DISMISSED_KEY, JSON.stringify(map));
  } catch {
    // ignore storage failures (e.g. private mode)
  }
}

// Marks which groups this browser created, so group deletion and removing
// other members can be limited to the creator. This is a device-local flag,
// not real identity — there's no login, so it can't follow the creator to a
// different browser/device, and someone who knows what they're doing could
// forge it. It's meant to stop accidental/casual misuse, the same trust
// level as everything else in this app, not to be tamper-proof.
const OWNED_GROUPS_KEY = "familyGroupApp:ownedGroups";

function loadOwnedGroups() {
  try {
    const raw = localStorage.getItem(OWNED_GROUPS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function markGroupOwned(groupId) {
  try {
    const map = loadOwnedGroups();
    map[groupId] = true;
    localStorage.setItem(OWNED_GROUPS_KEY, JSON.stringify(map));
  } catch {
    // ignore storage failures (e.g. private mode)
  }
}

// Last-known-good copy of each visited group, so opening a link this device
// has seen before can render instantly from cache while the real fetch
// refreshes it silently in the background, instead of blocking on a loading
// screen every single time.
const GROUP_CACHE_KEY = "familyGroupApp:groupCache";

function loadGroupCache() {
  try {
    const raw = localStorage.getItem(GROUP_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function cacheGroup(group) {
  try {
    const cache = loadGroupCache();
    cache[group.id] = group;
    localStorage.setItem(GROUP_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore storage failures (e.g. private mode)
  }
}

const THEME_KEY = "familyGroupApp:theme";

function loadThemeOverride() {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return raw === "light" || raw === "dark" ? raw : "system";
  } catch {
    return "system";
  }
}

function saveThemeOverride(value) {
  try {
    localStorage.setItem(THEME_KEY, value);
  } catch {
    // ignore storage failures (e.g. private mode)
  }
}

// Tracks which groups this device already has a push subscription for, so
// the "알림 받기" prompt doesn't nag again after the user's already turned
// it on (or explicitly turned it off) here.
const PUSH_SUBSCRIBED_KEY = "familyGroupApp:pushSubscribedGroups";

function loadPushSubscribedGroups() {
  try {
    const raw = localStorage.getItem(PUSH_SUBSCRIBED_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setPushSubscribedGroup(groupId, subscribed) {
  try {
    const map = loadPushSubscribedGroups();
    if (subscribed) map[groupId] = true;
    else delete map[groupId];
    localStorage.setItem(PUSH_SUBSCRIBED_KEY, JSON.stringify(map));
  } catch {
    // ignore storage failures (e.g. private mode)
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function bookmarkFromGroup(group) {
  return {
    id: group.id,
    kind: group.kind,
    name: group.name,
    accent: group.accent,
    accentBg: group.accentBg,
    memberCount: Array.isArray(group.members) ? group.members.length : (group.memberCount ?? 0),
  };
}

// Sends one targeted operation (e.g. "add this task", "delete that task") for
// the server to apply against its own current row — never the whole
// members/tasks/events document. A previous version sent the client's full
// local copy on every save, so whoever saved second (even just toggling one
// checkbox) silently overwrote anything a concurrent editor had just added,
// because their "current tasks" snapshot didn't include it yet. Returns the
// server's post-op group on success (the caller reconciles local state with
// it) or null on failure.
async function sendGroupOp(groupId, op) {
  try {
    const res = await fetch(`/api/groups/${groupId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(op),
    });
    // Distinguished from a plain failure so callers can tell "someone else
    // deleted this group" apart from a transient network/server error —
    // the two need very different handling (kick back to the list vs. just
    // retry).
    if (res.status === 404) return { notFound: true };
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

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
  const initialGroupId = parseGroupIdFromPath();
  const now = new Date();
  const initialBookmarks = loadBookmarks();

  // A token already saved on this device means there's nothing to recover —
  // carry on as normal. A token that only shows up in the URL (never saved
  // locally) means this storage context is seeing it for the first time,
  // which is exactly what an iOS "Add to Home Screen" install looks like on
  // its very first open: worth asking the server for that token's last
  // known group list before assuming this is a first-time visitor with an
  // empty "새 그룹 만들기" screen. Skipped entirely for a direct /g/:id deep
  // link — that group loads (and re-bookmarks itself) on its own regardless,
  // and a full-screen recovery takeover would otherwise hijack it away from
  // the specific group the link pointed at.
  const [bootRecovery] = useState(() => {
    const stored = loadRecoveryToken();
    const fromUrl = parseRecoveryTokenFromUrl();
    const token = stored || fromUrl || generateRecoveryToken();
    if (!stored) saveRecoveryToken(token);
    const needsFetch = !stored && !!fromUrl && initialBookmarks.length === 0 && !initialGroupId;
    return { token, needsFetch };
  });
  const recoveryToken = bootRecovery.token;
  const [recovering, setRecovering] = useState(bootRecovery.needsFetch);

  const [groups, setGroups] = useState(() => {
    if (!initialGroupId) return [];
    const cached = loadGroupCache()[initialGroupId];
    return cached ? [applyNotifyPrefs([cached])[0]] : [];
  });
  const [bookmarks, setBookmarks] = useState(initialBookmarks);
  const [whoAmIMap, setWhoAmIMap] = useState(() => loadWhoAmIMap());
  const [whoAmIPromptDismissed, setWhoAmIPromptDismissed] = useState(() => loadWhoAmIPromptDismissed());
  const [ownedGroups, setOwnedGroups] = useState(() => loadOwnedGroups());
  const [pushSubscribedGroups, setPushSubscribedGroups] = useState(() => loadPushSubscribedGroups());
  const [pushBusy, setPushBusy] = useState(false);
  // Skip the loading screen when a cached copy already lets the group render
  // immediately — loadGroup() still refreshes it, just silently.
  const [groupLoading, setGroupLoading] = useState(() => !!initialGroupId && !loadGroupCache()[initialGroupId]);
  const [groupLoadError, setGroupLoadError] = useState(null);
  // A deep link always wins. Otherwise: nothing saved yet means this is very
  // likely a first-time visitor, so skip straight to "새 그룹 만들기" instead
  // of an empty-looking list — anyone with existing groups still lands on
  // their list as before.
  const [view, setView] = useState(() => {
    if (initialGroupId) return "app";
    return initialBookmarks.length === 0 ? "create" : "groups";
  }); // groups | create | app
  const [, setHistoryStack] = useState([]);
  const [activeId, setActiveId] = useState(initialGroupId);
  const [tab, setTab] = useState("home");
  const [selectedDay, setSelectedDay] = useState(() => now.getDate());
  const [openTask, setOpenTask] = useState(null);
  const [openEvent, setOpenEvent] = useState(null);

  const [createChoice, setCreateChoice] = useState(null);
  const [createStep, setCreateStep] = useState("choose");
  const [newName, setNewName] = useState("");
  const [newOwnerName, setNewOwnerName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState(null);

  const [showAddTaskForm, setShowAddTaskForm] = useState(false);
  const [showCalendarAddTaskForm, setShowCalendarAddTaskForm] = useState(false);
  const [showMemoForm, setShowMemoForm] = useState(false);
  const [newMemoTitle, setNewMemoTitle] = useState("");
  const [newMemoColor, setNewMemoColor] = useState(TASK_COLORS[0]);
  const [newMemoBroadcast, setNewMemoBroadcast] = useState(false);
  const [newMemoPrivate, setNewMemoPrivate] = useState(false);
  const [newMemoPhotos, setNewMemoPhotos] = useState([]);
  const [editingMemoId, setEditingMemoId] = useState(null);
  const [editingMemoText, setEditingMemoText] = useState("");
  const [editingMemoColor, setEditingMemoColor] = useState(TASK_COLORS[0]);
  const [editingMemoBroadcast, setEditingMemoBroadcast] = useState(false);
  const [editingMemoPrivate, setEditingMemoPrivate] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskTime, setNewTaskTime] = useState("");
  const [newTaskColor, setNewTaskColor] = useState(TASK_COLORS[0]);
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

  const [carryOverDatePickerOpen, setCarryOverDatePickerOpen] = useState(false);
  const [carryOverTargetDate, setCarryOverTargetDate] = useState(""); // yyyy-mm-dd, for <input type="date">

  const [showTaskLocationInput, setShowTaskLocationInput] = useState(false);
  const [taskLocationName, setTaskLocationName] = useState("");
  const [taskLocationAddress, setTaskLocationAddress] = useState("");

  // draft edits for the open task detail modal — only committed to `groups` on 수정 완료
  const [draftTitle, setDraftTitle] = useState("");
  const [draftLocation, setDraftLocation] = useState(null);
  const [draftPhotos, setDraftPhotos] = useState([]);
  const [draftPrivate, setDraftPrivate] = useState(false);
  const [draftAssignee, setDraftAssignee] = useState(null);
  const [draftDueDate, setDraftDueDate] = useState(""); // yyyy-mm-dd, for <input type="date">
  const [draftDueTime, setDraftDueTime] = useState(""); // HH:MM, for <input type="time">
  const [draftColor, setDraftColor] = useState(TASK_COLORS[0]);

  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const [inviteScreenOpen, setInviteScreenOpen] = useState(false);
  const [activityScreenOpen, setActivityScreenOpen] = useState(false);
  const [activityItems, setActivityItems] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [inviteQrDataUrl, setInviteQrDataUrl] = useState(null);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [memoListOpen, setMemoListOpen] = useState(false);
  const [photoViewer, setPhotoViewer] = useState(null); // { photos, index }
  const [themeOverride, setThemeOverride] = useState(() => loadThemeOverride());
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [draftMembers, setDraftMembers] = useState([]);
  const [draftGroupName, setDraftGroupName] = useState("");
  const [confirmRemoveMemberId, setConfirmRemoveMemberId] = useState(null);
  const [confirmDeleteTaskId, setConfirmDeleteTaskId] = useState(null);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState(null);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [feedbackList, setFeedbackList] = useState([]);
  const [feedbackListTotal, setFeedbackListTotal] = useState(0);
  const [feedbackPage, setFeedbackPage] = useState(1);
  const [feedbackListLoading, setFeedbackListLoading] = useState(false);
  const [feedbackListError, setFeedbackListError] = useState(null);
  const [commentDrafts, setCommentDrafts] = useState({});
  const [commentBusyId, setCommentBusyId] = useState(null);

  const [today, setToday] = useState(() => now.getDate());
  const [todayMonth, setTodayMonth] = useState(() => now.getMonth() + 1);
  const [todayYear, setTodayYear] = useState(() => now.getFullYear());
  const [toast, setToast] = useState(null); // { message, undo }
  // ids the user has explicitly opted in to carry over — defaults to none selected
  const [carryOverIncluded, setCarryOverIncluded] = useState(() => new Set());

  const active = groups.find((g) => g.id === activeId);
  const memberById = active ? Object.fromEntries(active.members.map((m) => [m.id, m])) : {};
  const selectedAssignee =
    active && active.members.some((m) => m.id === newTaskAssignee) ? newTaskAssignee : active?.members[0]?.id ?? "";
  const myMemberId = activeId && whoAmIMap[activeId] && memberById[whoAmIMap[activeId]] ? whoAmIMap[activeId] : null;
  // "나만 보기" tasks are only meant for their assignee's eyes — everyone else
  // should never see them rendered anywhere (lists, calendar dots, counts).
  const isTaskVisibleToMe = (t) => !t.private || t.assignee === myMemberId;
  const isGroupOwner =
    !!(activeId && ownedGroups[activeId]) || (!!myMemberId && !!active?.ownerMemberId && myMemberId === active.ownerMemberId);
  const isPushSubscribed = !!(activeId && pushSubscribedGroups[activeId]);
  const pushSupported =
    typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;

  // "다가오는 일정" preview: tasks and events landing in the next two days only
  // (today's and overdue items belong in 오늘 할일 instead). Anything further
  // out is only in the full calendar.
  const upcomingWindow = [1, 2].map((n) => addDaysToYMD(today, todayMonth, todayYear, n));
  const upcomingItems = active
    ? [
        ...active.tasks
          .filter((t) => !t.note && isTaskVisibleToMe(t) && upcomingWindow.some((d) => d.month === taskMonth(t) && d.day === taskDay(t)))
          .map((t) => ({ kind: "task", id: t.id, month: taskMonth(t), day: taskDay(t), data: t })),
        ...active.events
          .filter((e) => upcomingWindow.some((d) => d.month === todayMonth && d.day === e.date))
          .map((e) => ({ kind: "event", id: e.id, month: todayMonth, day: e.date, data: e })),
      ].sort((a, b) => a.month - b.month || a.day - b.day)
    : [];

  // "내 그룹" dashboard: today's undone tasks across every bookmarked group,
  // sourced from each group's cached copy (see GROUP_CACHE_KEY) rather than a
  // fresh fetch per group — a group that's never been opened on this device
  // just won't have anything to contribute yet, same limitation as bookmarks.
  const todayScheduleItems =
    view === "groups"
      ? bookmarks
          .flatMap((b) => {
            const g = loadGroupCache()[b.id];
            if (!g || !Array.isArray(g.tasks)) return [];
            const myIdInGroup = whoAmIMap[b.id];
            return g.tasks
              .filter((t) => !t.note && !t.done && (!t.private || t.assignee === myIdInGroup) && taskMonth(t) === todayMonth && taskDay(t) === today)
              .map((t) => ({ groupId: b.id, groupName: b.name, groupAccent: b.accent, task: t }));
          })
          .sort((a, b) => {
            const at = a.task.due.includes(" ") ? a.task.due.split(" ")[1] : "";
            const bt = b.task.due.includes(" ") ? b.task.due.split(" ")[1] : "";
            return at.localeCompare(bt);
          })
      : [];

  // Best-effort display name for the dashboard greeting — whoAmI is recorded
  // per group (not globally), so this just uses whichever bookmarked group's
  // identity was picked first. Purely cosmetic; no group logic depends on it.
  const dashboardGreetingName =
    view === "groups"
      ? (() => {
          const cache = loadGroupCache();
          for (const b of bookmarks) {
            const memberId = whoAmIMap[b.id];
            if (!memberId) continue;
            const name = cache[b.id]?.members?.find((m) => m.id === memberId)?.name;
            if (name) return name;
          }
          return null;
        })()
      : null;

  function setWhoAmI(memberId) {
    setWhoAmIMap((prev) => {
      const next = { ...prev };
      if (memberId) next[activeId] = memberId;
      else delete next[activeId];
      saveWhoAmIMap(next);
      return next;
    });
  }

  function dismissWhoAmIPrompt() {
    setWhoAmIPromptDismissed((prev) => {
      const next = { ...prev, [activeId]: true };
      saveWhoAmIPromptDismissed(next);
      return next;
    });
  }

  function pickWhoAmIFromPrompt(memberId) {
    setWhoAmI(memberId);
    dismissWhoAmIPrompt();
    // ownerMemberId back-fill for an already-owner device is handled by the
    // effect above once myMemberId resolves from this pick.
  }

  const shouldShowWhoAmIPrompt =
    view === "app" && !!active && active.members.length > 0 && !myMemberId && !whoAmIPromptDismissed[activeId];

  async function subscribeToPush() {
    if (!pushSupported || !activeId) return;
    // iOS Safari only supports Web Push for a site that's been added to the
    // home screen (standalone mode) — a regular Safari tab will silently
    // fail the permission/subscribe calls, which used to look like nothing
    // happened. Catch that case up front with an actionable message instead.
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone;
    if (isIos && !isStandalone) {
      setToast({
        message: "아이폰에서는 홈 화면에 추가한 뒤에만 알림을 받을 수 있어요. 공유 버튼 → 홈 화면에 추가를 먼저 해주세요",
        undo: null,
      });
      setTimeout(() => setToast(null), 5000);
      return;
    }
    setPushBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setToast({ message: "알림이 차단되어 있어요. 브라우저 설정에서 허용해주세요", undo: null });
        setTimeout(() => setToast(null), 4000);
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const keyRes = await fetch("/api/push/public-key");
      const { publicKey } = await keyRes.json();
      if (!publicKey) {
        setToast({ message: "알림 기능이 아직 준비되지 않았어요", undo: null });
        setTimeout(() => setToast(null), 4000);
        return;
      }
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        // Subscribing means round-tripping to the browser's push service
        // (FCM, etc.) — if that's unreachable, some browsers hang instead
        // of rejecting, so guard with a timeout rather than leaving the
        // button stuck on "설정 중..." forever.
        subscription = await Promise.race([
          registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("subscribe timed out")), 15000)),
        ]);
      }
      const subscribeRes = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId: activeId, subscription }),
      });
      if (!subscribeRes.ok) {
        const errBody = await subscribeRes.text().catch(() => "");
        throw new Error(`subscribe save failed: ${subscribeRes.status} ${errBody}`);
      }
      setPushSubscribedGroups((prev) => ({ ...prev, [activeId]: true }));
      setPushSubscribedGroup(activeId, true);
      setToast({ message: "✅ 알림이 설정되었어요", undo: null });
      setTimeout(() => setToast(null), 4000);
    } catch (err) {
      console.error("push subscribe failed", err);
      setToast({ message: "알림 설정에 실패했어요. 잠시 후 다시 시도해주세요", undo: null });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setPushBusy(false);
    }
  }

  async function unsubscribeFromPush() {
    if (!pushSupported || !activeId) return;
    setPushBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setPushSubscribedGroups((prev) => {
        const next = { ...prev };
        delete next[activeId];
        return next;
      });
      setPushSubscribedGroup(activeId, false);
    } catch (err) {
      console.error("push unsubscribe failed", err);
    } finally {
      setPushBusy(false);
    }
  }

  const avatarFileInputRef = useRef(null);
  const [avatarUploadMemberId, setAvatarUploadMemberId] = useState(null);

  // Tracks in-flight saves so the polling refresh (below) never clobbers a
  // local edit with stale data it fetched while that edit was still in transit.
  const pendingSaveCountRef = useRef(0);

  // Applies `applyLocally` for instant feedback, then sends the matching
  // targeted `op` to the server. Once the server responds with its
  // authoritative post-op group, local state is reconciled to exactly that —
  // so this never overwrites a concurrent change the way resending a whole
  // local snapshot would (see sendGroupOp).
  // Someone else deleted this group out from under us — drop it from every
  // local trace (active list, bookmarks) so it stops looking usable, and
  // let the existing "그룹이 삭제됐어요" screen take over for whoever's
  // currently looking at it.
  function removeDeletedGroupFromClient(groupId) {
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
    setBookmarks((prev) => {
      const next = prev.filter((b) => b.id !== groupId);
      saveBookmarks(next);
      return next;
    });
    setGroupLoadError("not_found");
  }

  function runGroupOp(op, applyLocally) {
    const groupId = activeId;
    setGroups((prev) => prev.map((g) => (g.id !== groupId ? g : applyLocally(g))));
    pendingSaveCountRef.current += 1;
    sendGroupOp(groupId, op)
      .then((fresh) => {
        if (fresh && fresh.notFound) {
          removeDeletedGroupFromClient(groupId);
          return;
        }
        if (!fresh) {
          setToast({ message: "저장하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요", undo: null });
          setTimeout(() => setToast(null), 3000);
          return;
        }
        cacheGroup(fresh);
        const withNotify = applyNotifyPrefs([fresh])[0];
        setGroups((prev) => prev.map((g) => (g.id === fresh.id ? withNotify : g)));
      })
      .finally(() => {
        pendingSaveCountRef.current -= 1;
      });
  }

  async function loadGroup(id, { silent = false } = {}) {
    if (!silent) setGroupLoading(true);
    setGroupLoadError(null);
    try {
      const res = await fetch(`/api/groups/${id}`);
      if (res.status === 404) {
        setGroupLoadError("not_found");
        return;
      }
      if (!res.ok) throw new Error("fetch_failed");
      const group = await res.json();
      cacheGroup(group);
      const withNotify = applyNotifyPrefs([group])[0];
      setGroups((prev) => (prev.some((g) => g.id === group.id) ? prev.map((g) => (g.id === group.id ? withNotify : g)) : [...prev, withNotify]));
      setBookmarks((prev) => {
        const next = [bookmarkFromGroup(group), ...prev.filter((b) => b.id !== group.id)];
        saveBookmarks(next);
        return next;
      });
    } catch {
      if (!silent) setGroupLoadError("network");
    } finally {
      if (!silent) setGroupLoading(false);
    }
  }

  // "system" clears the override attribute entirely so the OS-level
  // prefers-color-scheme media query in index.css takes back over.
  useEffect(() => {
    if (themeOverride === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = themeOverride;
  }, [themeOverride]);

  // Registering the service worker up front (not just when someone opts
  // into push) is what makes Chrome/Android treat this as a real
  // installable PWA — with the manifest but no active service worker,
  // "홈 화면에 추가" only creates a plain bookmark shortcut instead of a
  // standalone app. Registration alone requests no permissions and starts
  // no subscription; subscribeToPush() re-registers the same URL later,
  // which is a harmless no-op against the existing registration.
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // Keeps the recovery token attached to whatever URL is currently showing,
  // even before the very first in-app navigation (navigateToGroupUrl /
  // navigateToGroupsListUrl only add it from that point on). Matters because
  // "Add to Home Screen" can happen at any moment, and it's the address bar's
  // URL at that moment that gets bookmarked.
  useEffect(() => {
    const path = withRecoveryParam(window.location.pathname);
    if (window.location.pathname + window.location.search !== path) {
      window.history.replaceState(window.history.state, "", path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Runs once, only when bootRecovery flagged a token this storage context
  // has never saved locally (see above) — asks the server what group ids
  // that token last had, then re-fetches those groups' summaries the same
  // way the "내 그룹" list-refresh effect does, and restores them as this
  // device's bookmarks. A brief "불러오는 중..." screen (see the `recovering`
  // check in the render below) covers this instead of flashing "새 그룹
  // 만들기" and then swapping to the real list a moment later.
  useEffect(() => {
    if (!recovering) return;
    let cancelled = false;
    fetch(`/api/recovery/${encodeURIComponent(recoveryToken)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return null;
        const ids = Array.isArray(data?.groupIds) ? data.groupIds : [];
        if (ids.length === 0) return null;
        return fetch(`/api/groups?ids=${ids.join(",")}`).then((res) => (res.ok ? res.json() : null));
      })
      .then((groupsData) => {
        if (cancelled || !groupsData || !Array.isArray(groupsData.groups) || groupsData.groups.length === 0) return;
        const recovered = groupsData.groups.map((g) => ({
          id: g.id,
          kind: g.kind,
          name: g.name,
          accent: g.accent,
          accentBg: g.accentBg,
          memberCount: g.memberCount,
        }));
        setBookmarks(recovered);
        saveBookmarks(recovered);
        setView("groups");
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRecovering(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function chooseTheme(value) {
    setThemeOverride(value);
    saveThemeOverride(value);
  }

  // Opportunistically back-fills ownerMemberId for groups where this device
  // was already locally flagged as owner before that concept existed
  // server-side (or before the owner's whoAmI pick happened to trigger it) —
  // runs whenever the active group and identity are both already resolved,
  // not just at the moment of picking a name from the prompt. This is what
  // makes ownership recoverable later even for groups that predate this
  // feature or whose owner already picked their name in the past.
  useEffect(() => {
    if (!activeId || !myMemberId) return;
    if (!ownedGroups[activeId]) return;
    if (active?.ownerMemberId) return;
    runGroupOp({ op: "claimOwner", memberId: myMemberId }, (g) => ({ ...g, ownerMemberId: g.ownerMemberId || myMemberId }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, myMemberId, active?.ownerMemberId, ownedGroups[activeId]]);

  // Deep link support: a page load on /g/:id fetches that group directly,
  // with no login — the link itself is the access control.
  useEffect(() => {
    if (initialGroupId) loadGroup(initialGroupId, { silent: groups.some((g) => g.id === initialGroupId) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the "내 그룹" bookmark list's names/member counts fresh whenever it's
  // shown, and drop any bookmark whose group someone else has since
  // deleted — otherwise it just sits there forever pointing at nothing.
  useEffect(() => {
    if (view !== "groups" || bookmarks.length === 0) return;
    let cancelled = false;
    fetch(`/api/groups?ids=${bookmarks.map((b) => b.id).join(",")}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const byId = Object.fromEntries(data.groups.map((g) => [g.id, g]));
        setBookmarks((prev) => {
          const next = prev.filter((b) => byId[b.id]).map((b) => ({ ...b, ...byId[b.id] }));
          saveBookmarks(next);
          return next;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Poll the active group while it's open so other people's changes show up
  // without needing a manual refresh. Skips a tick while the tab is hidden
  // (no point spending a function call nobody will see) or while a local
  // edit is still saving (so the poll can't overwrite it with stale data).
  useEffect(() => {
    if (view !== "app" || !activeId) return;
    const groupId = activeId;
    const POLL_INTERVAL_MS = 5000;
    const interval = setInterval(() => {
      if (document.hidden || pendingSaveCountRef.current > 0) return;
      fetch(`/api/groups/${groupId}`)
        .then((res) => {
          if (res.status === 404) {
            removeDeletedGroupFromClient(groupId);
            return null;
          }
          return res.ok ? res.json() : null;
        })
        .then((group) => {
          if (!group || pendingSaveCountRef.current > 0) return;
          cacheGroup(group);
          const withNotify = applyNotifyPrefs([group])[0];
          setGroups((prev) => prev.map((g) => (g.id === group.id ? withNotify : g)));
        })
        .catch(() => {
          // best-effort; a transient failure just waits for the next tick
        });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [view, activeId]);

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
      runGroupOp(
        { op: "patchMember", memberId, patch: { photo } },
        (g) => ({ ...g, members: g.members.map((m) => (m.id === memberId ? { ...m, photo } : m)) })
      );
      // Photo changes save immediately (unlike name edits, which wait for
      // "수정 완료"), so if the 그룹 관리 modal happens to be open with its
      // own draft copy of the member list, keep that copy in sync too —
      // otherwise it'd keep showing the old photo until the modal reopens.
      setDraftMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, photo } : m)));
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

  function pushHistory() {
    setHistoryStack((prev) => [...prev, { view, tab, createStep }]);
  }

  function goBack() {
    setHistoryStack((prev) => {
      if (prev.length === 0) {
        setView("groups");
        navigateToGroupsListUrl();
        return prev;
      }
      const last = prev[prev.length - 1];
      setView(last.view);
      setTab(last.tab);
      setCreateStep(last.createStep);
      if (last.view === "groups") navigateToGroupsListUrl();
      return prev.slice(0, -1);
    });
  }

  // Always jumps straight to the group list, regardless of how deep the user
  // has navigated (or whether they arrived fresh via a shared /g/:id link).
  // Doesn't touch `groups`/`activeId` — the current group's data is untouched.
  function goToGroupsList() {
    setHistoryStack([]);
    setView("groups");
    navigateToGroupsListUrl();
  }

  function goToTab(nextTab) {
    if (tab === nextTab) return;
    pushHistory();
    setTab(nextTab);
    setShowAddTaskForm(false);
    setShowCalendarAddTaskForm(false);
  }

  function openGroup(id) {
    pushHistory();
    setActiveId(id);
    setTab("home");
    setView("app");
    setShowAddTaskForm(false);
    setShowCalendarAddTaskForm(false);
    navigateToGroupUrl(id);
    loadGroup(id);
  }

  function startCreate() {
    pushHistory();
    setCreateChoice(null);
    setNewName("");
    setCreateStep("choose");
    setCreateError(null);
    setView("create");
  }

  function pickChoice(key) {
    pushHistory();
    setCreateChoice(key);
    setNewName(QUICK_START[key].defaultName);
    setNewOwnerName("");
    setCreateStep("name");
  }

  async function confirmCreate() {
    const q = QUICK_START[createChoice];
    // If the creator gives their own name up front, skip the "who are you"
    // step entirely: fold them into the member list right here and mark
    // them the owner, instead of making them rename a placeholder member
    // (or pick themselves from the prompt) after the fact.
    const ownerName = newOwnerName.trim();
    let members = q.members;
    let ownerMemberId = null;
    if (ownerName) {
      if (createChoice === "custom") {
        members = [{ id: "me", name: ownerName, tier: 0 }];
        ownerMemberId = "me";
      } else {
        const newMember = { id: "m" + generateLocalId(), name: ownerName, tier: 0 };
        members = [...q.members, newMember];
        ownerMemberId = newMember.id;
      }
    }
    setCreateBusy(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: createChoice,
          name: newName || q.defaultName || "새 그룹",
          accent: q.accent,
          accentBg: q.accentBg,
          members,
          ownerMemberId,
        }),
      });
      if (!res.ok) throw new Error("create_failed");
      const group = await res.json();
      cacheGroup(group);
      markGroupOwned(group.id);
      setOwnedGroups((prev) => ({ ...prev, [group.id]: true }));
      if (ownerMemberId) {
        setWhoAmIMap((prev) => {
          const next = { ...prev, [group.id]: ownerMemberId };
          saveWhoAmIMap(next);
          return next;
        });
      }
      setGroups((prev) => [...prev, applyNotifyPrefs([group])[0]]);
      setBookmarks((prev) => {
        const next = [bookmarkFromGroup(group), ...prev.filter((b) => b.id !== group.id)];
        saveBookmarks(next);
        return next;
      });
      // Skip the now-completed creation wizard steps in the back history —
      // back from the new group should return straight to the group list.
      setHistoryStack([{ view: "groups", tab: "home", createStep: "choose" }]);
      setActiveId(group.id);
      setTab("home");
      setView("app");
      navigateToGroupUrl(group.id);
    } catch {
      setCreateError("그룹을 만들지 못했어요. 다시 시도해 주세요.");
    } finally {
      setCreateBusy(false);
    }
  }

  async function copyGroupLink(url) {
    try {
      await navigator.clipboard.writeText(url);
      setToast({ message: "초대하고 싶은 멤버에게 주소를 보내주세요", undo: null });
    } catch {
      setToast({ message: `복사에 실패했어요. 직접 복사해 주세요: ${url}`, undo: null });
    }
    setTimeout(() => setToast(null), 2500);
  }

  // Unlike copyGroupLink, this carries this browser's recovery token (see
  // withRecoveryParam) instead of a specific group id — opening it anywhere
  // else (a new browser, or an iOS "Add to Home Screen" install, which
  // starts with empty storage of its own) restores this device's whole "내
  // 그룹" list via the recovery lookup, not just one group. Sharing it as an
  // "invite" would hand someone else this device's group list, so the
  // messaging here has to say the opposite of copyGroupLink's.
  async function copyAppRootLink(url) {
    try {
      await navigator.clipboard.writeText(url);
      setToast({ message: "내 그룹 목록 복구용 주소예요. 다른 사람에게 보내지 말고 내 새 기기/앱에서만 열어주세요", undo: null });
    } catch {
      setToast({ message: `복사에 실패했어요. 직접 복사해 주세요: ${url}`, undo: null });
    }
    setTimeout(() => setToast(null), 4000);
  }

  // Same link for every group type — anyone who opens it sees and edits the
  // same shared data, so "초대" is just "share this URL". Opens the dedicated
  // invite screen (link + QR code) rather than copying immediately, since a
  // QR code has to be rendered there for someone to scan in person.
  function shareGroupLink() {
    setGroupSettingsOpen(false);
    setInviteScreenOpen(true);
    const url = `${window.location.origin}/g/${active.id}`;
    QRCode.toDataURL(url, { width: 220, margin: 1, color: { dark: "#08060d", light: "#ffffff" } })
      .then(setInviteQrDataUrl)
      .catch(() => setInviteQrDataUrl(null));
  }

  function closeInviteScreen() {
    setInviteScreenOpen(false);
    setInviteQrDataUrl(null);
  }

  function openActivityScreen() {
    setActivityScreenOpen(true);
    setActivityLoading(true);
    fetch(`/api/groups/${activeId}/activity`)
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data) => setActivityItems(data.items || []))
      .catch(() => setActivityItems([]))
      .finally(() => setActivityLoading(false));
  }

  function closeActivityScreen() {
    setActivityScreenOpen(false);
  }

  function openGroupSettings() {
    setDraftMembers(active.members);
    setDraftGroupName(active.name);
    setShowAddMember(false);
    setNewMemberName("");
    setConfirmRemoveMemberId(null);
    setDeleteConfirmOpen(false);
    setDeleteConfirmText("");
    setDeleteError(null);
    setGroupSettingsOpen(true);
  }

  function closeGroupSettings() {
    setGroupSettingsOpen(false);
    setShowAddMember(false);
    setNewMemberName("");
    setConfirmRemoveMemberId(null);
    setDeleteConfirmOpen(false);
    setDeleteConfirmText("");
    setDeleteError(null);
  }

  // Loosely compares against the fixed phrase to survive things a user can't
  // see: NFC vs NFD Hangul encoding, and stray double/non-breaking spaces
  // from however they typed it.
  function deleteNameMatches() {
    const normalize = (s) => s.trim().normalize("NFC").replace(/\s+/g, " ");
    return normalize(deleteConfirmText) === normalize(DELETE_CONFIRM_PHRASE);
  }

  // Anyone with the group's link already has full read/write access (same
  // trust model as every other edit in this app) — deletion follows suit and
  // isn't restricted to whoever created it. The only safeguard is requiring
  // a fixed confirmation phrase to be typed, to prevent an accidental click.
  async function confirmDeleteGroup() {
    if (!deleteNameMatches()) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/groups/${activeId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error("delete_failed");
      const deletedId = activeId;
      setGroups((prev) => prev.filter((g) => g.id !== deletedId));
      setBookmarks((prev) => {
        const next = prev.filter((b) => b.id !== deletedId);
        saveBookmarks(next);
        return next;
      });
      closeGroupSettings();
      setActiveId(null);
      setHistoryStack([]);
      setView("groups");
      navigateToGroupsListUrl();
      setToast({ message: "그룹이 삭제됐어요", undo: null });
      setTimeout(() => setToast(null), 2500);
    } catch {
      setDeleteError("삭제하지 못했어요. 다시 시도해 주세요.");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function loadFeedbackList(page) {
    setFeedbackListLoading(true);
    setFeedbackListError(null);
    try {
      const res = await fetch(`/api/feedback?page=${page}`);
      if (!res.ok) throw new Error("load_failed");
      const data = await res.json();
      setFeedbackList(data.items);
      setFeedbackListTotal(data.total);
      setFeedbackPage(data.page);
    } catch {
      setFeedbackListError("피드백을 불러오지 못했어요.");
    } finally {
      setFeedbackListLoading(false);
    }
  }

  function openFeedback() {
    setFeedbackOpen(true);
    setFeedbackText("");
    setFeedbackError(null);
    setFeedbackSubmitted(false);
    loadFeedbackList(1);
  }

  function closeFeedback() {
    setFeedbackOpen(false);
  }

  async function submitFeedback() {
    const message = feedbackText.trim();
    if (!message) return;
    setFeedbackBusy(true);
    setFeedbackError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, groupId: activeId || null }),
      });
      if (!res.ok) throw new Error("submit_failed");
      setFeedbackSubmitted(true);
      setFeedbackText("");
      loadFeedbackList(1);
    } catch {
      setFeedbackError("전송하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setFeedbackBusy(false);
    }
  }

  async function submitComment(feedbackId) {
    const message = (commentDrafts[feedbackId] || "").trim();
    if (!message) return;
    setCommentBusyId(feedbackId);
    try {
      const res = await fetch(`/api/feedback/${feedbackId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) throw new Error("comment_failed");
      const data = await res.json();
      setFeedbackList((prev) =>
        prev.map((f) => (f.id === feedbackId ? { ...f, comments: [...f.comments, data.comment] } : f))
      );
      setCommentDrafts((prev) => ({ ...prev, [feedbackId]: "" }));
    } catch {
      setFeedbackListError("댓글을 남기지 못했어요. 다시 시도해 주세요.");
    } finally {
      setCommentBusyId(null);
    }
  }

  // Fullscreen photo viewer — opened from any photo thumbnail (task or memo,
  // saved or still-staged-pre-save) with the full set it belongs to and
  // which one was clicked, so ◀/▶ (or a swipe) steps through the rest.
  function openPhotoViewer(photos, index) {
    if (!photos || photos.length === 0) return;
    setPhotoViewer({ photos, index });
  }

  function closePhotoViewer() {
    setPhotoViewer(null);
  }

  function showNextPhoto() {
    setPhotoViewer((prev) => (prev ? { ...prev, index: (prev.index + 1) % prev.photos.length } : prev));
  }

  function showPrevPhoto() {
    setPhotoViewer((prev) => (prev ? { ...prev, index: (prev.index - 1 + prev.photos.length) % prev.photos.length } : prev));
  }

  function renderPhotoViewer() {
    if (!photoViewer) return null;
    const { photos, index } = photoViewer;
    const multi = photos.length > 1;
    let touchStartX = null;
    return (
      <div
        onClick={closePhotoViewer}
        onTouchStart={(e) => {
          touchStartX = e.touches[0].clientX;
        }}
        onTouchEnd={(e) => {
          if (touchStartX === null) return;
          const dx = e.changedTouches[0].clientX - touchStartX;
          if (Math.abs(dx) > 40) (dx < 0 ? showNextPhoto : showPrevPhoto)();
          touchStartX = null;
        }}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.92)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 30,
        }}
      >
        <X
          size={26}
          color="#fff"
          style={{ position: "absolute", top: 18, right: 18, cursor: "pointer" }}
          onClick={closePhotoViewer}
        />
        {multi && (
          <p style={{ position: "absolute", top: 20, left: 0, right: 0, textAlign: "center", color: "#fff", fontSize: 14, margin: 0, pointerEvents: "none" }}>
            {index + 1} / {photos.length}
          </p>
        )}
        {multi && (
          <ChevronLeft
            size={34}
            color="#fff"
            style={{ position: "absolute", left: 6, cursor: "pointer", padding: 8 }}
            onClick={(e) => {
              e.stopPropagation();
              showPrevPhoto();
            }}
          />
        )}
        <img
          src={photos[index]}
          alt=""
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: "92vw", maxHeight: "82vh", objectFit: "contain", borderRadius: 8 }}
        />
        {multi && (
          <ChevronRight
            size={34}
            color="#fff"
            style={{ position: "absolute", right: 6, cursor: "pointer", padding: 8 }}
            onClick={(e) => {
              e.stopPropagation();
              showNextPhoto();
            }}
          />
        )}
      </div>
    );
  }

  // Shared feedback modal — rendered from both the group-list screen and the
  // group detail screen (see call sites), so it's reachable from anywhere.
  // Public to anyone using the app (no login exists to gate it with): shows
  // everyone's submissions, paginated 10 at a time, with comments on each.
  // Persistent bottom nav shown on the 내 그룹 dashboard and inside a group.
  // 홈/캘린더 mirror whichever group tab is open; 그룹/설정 and the floating +
  // fall back to a "pick a group first" toast when there's no active group.
  // Shared so it can be opened from both the app-level 설정 screen (내 그룹
  // dashboard) and the per-group 그룹 관리 modal — reachable no matter which
  // "설정" the user happens to be looking at.
  function renderGuideModal() {
    if (!guideOpen) return null;
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.45)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 25,
        }}
        onClick={() => setGuideOpen(false)}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: "var(--surface-2)",
            borderRadius: 16,
            padding: "1.25rem 1.4rem",
            width: 340,
            maxWidth: "90vw",
            maxHeight: "85vh",
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <p style={{ fontWeight: 700, fontSize: 17, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 30, height: 30, borderRadius: "50%", background: "#EAF0FF", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <Info size={16} color="#4F7CFF" />
              </span>
              사용 가이드
            </p>
            <X size={22} color="var(--text-secondary)" style={{ cursor: "pointer" }} onClick={() => setGuideOpen(false)} />
          </div>

          {[
            {
              key: "start",
              title: "① 시작하기",
              gradient: "linear-gradient(90deg, #4F7CFF, #22C55E)",
              items: [
                { icon: "🔗", color: "#4F7CFF", title: "초대 링크로 접속하기", desc: "그룹장이 보내준 링크를 누르면 바로 그룹 화면으로 들어가요. 회원가입이나 앱 설치는 필요 없어요." },
                { icon: "👤", color: "#22C55E", title: "내 이름 선택하기", desc: "\"당신은 누구인가요?\" 화면에서 구성원 목록 중 본인 이름을 선택해요. 목록에 이름이 없으면 그룹장에게 추가해 달라고 하면 돼요." },
                { icon: "✨", color: "#FFB020", title: "(그룹장이라면) 새 그룹 만들기", desc: "가족 / 회사·팀 / 학급 / 직접 만들기 중 원하는 종류를 고르고, 그룹 이름을 입력하면 끝! 초대할 멤버 이름을 미리 등록해두면, 멤버들이 로그인 없이 이름만 클릭해서 바로 참여할 수 있어요." },
                { icon: "🔔", color: "#EC4899", title: "알림 켜기", desc: "화면 위 \"알림받기\" 배너를 누르면, 새 일정이 올라올 때마다 알림을 받을 수 있어요." },
              ],
            },
            {
              key: "use",
              title: "② 사용 방법",
              gradient: "linear-gradient(90deg, #8B5CF6, #EC4899)",
              items: [
                { icon: "✅", color: "#4F7CFF", title: "오늘 할일 확인하고 체크하기", desc: "홈 화면에서 오늘 할일과 공지를 보고 체크박스로 완료 표시를 해요. 못 끝낸 일은 다음 날로 넘길 수 있어요." },
                { icon: "➕", color: "#22C55E", title: "일정 추가하기", desc: "제목, 시간, 담당자, 색상, 장소, 사진까지 넣고 \"전체에게 공지\" 또는 \"나만 보기\"로 공개 범위를 정해요." },
                { icon: "📅", color: "#FFB020", title: "전체 캘린더 보기", desc: "월별 달력에서 날짜마다 컬러 점으로 일정과 메모를 한눈에 확인해요." },
                { icon: "📝", color: "#EC4899", title: "메모 남기기", desc: "체크박스 없는 자유 메모를 캘린더에 색깔까지 정해서 남길 수 있어요." },
                { icon: "📌", color: "#8B5CF6", title: "공유 일정 / 공유 메모 / 오늘 할일 메뉴", desc: "그룹 화면 상단 3개 메뉴에서 각 항목이 몇 건인지 바로 확인하고 이동해요." },
                { icon: "⚙️", color: "#4F7CFF", title: "그룹 관리하기", desc: "멤버 추가/삭제, 초대 링크·QR코드 공유, 그룹 알림 끄기, 피드백 보내기까지 할 수 있어요." },
                { icon: "🔔", color: "#22C55E", title: "최근 활동 확인하기", desc: "종 아이콘을 누르면 그룹 안에서 누가 무엇을 추가했는지 확인할 수 있어요." },
                { icon: "🌗", color: "#FFB020", title: "테마 설정하기", desc: "하단 탭바 \"설정\"에서 라이트/다크/시스템 테마를 고르고, 그룹별 내 프로필도 확인해요." },
              ],
            },
          ].map((section) => (
            <div key={section.key} style={{ marginBottom: 18 }}>
              <span
                style={{
                  display: "inline-block",
                  marginBottom: 10,
                  padding: "5px 14px",
                  borderRadius: 999,
                  background: section.gradient,
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {section.title}
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {section.items.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      gap: 10,
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "0.5px solid var(--border)",
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        background: "var(--surface-1)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        fontSize: 14,
                      }}
                    >
                      {item.icon}
                    </div>
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 700, margin: "0 0 2px", color: item.color }}>{item.title}</p>
                      <p style={{ fontSize: 12.5, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderBottomTabBar(activeKey) {
    const tabItemStyle = (isActive) => ({
      flex: 1,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 2,
      padding: "6px 0",
      color: isActive ? "var(--accent-primary)" : "var(--text-muted)",
      fontWeight: isActive ? 700 : 500,
      cursor: "pointer",
    });
    const needsGroupToast = () => {
      setToast({ message: "먼저 그룹을 선택해주세요", undo: null });
      setTimeout(() => setToast(null), 2000);
    };
    return (
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 20 }}>
        <div
          style={{
            maxWidth: 420,
            margin: "0 auto",
            position: "relative",
            display: "flex",
            alignItems: "center",
            background: "var(--surface-2)",
            borderTop: "0.5px solid var(--border)",
            padding: "8px 4px",
          }}
        >
          <div onClick={() => (view === "app" ? goToTab("home") : goToGroupsList())} style={tabItemStyle(activeKey === "home")}>
            <Home size={22} />
            <span style={{ fontSize: 11 }}>홈</span>
          </div>
          <div
            onClick={() => (view === "app" ? goToTab("calendar") : needsGroupToast())}
            style={tabItemStyle(activeKey === "calendar")}
          >
            <CalendarIcon size={22} />
            <span style={{ fontSize: 11 }}>캘린더</span>
          </div>
          <div style={{ flex: 1 }} />
          <div onClick={() => (view === "app" ? goToGroupsList() : null)} style={tabItemStyle(activeKey === "groups")}>
            <Users size={22} />
            <span style={{ fontSize: 11 }}>그룹</span>
          </div>
          <div
            onClick={() => (view === "app" ? openGroupSettings() : setAppSettingsOpen(true))}
            style={tabItemStyle(activeKey === "settings")}
          >
            <Settings size={22} />
            <span style={{ fontSize: 11 }}>설정</span>
          </div>
          <div
            onClick={() => {
              if (view === "app") {
                if (tab === "home") setShowAddTaskForm((p) => !p);
                else setShowCalendarAddTaskForm((p) => !p);
              } else {
                startCreate();
              }
            }}
            style={{
              position: "absolute",
              left: "50%",
              top: -18,
              transform: "translateX(-50%)",
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: "var(--accent-primary)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 10px rgba(0,0,0,0.25)",
              cursor: "pointer",
            }}
          >
            <Plus size={24} />
          </div>
        </div>
      </div>
    );
  }

  function renderFeedbackModal() {
    if (!feedbackOpen) return null;
    const totalPages = Math.max(1, Math.ceil(feedbackListTotal / 10));
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.45)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 25,
        }}
        onClick={closeFeedback}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: "var(--surface-2)",
            borderRadius: 16,
            padding: "1.25rem 1.4rem",
            width: 400,
            maxWidth: "90vw",
            maxHeight: "85vh",
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <p style={{ fontWeight: 600, fontSize: 17, margin: 0 }}>피드백</p>
            <X size={22} color="var(--text-secondary)" style={{ cursor: "pointer" }} onClick={closeFeedback} />
          </div>

          <p style={{ fontSize: 14, color: "var(--text-muted)", margin: "0 0 8px" }}>
            불편한 점, 버그, 건의사항을 자유롭게 남겨주세요.
          </p>
          <textarea
            value={feedbackText}
            onChange={(e) => {
              setFeedbackText(e.target.value);
              setFeedbackSubmitted(false);
            }}
            placeholder="여기에 입력해 주세요"
            rows={3}
            style={{ width: "100%", marginBottom: 8, resize: "vertical", fontFamily: "inherit" }}
          />
          {feedbackError && (
            <p style={{ fontSize: 14, color: "var(--text-danger)", margin: "0 0 8px" }}>{feedbackError}</p>
          )}
          {feedbackSubmitted && (
            <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "0 0 8px" }}>제출됐어요. 감사해요!</p>
          )}
          <button onClick={submitFeedback} disabled={feedbackBusy || !feedbackText.trim()} style={{ width: "100%", marginBottom: 16 }}>
            {feedbackBusy ? "보내는 중..." : "제출하기"}
          </button>

          <div style={{ borderTop: "0.5px solid var(--border)", paddingTop: 12 }}>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "0 0 8px" }}>
              다른 사람들이 남긴 피드백{feedbackListTotal > 0 ? ` (${feedbackListTotal}건)` : ""}
            </p>
            {feedbackListLoading && <p style={{ fontSize: 15, color: "var(--text-muted)", margin: 0 }}>불러오는 중...</p>}
            {feedbackListError && (
              <p style={{ fontSize: 14, color: "var(--text-danger)", margin: "0 0 8px" }}>{feedbackListError}</p>
            )}
            {!feedbackListLoading && feedbackList.length === 0 && (
              <p style={{ fontSize: 15, color: "var(--text-muted)", margin: 0 }}>아직 피드백이 없어요.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {feedbackList.map((f) => (
                <div key={f.id} style={{ border: "0.5px solid var(--border)", borderRadius: 8, padding: "10px 12px" }}>
                  <p style={{ fontSize: 15, whiteSpace: "pre-wrap", margin: "0 0 6px" }}>{f.message}</p>
                  <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 8px" }}>
                    {new Date(f.created_at).toLocaleString("ko-KR")}
                  </p>
                  {f.comments.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                      {f.comments.map((c) => (
                        <div key={c.id} style={{ background: "var(--surface-1)", borderRadius: 6, padding: "6px 8px" }}>
                          <p style={{ fontSize: 14, whiteSpace: "pre-wrap", margin: "0 0 2px" }}>{c.message}</p>
                          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                            {new Date(c.created_at).toLocaleString("ko-KR")}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      value={commentDrafts[f.id] || ""}
                      onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [f.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitComment(f.id);
                      }}
                      placeholder="댓글 달기"
                      style={{ flex: 1, minWidth: 0, fontSize: 14, padding: "6px 8px" }}
                    />
                    <button
                      onClick={() => submitComment(f.id)}
                      disabled={commentBusyId === f.id || !(commentDrafts[f.id] || "").trim()}
                      style={{ fontSize: 14, padding: "6px 10px" }}
                    >
                      등록
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {totalPages > 1 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 12 }}>
                <button
                  onClick={() => loadFeedbackList(feedbackPage - 1)}
                  disabled={feedbackPage <= 1 || feedbackListLoading}
                  style={{ fontSize: 14, padding: "6px 10px" }}
                >
                  이전
                </button>
                <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>
                  {feedbackPage} / {totalPages}
                </span>
                <button
                  onClick={() => loadFeedbackList(feedbackPage + 1)}
                  disabled={feedbackPage >= totalPages || feedbackListLoading}
                  style={{ fontSize: 14, padding: "6px 10px" }}
                >
                  다음
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function addDraftMember() {
    if (!newMemberName.trim()) return;
    const id = "m" + generateLocalId();
    setDraftMembers((prev) => [...prev, { id, name: newMemberName.trim(), tier: 0 }]);
    setNewMemberName("");
    setShowAddMember(false);
  }

  function removeDraftMember(memberId) {
    setDraftMembers((prev) => prev.filter((m) => m.id !== memberId));
  }

  function renameDraftMember(memberId, name) {
    setDraftMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, name } : m)));
  }

  function saveGroupSettings() {
    const removedIds = active.members.filter((m) => !draftMembers.some((dm) => dm.id === m.id)).map((m) => m.id);
    const trimmedName = draftGroupName.trim();
    const originalById = Object.fromEntries(active.members.map((m) => [m.id, m]));
    const trimmedMembers = draftMembers.map((m) => ({ ...m, name: m.name.trim() || originalById[m.id]?.name || m.name }));
    runGroupOp(
      { op: "updateGroupSettings", name: trimmedName, members: trimmedMembers },
      (g) => ({
        ...g,
        name: trimmedName || g.name,
        members: trimmedMembers,
        tasks: g.tasks.map((t) => (removedIds.includes(t.assignee) ? { ...t, assignee: null } : t)),
        events: g.events.map((e) => ({ ...e, assignees: e.assignees.filter((a) => !removedIds.includes(a)) })),
      })
    );
    setBookmarks((prev) => {
      const next = prev.map((b) => (b.id === activeId ? { ...b, name: trimmedName || b.name, memberCount: draftMembers.length } : b));
      saveBookmarks(next);
      return next;
    });
    closeGroupSettings();
  }

  // Per-browser preference layered on top of the shared event — set only in
  // local state (never sent as part of any group op), so it doesn't affect
  // what other people see.
  function toggleEventNotify(eventId) {
    const currentGroup = groups.find((g) => g.id === activeId);
    const currentEvent = currentGroup?.events.find((e) => e.id === eventId);
    const nextNotify = !currentEvent?.notify;
    setGroups((prev) =>
      prev.map((g) =>
        g.id !== activeId
          ? g
          : { ...g, events: g.events.map((e) => (e.id === eventId ? { ...e, notify: nextNotify } : e)) }
      )
    );
    saveNotifyPref(activeId, eventId, nextNotify);
  }

  function toggleTask(id) {
    const current = active?.tasks.find((t) => t.id === id);
    const nextDone = !current?.done;
    runGroupOp(
      { op: "toggleTaskDone", taskId: id, done: nextDone },
      (g) => ({ ...g, tasks: g.tasks.map((t) => (t.id === id ? { ...t, done: nextDone } : t)) })
    );
    setOpenTask((prev) => (prev && prev.id === id ? { ...prev, done: nextDone } : prev));
  }

  function toggleCarryOverSelection(id) {
    setCarryOverIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openTaskDetail(t) {
    setOpenTask(t);
    setDraftTitle(t.title);
    setDraftLocation(t.location || null);
    setDraftPhotos(t.photos || []);
    setDraftPrivate(!!t.private);
    setDraftAssignee(t.assignee || null);
    setDraftColor(t.color || TASK_COLORS[0]);
    const dayNum = taskDay(t);
    const monthNum = taskMonth(t);
    setDraftDueDate(
      monthNum && dayNum ? `${todayYear}-${String(monthNum).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}` : ""
    );
    setDraftDueTime(t.due.includes(" ") ? t.due.split(" ")[1] : "");
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
    let newDue = openTask.due;
    if (draftDueDate) {
      const [, m, d] = draftDueDate.split("-").map((v) => parseInt(v, 10));
      newDue = draftDueTime ? `${m}/${d} ${draftDueTime}` : `${m}/${d}`;
    } else if (draftDueTime) {
      const datePart = openTask.due.split(" ")[0];
      newDue = `${datePart} ${draftDueTime}`;
    }
    const newTitle = draftTitle.trim() || openTask.title;
    const patch = {
      title: newTitle,
      location: draftLocation,
      photos: draftPhotos,
      private: draftPrivate,
      assignee: draftAssignee,
      due: newDue,
      color: draftColor,
    };
    runGroupOp(
      { op: "editTask", taskId, patch },
      (g) => ({ ...g, tasks: g.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) })
    );
    closeTaskDetail();
  }

  function openEventDetail(e) {
    setOpenEvent(e);
  }

  function closeEventDetail() {
    setOpenEvent(null);
  }

  function taskDay(t) {
    const m = t.due.match(/\/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  function taskMonth(t) {
    const m = t.due.match(/^(\d+)\//);
    return m ? parseInt(m[1], 10) : null;
  }

  // Tasks only ever store month/day (no year), so "overdue" is just an
  // ordering within the current year — matches the rest of the date helpers
  // in this file (e.g. addDaysToYMD, the 다가오는 일정 window).
  function isTaskDueToday(t) {
    return taskMonth(t) === todayMonth && taskDay(t) === today;
  }

  function isTaskOverdue(t) {
    const m = taskMonth(t);
    const d = taskDay(t);
    if (m == null || d == null) return false;
    return m * 100 + d < todayMonth * 100 + today;
  }

  function deleteTask(task) {
    if (task.locked) {
      setToast({ message: "잠긴 항목은 삭제할 수 없어요", undo: null });
      setTimeout(() => setToast(null), 2500);
      return;
    }
    const deleterName = myMemberId ? memberById[myMemberId]?.name : null;
    runGroupOp({ op: "deleteTask", taskId: task.id }, (g) => ({ ...g, tasks: g.tasks.filter((t) => t.id !== task.id) }));
    setOpenTask(null);
    const timer = setTimeout(() => setToast(null), 4000);
    setToast({
      message: deleterName ? `"${task.title}" — ${deleterName}님이 삭제함` : `"${task.title}" 삭제됨`,
      undo: () => {
        clearTimeout(timer);
        runGroupOp(
          { op: "restoreTask", task },
          (g) => ({ ...g, tasks: [...g.tasks, task].sort((a, b) => a.id - b.id) })
        );
        setToast(null);
      },
    });
  }

  function goToPrevDay() {
    let prevDay = today - 1;
    let prevMonth = todayMonth;
    let prevYear = todayYear;
    if (prevDay < 1) {
      prevMonth = todayMonth - 1;
      if (prevMonth < 1) {
        prevMonth = 12;
        prevYear = todayYear - 1;
      }
      prevDay = new Date(prevYear, prevMonth, 0).getDate();
    }
    setToday(prevDay);
    setTodayMonth(prevMonth);
    setTodayYear(prevYear);
  }

  function carryOverToNextDay() {
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
    const dueById = new Map();
    (active?.tasks || []).forEach((t) => {
      if (t.done || !isTaskDueToday(t) || !carryOverIncluded.has(t.id)) return;
      const timePart = t.due.includes(" ") ? " " + t.due.split(" ")[1] : "";
      dueById.set(t.id, `${nextMonth}/${nextDay}${timePart}`);
    });
    const updates = Array.from(dueById, ([taskId, due]) => ({ taskId, due }));
    runGroupOp(
      { op: "bulkSetTaskDue", updates },
      (g) => ({ ...g, tasks: g.tasks.map((t) => (dueById.has(t.id) ? { ...t, due: dueById.get(t.id) } : t)) })
    );
    setToday(nextDay);
    setTodayMonth(nextMonth);
    setTodayYear(nextYear);
    setCarryOverIncluded(new Set());
  }

  function openCarryOverDatePicker() {
    setCarryOverTargetDate("");
    setCarryOverDatePickerOpen(true);
  }

  // Reschedules the checked tasks to a specific date the user picks (any day,
  // not just tomorrow), without moving the 오늘 할일 view itself — unlike
  // carryOverToNextDay, which is a same-day-forward rollover.
  function confirmCarryOverToDate() {
    if (!carryOverTargetDate) return;
    const [, targetMonth, targetDay] = carryOverTargetDate.split("-").map((v) => parseInt(v, 10));
    const dueById = new Map();
    (active?.tasks || []).forEach((t) => {
      if (t.done || !isTaskDueToday(t) || !carryOverIncluded.has(t.id)) return;
      const timePart = t.due.includes(" ") ? " " + t.due.split(" ")[1] : "";
      dueById.set(t.id, `${targetMonth}/${targetDay}${timePart}`);
    });
    const updates = Array.from(dueById, ([taskId, due]) => ({ taskId, due }));
    runGroupOp(
      { op: "bulkSetTaskDue", updates },
      (g) => ({ ...g, tasks: g.tasks.map((t) => (dueById.has(t.id) ? { ...t, due: dueById.get(t.id) } : t)) })
    );
    setCarryOverIncluded(new Set());
    setCarryOverDatePickerOpen(false);
    setCarryOverTargetDate("");
  }

  function addTask(dueMonth = todayMonth, dueDay = today) {
    if (!newTaskTitle.trim()) return false;
    const task = {
      id: generateLocalId(),
      title: newTaskTitle,
      assignee: newTaskBroadcast ? null : selectedAssignee || null,
      due: newTaskTime ? `${dueMonth}/${dueDay} ${newTaskTime}` : `${dueMonth}/${dueDay}`,
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
      color: newTaskColor,
    };
    const actorName = myMemberId ? memberById[myMemberId]?.name : null;
    runGroupOp({ op: "addTask", task, actorName }, (g) => ({ ...g, tasks: [...g.tasks, task] }));
    setNewTaskTitle("");
    setNewTaskTime("");
    setNewTaskColor(TASK_COLORS[0]);
    setNewTaskBroadcast(false);
    setNewTaskPrivate(false);
    setNewTaskPhotos([]);
    setShowNewTaskLocation(false);
    setNewTaskLocationName("");
    setNewTaskLocationAddress("");
    return true;
  }

  // Memos share the tasks list/table (no checkbox, no assignee) — a free-text
  // note pinned to a day, for things like "영희 8/10~8/15 휴가" that aren't a
  // to-do anyone completes.
  function addMemo(dueMonth, dueDay) {
    if (!newMemoTitle.trim()) return false;
    const memo = {
      id: generateLocalId(),
      title: newMemoTitle,
      due: `${dueMonth}/${dueDay}`,
      done: false,
      assignee: newMemoPrivate ? myMemberId : null,
      broadcast: newMemoBroadcast,
      private: newMemoPrivate,
      note: true,
      color: newMemoColor,
      photos: newMemoPhotos,
    };
    const actorName = myMemberId ? memberById[myMemberId]?.name : null;
    runGroupOp({ op: "addTask", task: memo, actorName }, (g) => ({ ...g, tasks: [...g.tasks, memo] }));
    setNewMemoTitle("");
    setNewMemoColor(TASK_COLORS[0]);
    setNewMemoBroadcast(false);
    setNewMemoPrivate(false);
    setNewMemoPhotos([]);
    return true;
  }

  // Photos on an existing memo save immediately (no staged draft + separate
  // "save" step like tasks have) because memo edits already autosave on
  // blur — routing photo adds through that same blur-triggered path would
  // race the native file picker, which blurs the title input the moment it
  // opens and can fire the save before a photo is even chosen.
  function addPhotoToMemo(memo, dataUrl) {
    const photos = [...(memo.photos || []), dataUrl];
    runGroupOp(
      { op: "editTask", taskId: memo.id, patch: { photos } },
      (g) => ({ ...g, tasks: g.tasks.map((t) => (t.id === memo.id ? { ...t, photos } : t)) })
    );
  }

  function removePhotoFromMemo(memo, index) {
    const photos = (memo.photos || []).filter((_, i) => i !== index);
    runGroupOp(
      { op: "editTask", taskId: memo.id, patch: { photos } },
      (g) => ({ ...g, tasks: g.tasks.map((t) => (t.id === memo.id ? { ...t, photos } : t)) })
    );
  }

  function startEditingMemo(memo) {
    setEditingMemoId(memo.id);
    setEditingMemoText(memo.title);
    setEditingMemoColor(memo.color || TASK_COLORS[0]);
    setEditingMemoBroadcast(!!memo.broadcast);
    setEditingMemoPrivate(!!memo.private);
  }

  function saveMemoEdit() {
    const taskId = editingMemoId;
    const title = editingMemoText.trim();
    setEditingMemoId(null);
    if (!title) return;
    const patch = {
      title,
      color: editingMemoColor,
      broadcast: editingMemoBroadcast,
      private: editingMemoPrivate,
      assignee: editingMemoPrivate ? myMemberId : null,
    };
    runGroupOp(
      { op: "editTask", taskId, patch },
      (g) => ({ ...g, tasks: g.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) })
    );
  }

  // Shared collapsible add-task/notice form — used on the home tab (defaults to
  // "today") and on the calendar tab (targets whichever day is selected there).
  function renderAddTaskForm(open, onToggle, onClose, dueMonth, dueDay) {
    return (
      <>
        <button
          onClick={onToggle}
          style={{
            width: "100%",
            marginBottom: open ? 10 : 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          {open ? (
            "접기"
          ) : (
            <>
              <Plus size={19} /> 일정추가
            </>
          )}
        </button>

        {open && (
          <>
            <input
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              placeholder="할일 또는 공지 내용을 입력하세요"
              autoFocus
              style={{ width: "100%", fontSize: 17, padding: "12px 12px", marginBottom: 8 }}
            />
            <div
              onClick={openTimePicker}
              style={{
                width: "100%",
                marginBottom: 10,
                padding: "8px 10px",
                borderRadius: 8,
                border: "0.5px solid var(--border)",
                background: "var(--surface-2)",
                color: newTaskTime ? "var(--text-primary)" : "var(--text-muted)",
                fontSize: 16,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                whiteSpace: "nowrap",
                boxSizing: "border-box",
              }}
            >
              {newTaskTime ? formatDisplayTime(newTaskTime) : "시간 선택"}
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
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>색상</span>
              {TASK_COLORS.map((c) => (
                <div
                  key={c}
                  onClick={() => setNewTaskColor(c)}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: c,
                    cursor: "pointer",
                    border: newTaskColor === c ? "2px solid var(--text-primary)" : "2px solid transparent",
                    boxShadow: "0 0 0 1px var(--border)",
                  }}
                />
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
              {newTaskPhotos.map((src, idx) => (
                <div key={idx} style={{ position: "relative", width: 40, height: 40 }}>
                  <img
                    src={src}
                    alt=""
                    onClick={() => openPhotoViewer(newTaskPhotos, idx)}
                    style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover", border: "0.5px solid var(--border)", cursor: "pointer" }}
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
                    <X size={13} />
                  </div>
                </div>
              ))}
              <button
                onClick={() => newTaskPhotoInputRef.current?.click()}
                style={{
                  fontSize: 14,
                  padding: "6px 10px",
                  background: "transparent",
                  border: "0.5px dashed var(--border-strong)",
                  color: "var(--text-secondary)",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Plus size={17} /> 사진 추가
              </button>
              <button
                onClick={() => setShowNewTaskLocation(true)}
                style={{
                  fontSize: 14,
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
                    <MapPin size={17} /> 주소 추가
                  </>
                )}
              </button>
            </div>
            <div style={{ display: "flex", gap: 16, marginBottom: 10, marginTop: -2 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15 }}>
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
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15 }}>
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
            <button
              onClick={() => {
                if (addTask(dueMonth, dueDay)) {
                  onClose();
                } else {
                  setToast({ message: "할일 또는 공지 내용을 입력해 주세요", undo: null });
                  setTimeout(() => setToast(null), 2500);
                }
              }}
              style={{ width: "100%", marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            >
              <Plus size={19} /> 추가
            </button>
          </>
        )}
      </>
    );
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

  const newMemoPhotoInputRef = useRef(null);

  function handleNewMemoPhotoFileChange(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setNewMemoPhotos((prev) => [...prev, reader.result]);
      };
      reader.readAsDataURL(file);
    });
  }

  // Editing an existing memo's photos saves immediately (see addPhotoToMemo),
  // so this only needs to remember which memo the file picker was opened
  // for — editingMemoId may already be cleared by the time the file is read
  // (the native picker blurs the title input, which autosaves the rest of
  // the edit and closes edit mode) but that doesn't affect this.
  const editingMemoPhotoInputRef = useRef(null);
  const editingMemoPhotoTargetRef = useRef(null);

  function handleEditingMemoPhotoClick(memo) {
    editingMemoPhotoTargetRef.current = memo;
    editingMemoPhotoInputRef.current?.click();
  }

  function handleEditingMemoPhotoFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const memo = editingMemoPhotoTargetRef.current;
    if (!file || !memo) return;
    const reader = new FileReader();
    reader.onload = () => {
      addPhotoToMemo(memo, reader.result);
    };
    reader.readAsDataURL(file);
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

  const [viewYear, setViewYear] = useState(() => now.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => now.getMonth() + 1); // 1-indexed

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
  // Events/tasks don't carry a year, so this is scoped to the viewed month only.
  const eventsOnDay = (d) => (active ? active.events.filter((e) => e.date === d) : []);
  const tasksOnDay = (d) =>
    active ? active.tasks.filter((t) => isTaskVisibleToMe(t) && taskMonth(t) === viewMonth && taskDay(t) === d) : [];
  const dayEvents = eventsOnDay(selectedDay);
  const dayTasks = tasksOnDay(selectedDay).filter((t) => !t.note);
  const dayMemos = tasksOnDay(selectedDay).filter((t) => t.note);
  const selectedLunarLabel = getLunarLabel(viewYear, viewMonth, selectedDay);

  if (recovering) {
    return (
      <div
        style={{
          fontFamily: "var(--font-sans)",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
        }}
      >
        <img src="/favicon.svg" alt="" className="loading-logo" style={{ width: 48, height: 46 }} />
        <p style={{ fontSize: 15, color: "var(--text-secondary)", margin: 0 }}>내 그룹 목록을 불러오는 중...</p>
      </div>
    );
  }

  // ---------- GROUP LIST ----------
  if (view === "groups") {
    return (
      <>
      <div style={{ fontFamily: "var(--font-sans)", maxWidth: 420, margin: "0 auto", paddingBottom: 90 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <p style={{ fontWeight: 700, fontSize: 19, margin: 0 }}>
              안녕하세요{dashboardGreetingName ? `, ${dashboardGreetingName}님` : ""} 👋
            </p>
            <p style={{ fontSize: 14, color: "var(--text-muted)", margin: "2px 0 0" }}>오늘도 좋은 하루 보내세요!</p>
          </div>
          <Bell
            size={22}
            color="var(--text-secondary)"
            style={{ cursor: "pointer" }}
            onClick={() => {
              setToast({ message: "그룹을 선택하면 그 그룹의 알림을 볼 수 있어요", undo: null });
              setTimeout(() => setToast(null), 2000);
            }}
          />
        </div>

        <div
          style={{
            background: "var(--accent-primary)",
            borderRadius: 16,
            padding: "1rem 1.1rem",
            marginBottom: 14,
            color: "#fff",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>오늘의 일정</span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                background: "rgba(255,255,255,0.25)",
                borderRadius: 20,
                padding: "1px 9px",
              }}
            >
              {todayScheduleItems.length}
            </span>
          </div>
          {todayScheduleItems.length === 0 ? (
            <p style={{ fontSize: 14, margin: 0, opacity: 0.9 }}>오늘 남은 일정이 없어요.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {todayScheduleItems.slice(0, 4).map(({ groupId, task }) => (
                <div key={`${groupId}-${task.id}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: task.color || "#fff",
                      flexShrink: 0,
                    }}
                  />
                  {task.due.includes(" ") && (
                    <span style={{ opacity: 0.85, minWidth: 42 }}>{task.due.split(" ")[1]}</span>
                  )}
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {task.title}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          {bookmarks.map((b) => (
            <div
              key={b.id}
              onClick={() => openGroup(b.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                background: "var(--surface-2)",
                border: "0.5px solid var(--border)",
                borderRadius: 12,
                padding: "12px 14px",
                cursor: "pointer",
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  background: b.accentBg,
                  color: b.accent,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Users size={21} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{b.name}</p>
                <p style={{ fontSize: 14, color: "var(--text-muted)", margin: 0 }}>{b.memberCount}명</p>
              </div>
              <ChevronRight size={20} color="var(--text-muted)" />
            </div>
          ))}
          {bookmarks.length === 0 && (
            <p style={{ fontSize: 15, color: "var(--text-muted)", margin: 0 }}>
              아직 만든 그룹이 없어요. 새로 만들거나, 공유받은 링크로 접속해 보세요.
            </p>
          )}
        </div>
        <button onClick={startCreate} style={{ width: "100%", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Plus size={19} /> 새 그룹 만들기
        </button>
        <button
          onClick={() => copyAppRootLink(`${window.location.origin}${withRecoveryParam("/")}`)}
          style={{
            width: "100%",
            marginBottom: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            background: "transparent",
            border: "0.5px solid var(--border)",
            color: "var(--text-secondary)",
          }}
        >
          <Share2 size={18} /> 내 그룹 목록 주소 복사하기
        </button>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px", textAlign: "center" }}>
          초대용 주소가 아니에요. 다른 기기나 새로 설치한 앱에서 이 주소를 열면 지금 이 목록을 그대로 불러올 수 있어요.
        </p>
        <button
          onClick={openFeedback}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            background: "transparent",
            border: "0.5px solid var(--border)",
            color: "var(--text-secondary)",
          }}
        >
          피드백 남기기
        </button>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "10px 0 0", textAlign: "center" }}>
          "내 그룹" 목록은 로그인 없이 이 기기에 저장돼요. 다른 기기에서도 보려면 위 "주소 복사하기"를 이용하세요.
        </p>
      </div>
      {renderBottomTabBar("home")}
      {renderFeedbackModal()}
      {appSettingsOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 25,
          }}
          onClick={() => setAppSettingsOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--surface-2)",
              borderRadius: 16,
              padding: "1.25rem 1.4rem",
              width: 340,
              maxWidth: "90vw",
              maxHeight: "85vh",
              overflowY: "auto",
              WebkitOverflowScrolling: "touch",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <p style={{ fontWeight: 700, fontSize: 17, margin: 0 }}>설정</p>
              <X size={22} color="var(--text-secondary)" style={{ cursor: "pointer" }} onClick={() => setAppSettingsOpen(false)} />
            </div>

            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 8px" }}>내 프로필 (그룹별)</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 18 }}>
              {bookmarks.map((b) => {
                const memberId = whoAmIMap[b.id];
                const cachedGroup = loadGroupCache()[b.id];
                const name = memberId ? cachedGroup?.members?.find((m) => m.id === memberId)?.name : null;
                return (
                  <div key={b.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14, padding: "6px 0" }}>
                    <span style={{ color: "var(--text-secondary)" }}>{b.name}</span>
                    <span style={{ color: name ? "var(--text-primary)" : "var(--text-muted)" }}>
                      {name || "선택 안 함"}
                    </span>
                  </div>
                );
              })}
              {bookmarks.length === 0 && (
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>아직 그룹이 없어요.</p>
              )}
            </div>

            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 8px" }}>테마 설정</p>
            <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
              {[
                { key: "light", label: "라이트" },
                { key: "dark", label: "다크" },
                { key: "system", label: "시스템 기본" },
              ].map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => chooseTheme(opt.key)}
                  style={{
                    flex: 1,
                    fontSize: 13,
                    padding: "8px 4px",
                    background: themeOverride === opt.key ? "var(--accent-primary)" : "transparent",
                    color: themeOverride === opt.key ? "var(--on-accent)" : "var(--text-secondary)",
                    border: themeOverride === opt.key ? "none" : "0.5px solid var(--border)",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 8px" }}>알림 설정</p>
            <div style={{ marginBottom: 18 }}>
              {bookmarks.filter((b) => pushSubscribedGroups[b.id]).length === 0 ? (
                <p style={{ fontSize: 14, color: "var(--text-muted)", margin: 0 }}>켜져 있는 그룹 알림이 없어요.</p>
              ) : (
                <>
                  {bookmarks
                    .filter((b) => pushSubscribedGroups[b.id])
                    .map((b) => (
                      <p key={b.id} style={{ fontSize: 14, margin: "0 0 4px", display: "flex", alignItems: "center", gap: 6 }}>
                        <Bell size={14} color="var(--accent-primary)" /> {b.name}
                      </p>
                    ))}
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "6px 0 0" }}>
                    끄고 싶으면 그 그룹의 설정에서 끌 수 있어요.
                  </p>
                </>
              )}
            </div>

            <div
              onClick={() => {
                setAppSettingsOpen(false);
                setGuideOpen(true);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 10,
                border: "0.5px solid var(--border)",
                cursor: "pointer",
                marginBottom: 18,
              }}
            >
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#EAF0FF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Info size={17} color="#4F7CFF" />
              </div>
              <span style={{ flex: 1, fontSize: 15 }}>사용 가이드</span>
              <ChevronRight size={18} color="var(--text-muted)" />
            </div>

            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 8px" }}>앱 정보</p>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14, marginBottom: 12 }}>
              <span style={{ color: "var(--text-secondary)" }}>버전</span>
              <span style={{ color: "var(--text-muted)" }}>v1.0.0</span>
            </div>
            <button
              onClick={() => {
                setAppSettingsOpen(false);
                openFeedback();
              }}
              style={{
                width: "100%",
                background: "transparent",
                border: "0.5px solid var(--border)",
                color: "var(--text-secondary)",
              }}
            >
              피드백 남기기
            </button>
          </div>
        </div>
      )}

      {renderGuideModal()}
      {renderPhotoViewer()}
      </>
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
              size={22}
              color="var(--text-secondary)"
              style={{ cursor: "pointer" }}
              onClick={goBack}
            />
            <p style={{ fontWeight: 600, fontSize: 17, margin: 0 }}>새 그룹 만들기</p>
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
                    <Users size={20} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{q.label}</p>
                    <p style={{ fontSize: 14, color: "var(--text-muted)", margin: 0 }}>
                      {key === "custom" ? "이름, 멤버를 자유롭게 정해요" : `예: ${q.defaultName}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {createStep === "name" && (
            <div>
              <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "0 0 6px" }}>그룹 이름</p>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="그룹 이름을 입력하세요"
                style={{ width: "100%", marginBottom: 16 }}
              />
              <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "0 0 6px" }}>내 이름 (그룹장)</p>
              <input
                value={newOwnerName}
                onChange={(e) => setNewOwnerName(e.target.value)}
                placeholder="예: 김민수 (입력하면 자동으로 나로 지정돼요)"
                style={{ width: "100%", marginBottom: 16 }}
              />
              <p style={{ fontSize: 14, color: "var(--text-muted)", margin: "0 0 16px" }}>
                만든 뒤에도 멤버 초대와 이름 변경은 언제든 가능해요. 생성되면 고유한 링크가 만들어지고, 그 링크로 들어오는
                사람은 누구나 같은 그룹을 함께 볼 수 있어요.
              </p>
              {createError && (
                <p style={{ fontSize: 14, color: "var(--text-danger)", margin: "0 0 12px" }}>{createError}</p>
              )}
              <button onClick={confirmCreate} disabled={createBusy} style={{ width: "100%" }}>
                {createBusy ? "만드는 중..." : "그룹 만들기"}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------- MAIN APP ----------
  if (!active) {
    return (
      <div style={{ fontFamily: "var(--font-sans)", maxWidth: 420, margin: "0 auto" }}>
        <div
          style={{
            background: "var(--surface-2)",
            borderRadius: 16,
            border: "0.5px solid var(--border)",
            padding: "1.1rem 1.25rem",
            textAlign: "center",
          }}
        >
          {groupLoading && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "14px 0" }}>
              <img src="/favicon.svg" alt="" className="loading-logo" style={{ width: 48, height: 46 }} />
              <p style={{ fontSize: 15, color: "var(--text-secondary)", margin: 0 }}>불러오는 중...</p>
            </div>
          )}
          {!groupLoading && groupLoadError === "not_found" && (
            <>
              <p style={{ fontSize: 15, color: "var(--text-secondary)", margin: "0 0 14px" }}>
                존재하지 않거나 삭제된 그룹이에요.
              </p>
              <button
                onClick={() => {
                  navigateToGroupsListUrl();
                  setView("groups");
                }}
                style={{ width: "100%" }}
              >
                내 그룹으로 돌아가기
              </button>
            </>
          )}
          {!groupLoading && groupLoadError === "network" && (
            <>
              <p style={{ fontSize: 15, color: "var(--text-secondary)", margin: "0 0 14px" }}>
                그룹을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
              </p>
              <button onClick={() => loadGroup(activeId)} style={{ width: "100%" }}>
                다시 시도
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
    <div style={{ fontFamily: "var(--font-sans)", maxWidth: 420, margin: "0 auto", paddingBottom: 90 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ChevronLeft size={21} color="var(--text-secondary)" style={{ cursor: "pointer" }} onClick={goBack} />
          <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>뒤로가기</span>
        </div>
        <span
          onClick={goToGroupsList}
          style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 14, color: "var(--text-secondary)", cursor: "pointer" }}
        >
          <Home size={17} /> 홈으로가기
        </span>
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
            <p style={{ fontWeight: 600, fontSize: 18, margin: 0 }}>{active.name}</p>
            <span style={{ fontSize: 13, background: active.accentBg, color: active.accent, padding: "2px 8px", borderRadius: 6 }}>
              {active.members.length}명
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Bell
              size={23}
              color={isPushSubscribed ? "#FFB020" : "var(--text-secondary)"}
              fill={isPushSubscribed ? "#FFB020" : "none"}
              style={{ cursor: "pointer" }}
              onClick={openActivityScreen}
              title={isPushSubscribed ? "알림 받는 중" : "알림"}
            />
            <Share2
              size={23}
              color="var(--text-secondary)"
              style={{ cursor: "pointer" }}
              onClick={shareGroupLink}
              title="그룹 초대/공유하기"
            />
            <Settings
              size={23}
              color="var(--text-secondary)"
              style={{ cursor: "pointer" }}
              onClick={openGroupSettings}
            />
          </div>
        </div>

        {pushSupported && (
          <div
            onClick={() => {
              if (pushBusy) return;
              isPushSubscribed ? unsubscribeFromPush() : subscribeToPush();
            }}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              marginBottom: 16,
              padding: "8px 10px",
              borderRadius: 8,
              border: `0.5px solid ${active.accent}`,
              background: isPushSubscribed ? active.accent : active.accentBg,
              color: isPushSubscribed ? "#fff" : active.accent,
              cursor: pushBusy ? "default" : "pointer",
              opacity: pushBusy ? 0.6 : 1,
            }}
          >
            <Bell size={18} style={{ flexShrink: 0, marginTop: 2 }} />
            <span style={{ fontSize: 14 }}>
              {pushBusy
                ? "설정 중..."
                : isPushSubscribed
                ? "알림이 켜져 있어요 (끄려면 클릭)"
                : "새 일정 알림을 받으려면 알림받기를 클릭해 주세요"}
            </span>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {active.members.map((m) => (
            <div key={m.id} style={{ textAlign: "center" }}>
              <div
                onClick={() => m.photo && openPhotoViewer([m.photo], 0)}
                style={{ width: 32, height: 32, margin: "0 auto", cursor: m.photo ? "pointer" : "default" }}
              >
                <Avatar tier={m.tier} photo={m.photo} size={32} />
              </div>
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", margin: "3px 0 0" }}>{m.name}</p>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16, fontSize: 14, color: "var(--text-secondary)" }}>
          <span>나:</span>
          <select
            value={myMemberId ?? ""}
            onChange={(e) => setWhoAmI(e.target.value || null)}
            style={{ fontSize: 14, padding: "2px 6px" }}
          >
            <option value="">선택 안 함</option>
            {active.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {[
            {
              key: "schedule",
              label: `${now.getMonth() + 1}월 공유 일정`,
              icon: CalendarIcon,
              color: "#4F7CFF",
              bg: "#E9F0FF",
              count: active.tasks.filter((t) => !t.note && !t.private).length + active.events.length,
              onClick: () => goToTab("calendar"),
            },
            {
              key: "memo",
              label: `${now.getMonth() + 1}월 공유 메모`,
              icon: StickyNote,
              color: "#8B5CF6",
              bg: "#F1EAFE",
              count: active.tasks.filter((t) => t.note && isTaskVisibleToMe(t)).length,
              onClick: () => setMemoListOpen(true),
            },
            {
              key: "todo",
              label: "오늘 할일",
              icon: Check,
              color: "#22C55E",
              bg: "#E4F9EC",
              count: active.tasks.filter((t) => !t.note && isTaskVisibleToMe(t) && isTaskDueToday(t) && !t.done).length,
              onClick: () => goToTab("home"),
            },
          ].map((item) => (
            <div
              key={item.key}
              onClick={item.onClick}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 10,
                border: "0.5px solid var(--border)",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: item.bg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <item.icon size={17} color={item.color} />
              </div>
              <span style={{ flex: 1, fontSize: 15 }}>{item.label}</span>
              <span style={{ fontSize: 14, color: "var(--text-muted)" }}>{item.count}건</span>
              <ChevronRight size={18} color="var(--text-muted)" />
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          <button
            onClick={() => goToTab("home")}
            style={{
              flex: 1,
              fontSize: 15,
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
            onClick={() => goToTab("calendar")}
            style={{
              flex: 1,
              fontSize: 15,
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

        {toast && (
          <div
            style={{
              position: "fixed",
              top: 16,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 30,
              width: "min(400px, 90vw)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "var(--text-primary)",
              color: "var(--surface-2)",
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 14,
              boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            }}
          >
            <span>{toast.message}</span>
            {toast.undo && (
              <span style={{ cursor: "pointer", fontWeight: 600, textDecoration: "underline" }} onClick={toast.undo}>
                되돌리기
              </span>
            )}
          </div>
        )}

        {shouldShowWhoAmIPrompt && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 25,
            }}
          >
            <div
              style={{
                background: "var(--surface-2)",
                borderRadius: 16,
                padding: "1.25rem 1.4rem",
                width: 340,
                maxWidth: "90vw",
                maxHeight: "85vh",
                overflowY: "auto",
                WebkitOverflowScrolling: "touch",
              }}
            >
              <p style={{ fontWeight: 600, fontSize: 17, margin: "0 0 8px" }}>당신은 누구인가요?</p>
              <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "0 0 14px" }}>
                본인의 이름을 클릭해 주세요.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                {active.members.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => pickWhoAmIFromPrompt(m.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      background: "transparent",
                      border: "0.5px solid var(--border)",
                      color: "var(--text-primary)",
                      padding: "8px 10px",
                      justifyContent: "flex-start",
                    }}
                  >
                    <Avatar tier={m.tier} photo={m.photo} size={28} />
                    <span style={{ fontSize: 15 }}>{m.name}</span>
                  </button>
                ))}
              </div>
              <span
                onClick={dismissWhoAmIPrompt}
                style={{ display: "block", textAlign: "center", fontSize: 13, color: "var(--text-muted)", cursor: "pointer" }}
              >
                나중에 선택할게요
              </span>
            </div>
          </div>
        )}

        {tab === "home" && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", rowGap: 6, marginBottom: 4 }}>
              <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: 0, display: "flex", alignItems: "center", gap: 5 }}>
                <Check size={18} color="#22C55E" /> {todayMonth}월 {today}일 할일 / 공지
              </p>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={goToPrevDay}
                  style={{ fontSize: 13, padding: "4px 8px", background: "transparent", border: "0.5px solid var(--border)", color: "var(--text-secondary)" }}
                >
                  ← 전날로
                </button>
                <button
                  onClick={carryOverToNextDay}
                  style={{ fontSize: 13, padding: "4px 8px", background: "transparent", border: "0.5px solid var(--border)", color: "var(--text-secondary)" }}
                >
                  다음 날로 넘기기 →
                </button>
              </div>
            </div>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 8px" }}>
              완료 안 된 할일은 다음 날로 넘기면 자동 이월돼요. 자물쇠는 나만 보기(또는 잠긴 항목)를 뜻해요.
            </p>
            {carryOverIncluded.size > 0 && (
              <button
                onClick={openCarryOverDatePicker}
                style={{
                  width: "100%",
                  marginBottom: 10,
                  background: "transparent",
                  border: `0.5px solid ${active.accent}`,
                  color: active.accent,
                }}
              >
                선택한 {carryOverIncluded.size}개 일정을 다른 날짜로 옮기기 →
              </button>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              {active.tasks
                .filter((t) => !t.note && isTaskVisibleToMe(t) && (isTaskDueToday(t) || (t.broadcast && !t.done && isTaskOverdue(t))))
                .map((t) => (
                <div
                  key={t.id}
                  onClick={() => openTaskDetail(t)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    border: t.broadcast ? `1px solid ${active.accent}` : "0.5px solid var(--border)",
                    background: t.broadcast ? active.accentBg : "transparent",
                    borderRadius: 8,
                    padding: "8px 10px",
                    cursor: "pointer",
                    opacity: t.private ? 0.85 : 1,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span
                      style={{ width: 9, height: 9, borderRadius: "50%", background: t.color || active.accent, flexShrink: 0 }}
                    />
                    <input type="checkbox" checked={t.done} onClick={(e) => e.stopPropagation()} onChange={() => toggleTask(t.id)} />
                    {t.broadcast && <Megaphone size={20} color={active.accent} />}
                    <span style={{ fontSize: 13, color: t.broadcast ? active.accent : "var(--text-muted)" }}>
                      {t.broadcast ? "전체 공지" : t.private ? "나만 보기" : memberById[t.assignee]?.name}
                    </span>
                    {(t.private || t.locked) && <Lock size={17} color="var(--text-muted)" />}
                    {t.location && <MapPin size={18} color="var(--text-muted)" />}
                    {t.due.includes(" ") && <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{t.due.split(" ")[1]}</span>}
                    <div style={{ flex: 1 }} />
                    {!t.broadcast && !t.private && t.assignee && (
                      <Avatar tier={memberById[t.assignee]?.tier ?? 0} size={18} photo={memberById[t.assignee]?.photo} />
                    )}
                    {!t.done && isTaskDueToday(t) && (
                      <input
                        type="checkbox"
                        checked={carryOverIncluded.has(t.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleCarryOverSelection(t.id)}
                        title="다음 날로 넘기기 선택"
                      />
                    )}
                    {confirmDeleteTaskId === t.id ? (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{ display: "flex", alignItems: "center", gap: 6 }}
                      >
                        <span style={{ fontSize: 13, color: "var(--text-danger)" }}>삭제할까요?</span>
                        <button
                          onClick={() => {
                            deleteTask(t);
                            setConfirmDeleteTaskId(null);
                          }}
                          style={{ fontSize: 13, padding: "4px 8px", background: "var(--text-danger)", color: "#fff", border: "none" }}
                        >
                          삭제
                        </button>
                        <button
                          onClick={() => setConfirmDeleteTaskId(null)}
                          style={{ fontSize: 13, padding: "4px 8px", background: "transparent", border: "0.5px solid var(--border)", color: "var(--text-secondary)" }}
                        >
                          취소
                        </button>
                      </div>
                    ) : (
                      <Trash2
                        size={18}
                        color="var(--text-muted)"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteTaskId(t.id);
                        }}
                      />
                    )}
                  </div>
                  <span
                    style={{
                      fontSize: 16,
                      paddingLeft: 26,
                      color: t.done ? "var(--text-muted)" : "var(--text-primary)",
                      textDecoration: t.done ? "line-through" : "none",
                    }}
                  >
                    {t.title}
                  </span>
                </div>
              ))}
              {active.tasks.filter((t) => !t.note && isTaskVisibleToMe(t) && (isTaskDueToday(t) || (t.broadcast && !t.done && isTaskOverdue(t)))).length === 0 && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 6,
                    padding: "20px 0",
                    color: "var(--text-muted)",
                  }}
                >
                  <PartyPopper size={32} color={active.accent} />
                  <p style={{ fontSize: 15, fontWeight: 600, margin: 0, color: "var(--text-secondary)" }}>
                    오늘은 남은 할일이 없어요!
                  </p>
                  <p style={{ fontSize: 13, margin: 0 }}>모두 완료했어요, 정말 대단해요 🎉</p>
                </div>
              )}
            </div>

            {renderAddTaskForm(
              showAddTaskForm,
              () => setShowAddTaskForm((prev) => !prev),
              () => setShowAddTaskForm(false),
              todayMonth,
              today
            )}

            <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "0 0 8px", display: "flex", alignItems: "center", gap: 5 }}>
              <CalendarIcon size={18} color="#4F7CFF" /> 다가오는 일정
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {upcomingItems.length === 0 && (
                <p style={{ fontSize: 15, color: "var(--text-muted)", margin: 0 }}>다가오는 일정이 없어요.</p>
              )}
              {upcomingItems.map((item) =>
                item.kind === "task" ? (
                  <div
                    key={`task-${item.id}`}
                    onClick={() => openTaskDetail(item.data)}
                    style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, cursor: "pointer" }}
                  >
                    <div style={{ width: 34, textAlign: "center", fontSize: 13, color: "var(--text-secondary)" }}>
                      {item.month}/{item.day}
                    </div>
                    <span
                      style={{ width: 8, height: 8, borderRadius: "50%", background: item.data.color || active.accent, flexShrink: 0 }}
                    />
                    {item.data.broadcast && <Megaphone size={18} color={active.accent} />}
                    <div style={{ flex: 1 }}>{item.data.title}</div>
                    {!item.data.broadcast && !item.data.private && item.data.assignee && (
                      <Avatar tier={memberById[item.data.assignee]?.tier ?? 0} size={18} photo={memberById[item.data.assignee]?.photo} />
                    )}
                  </div>
                ) : (
                  <div
                    key={`event-${item.id}`}
                    onClick={() => {
                      setViewYear(todayYear);
                      setViewMonth(todayMonth);
                      setSelectedDay(item.data.date);
                      goToTab("calendar");
                    }}
                    style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, cursor: "pointer" }}
                  >
                    <div style={{ width: 34, textAlign: "center", fontSize: 13, color: "var(--text-secondary)" }}>
                      {item.month}/{item.day}
                    </div>
                    <span
                      style={{ width: 8, height: 8, borderRadius: "50%", background: active.accent, flexShrink: 0 }}
                    />
                    <div style={{ flex: 1 }}>{item.data.title}</div>
                    <Bell
                      size={17}
                      color={item.data.notify ? active.accent : "var(--border-strong)"}
                      fill={item.data.notify ? active.accent : "none"}
                      style={{ cursor: "pointer", opacity: item.data.notify ? 1 : 0.6 }}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        toggleEventNotify(item.data.id);
                      }}
                    />
                  </div>
                )
              )}
            </div>

            <button onClick={() => goToTab("calendar")} style={{ width: "100%" }}>
              전체 일정 보기
            </button>
          </>
        )}

        {tab === "calendar" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <ChevronLeft size={21} color="var(--text-secondary)" style={{ cursor: "pointer" }} onClick={goPrevMonth} />
              <p style={{ fontWeight: 600, fontSize: 16, margin: 0 }}>{viewYear}년 {viewMonth}월</p>
              <ChevronRight size={21} color="var(--text-secondary)" style={{ cursor: "pointer" }} onClick={goNextMonth} />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7,minmax(0,1fr))",
                gap: 2,
                fontSize: 12,
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
                if (!d) return <div key={i} style={{ height: 72 }} />;
                const dayTasksForDot = tasksOnDay(d).filter((t) => !t.note);
                const dayMemosForDot = tasksOnDay(d).filter((t) => t.note);
                const dotColors = [
                  ...dayTasksForDot.map((t) => t.color || active.accent),
                  ...eventsOnDay(d).map(() => active.accent),
                ];
                const memoColors = dayMemosForDot.map((m) => m.color || "#8B5CF6");
                const isSelected = d === selectedDay;
                return (
                  <div
                    key={i}
                    onClick={() => {
                      setSelectedDay(d);
                      setShowCalendarAddTaskForm(false);
                    }}
                    style={{
                      height: 72,
                      border: isSelected ? `1px solid ${active.accent}` : "0.5px solid var(--border)",
                      background: isSelected ? active.accentBg : "transparent",
                      borderRadius: 6,
                      padding: 3,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ color: isSelected ? active.accent : "var(--text-primary)", fontWeight: isSelected ? 700 : 500 }}>{d}</div>
                    {dotColors.length > 0 && (
                      <div style={{ display: "flex", gap: 3, marginTop: 4, alignItems: "center", flexWrap: "wrap" }}>
                        {dotColors.slice(0, 4).map((c, idx) => (
                          <span
                            key={idx}
                            style={{ width: 6, height: 6, borderRadius: "50%", background: c, display: "inline-block", flexShrink: 0 }}
                          />
                        ))}
                        {dotColors.length > 4 && (
                          <span style={{ fontSize: 9, color: "var(--text-muted)" }}>+{dotColors.length - 4}</span>
                        )}
                      </div>
                    )}
                    {memoColors.length > 0 && (
                      <div style={{ display: "flex", gap: 3, marginTop: 3, alignItems: "center", flexWrap: "wrap" }}>
                        {memoColors.slice(0, 3).map((c, idx) => (
                          <span
                            key={idx}
                            style={{ width: 6, height: 6, borderRadius: "50%", background: c, display: "inline-block", flexShrink: 0 }}
                          />
                        ))}
                        {memoColors.length > 3 && (
                          <span style={{ fontSize: 9, color: "var(--text-muted)" }}>+{memoColors.length - 3}</span>
                        )}
                        <span style={{ fontSize: 9, color: "var(--text-muted)" }}>메</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 14, borderTop: "0.5px solid var(--border)", paddingTop: 10 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{viewMonth}월 {selectedDay}일</p>
                {selectedLunarLabel && <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{selectedLunarLabel}</span>}
              </div>
              {dayEvents.length === 0 && dayTasks.length === 0 && dayMemos.length === 0 && (
                <p style={{ fontSize: 14, color: "var(--text-muted)", margin: 0 }}>일정이 없어요.</p>
              )}
              {dayEvents.map((e) => (
                <div
                  key={"e" + e.id}
                  onClick={() => openEventDetail(e)}
                  style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, marginBottom: 6, cursor: "pointer" }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: active.accent, flexShrink: 0 }} />
                  {e.time && <span style={{ fontSize: 13, color: "var(--text-muted)", minWidth: 42 }}>{e.time}</span>}
                  <span style={{ flex: 1 }}>{e.title}</span>
                  <Avatar tier={memberById[e.assignees[0]]?.tier ?? 0} size={20} photo={memberById[e.assignees[0]]?.photo} />
                </div>
              ))}
              {dayTasks.map((t) => (
                <div
                  key={"t" + t.id}
                  onClick={() => openTaskDetail(t)}
                  style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, marginBottom: 6, cursor: "pointer" }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: t.color || active.accent, flexShrink: 0 }} />
                  {t.due.includes(" ") && (
                    <span style={{ fontSize: 13, color: "var(--text-muted)", minWidth: 42 }}>{t.due.split(" ")[1]}</span>
                  )}
                  <span
                    style={{
                      flex: 1,
                      textDecoration: t.done ? "line-through" : "none",
                      color: t.done ? "var(--text-muted)" : "var(--text-primary)",
                    }}
                  >
                    {t.title}
                  </span>
                  {t.broadcast && <Megaphone size={16} color={active.accent} />}
                  {t.private && <Lock size={14} color="var(--text-muted)" />}
                  {t.location && <MapPin size={14} color="var(--text-muted)" />}
                  <input
                    type="checkbox"
                    checked={t.done}
                    onClick={(ev) => ev.stopPropagation()}
                    onChange={() => toggleTask(t.id)}
                  />
                </div>
              ))}
              {dayMemos.map((m) => (
                <div
                  key={"m" + m.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    fontSize: 14,
                    marginBottom: 4,
                    padding: "6px 8px",
                    borderRadius: 6,
                    background: "var(--surface-1)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <StickyNote size={16} color={m.color || "var(--text-muted)"} style={{ flexShrink: 0 }} />
                  {editingMemoId === m.id ? (
                    <input
                      autoFocus
                      value={editingMemoText}
                      onChange={(e) => setEditingMemoText(e.target.value)}
                      onBlur={saveMemoEdit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setEditingMemoId(null);
                      }}
                      style={{ flex: 1, minWidth: 0, fontSize: 14, padding: "4px 6px" }}
                    />
                  ) : (
                    <span
                      onClick={() => startEditingMemo(m)}
                      style={{ flex: 1, color: "var(--text-secondary)", cursor: "pointer" }}
                    >
                      {m.title}
                    </span>
                  )}
                  <Trash2 size={16} color="var(--text-muted)" style={{ cursor: "pointer" }} onClick={() => deleteTask(m)} />
                  </div>
                  {editingMemoId === m.id && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 24, flexWrap: "wrap" }}>
                      {TASK_COLORS.map((c) => (
                        <div
                          key={c}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => setEditingMemoColor(c)}
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: "50%",
                            background: c,
                            cursor: "pointer",
                            border: editingMemoColor === c ? "2px solid var(--text-primary)" : "2px solid transparent",
                            boxShadow: "0 0 0 1px var(--border)",
                          }}
                        />
                      ))}
                    </div>
                  )}
                  {((m.photos && m.photos.length > 0) || editingMemoId === m.id) && (
                    <div style={{ display: "flex", gap: 6, paddingLeft: 24, flexWrap: "wrap" }}>
                      {(m.photos || []).map((src, idx) => (
                        <div key={idx} style={{ position: "relative", width: 40, height: 40 }}>
                          <img
                            src={src}
                            alt=""
                            onClick={() => openPhotoViewer(m.photos, idx)}
                            style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover", border: "0.5px solid var(--border)", cursor: "pointer" }}
                          />
                          {editingMemoId === m.id && (
                            <div
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => removePhotoFromMemo(m, idx)}
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
                              <X size={11} />
                            </div>
                          )}
                        </div>
                      ))}
                      {editingMemoId === m.id && (
                        <div
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleEditingMemoPhotoClick(m)}
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 6,
                            border: "1px dashed var(--border-strong)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                          }}
                        >
                          <Plus size={17} color="var(--text-muted)" />
                        </div>
                      )}
                    </div>
                  )}
                  {editingMemoId === m.id && (
                    <div style={{ display: "flex", gap: 12, paddingLeft: 24, flexWrap: "wrap" }}>
                      <label
                        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        <input
                          type="checkbox"
                          checked={editingMemoBroadcast}
                          onChange={(e) => {
                            setEditingMemoBroadcast(e.target.checked);
                            if (e.target.checked) setEditingMemoPrivate(false);
                          }}
                        />
                        전체 공지
                      </label>
                      <label
                        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        <input
                          type="checkbox"
                          checked={editingMemoPrivate}
                          onChange={(e) => {
                            setEditingMemoPrivate(e.target.checked);
                            if (e.target.checked) setEditingMemoBroadcast(false);
                          }}
                        />
                        나만 보기
                      </label>
                    </div>
                  )}
                </div>
              ))}
              <div style={{ marginTop: 10 }}>
                {renderAddTaskForm(
                  showCalendarAddTaskForm,
                  () => setShowCalendarAddTaskForm((prev) => !prev),
                  () => setShowCalendarAddTaskForm(false),
                  viewMonth,
                  selectedDay
                )}
              </div>
              <div style={{ marginTop: 6 }}>
                <button
                  onClick={() => setShowMemoForm((prev) => !prev)}
                  style={{
                    width: "100%",
                    marginBottom: showMemoForm ? 10 : 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    background: "transparent",
                    border: "0.5px solid var(--border)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {showMemoForm ? "접기" : (
                    <>
                      <StickyNote size={17} /> 메모 추가
                    </>
                  )}
                </button>
                {showMemoForm && (
                  <div>
                    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                      <input
                        value={newMemoTitle}
                        onChange={(e) => setNewMemoTitle(e.target.value)}
                        placeholder="예: 영희 8/10~8/15 휴가"
                        style={{ flex: 1, minWidth: 0 }}
                      />
                      <button
                        onClick={() => {
                          if (addMemo(viewMonth, selectedDay)) setShowMemoForm(false);
                        }}
                      >
                        추가
                      </button>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                      <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>색상</span>
                      {TASK_COLORS.map((c) => (
                        <div
                          key={c}
                          onClick={() => setNewMemoColor(c)}
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: "50%",
                            background: c,
                            cursor: "pointer",
                            border: newMemoColor === c ? "2px solid var(--text-primary)" : "2px solid transparent",
                            boxShadow: "0 0 0 1px var(--border)",
                          }}
                        />
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                      {newMemoPhotos.map((src, idx) => (
                        <div key={idx} style={{ position: "relative", width: 40, height: 40 }}>
                          <img
                            src={src}
                            alt=""
                            onClick={() => openPhotoViewer(newMemoPhotos, idx)}
                            style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover", border: "0.5px solid var(--border)", cursor: "pointer" }}
                          />
                          <div
                            onClick={() => setNewMemoPhotos((prev) => prev.filter((_, i) => i !== idx))}
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
                            <X size={11} />
                          </div>
                        </div>
                      ))}
                      <button
                        onClick={() => newMemoPhotoInputRef.current?.click()}
                        style={{
                          fontSize: 14,
                          padding: "6px 10px",
                          background: "transparent",
                          border: "0.5px dashed var(--border-strong)",
                          color: "var(--text-secondary)",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <Plus size={17} /> 사진 추가
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 16 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15 }}>
                        <input
                          type="checkbox"
                          checked={newMemoBroadcast}
                          onChange={(e) => {
                            setNewMemoBroadcast(e.target.checked);
                            if (e.target.checked) setNewMemoPrivate(false);
                          }}
                        />
                        전체에게 공지로 보내기
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15 }}>
                        <input
                          type="checkbox"
                          checked={newMemoPrivate}
                          onChange={(e) => {
                            setNewMemoPrivate(e.target.checked);
                            if (e.target.checked) setNewMemoBroadcast(false);
                          }}
                        />
                        나만 보기
                      </label>
                    </div>
                  </div>
                )}
              </div>
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

      <input
        ref={newMemoPhotoInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={handleNewMemoPhotoFileChange}
      />

      <input
        ref={editingMemoPhotoInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleEditingMemoPhotoFileChange}
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
            zIndex: 25,
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
              maxHeight: "85vh",
              overflowY: "auto",
              WebkitOverflowScrolling: "touch",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <p style={{ fontWeight: 600, fontSize: 17, margin: 0 }}>시간 선택</p>
              <X size={22} color="var(--text-secondary)" style={{ cursor: "pointer" }} onClick={() => setTimePickerOpen(false)} />
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

      {carryOverDatePickerOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 25,
          }}
          onClick={() => setCarryOverDatePickerOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--surface-2)",
              borderRadius: 16,
              padding: "1.25rem 1.4rem",
              width: 280,
              maxWidth: "90vw",
              maxHeight: "85vh",
              overflowY: "auto",
              WebkitOverflowScrolling: "touch",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <p style={{ fontWeight: 600, fontSize: 17, margin: 0 }}>날짜 선택</p>
              <X
                size={22}
                color="var(--text-secondary)"
                style={{ cursor: "pointer" }}
                onClick={() => setCarryOverDatePickerOpen(false)}
              />
            </div>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "0 0 12px" }}>
              체크한 {carryOverIncluded.size}개 일정을 옮길 날짜를 골라주세요.
            </p>
            <input
              type="date"
              value={carryOverTargetDate}
              onChange={(e) => setCarryOverTargetDate(e.target.value)}
              style={{ width: "100%", marginBottom: 20 }}
            />
            <button onClick={confirmCarryOverToDate} disabled={!carryOverTargetDate} style={{ width: "100%" }}>
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
            zIndex: 25,
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
              maxHeight: "85vh",
              overflowY: "auto",
              WebkitOverflowScrolling: "touch",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <p style={{ fontWeight: 600, fontSize: 17, margin: 0 }}>장소 검색</p>
              <X
                size={22}
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
              <input value={newTaskLocationAddress} readOnly placeholder="주소 검색으로 입력돼요" style={{ flex: 1, minWidth: 0 }} />
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
            zIndex: 26,
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
              maxHeight: "85vh",
              overflowY: "auto",
              WebkitOverflowScrolling: "touch",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <p style={{ fontWeight: 600, fontSize: 17, margin: 0 }}>{draftLocation ? "장소 수정" : "장소 검색"}</p>
              <X
                size={22}
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
              <input value={taskLocationAddress} readOnly placeholder="주소 검색으로 입력돼요 (선택)" style={{ flex: 1, minWidth: 0 }} />
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
            zIndex: 25,
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
              maxHeight: "85vh",
              overflowY: "auto",
              WebkitOverflowScrolling: "touch",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 12,
                    background: active.accentBg,
                    color: active.accent,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Users size={20} />
                </div>
                <p style={{ fontWeight: 700, fontSize: 17, margin: 0 }}>그룹 관리</p>
              </div>
              <X size={22} color="var(--text-secondary)" style={{ cursor: "pointer" }} onClick={closeGroupSettings} />
            </div>

            <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "0 0 6px" }}>그룹 이름</p>
            <input
              value={draftGroupName}
              onChange={(e) => setDraftGroupName(e.target.value)}
              placeholder="그룹 이름을 입력하세요"
              style={{ width: "100%", marginBottom: 16 }}
            />

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              <div
                onClick={shareGroupLink}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "0.5px solid var(--border)",
                  cursor: "pointer",
                }}
              >
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#E9F0FF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Share2 size={17} color="#4F7CFF" />
                </div>
                <span style={{ flex: 1, fontSize: 15 }}>그룹 초대/공유하기</span>
                <ChevronRight size={18} color="var(--text-muted)" />
              </div>
              {pushSupported && isPushSubscribed && (
                <div
                  onClick={() => !pushBusy && unsubscribeFromPush()}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "0.5px solid var(--border)",
                    cursor: pushBusy ? "default" : "pointer",
                    opacity: pushBusy ? 0.6 : 1,
                  }}
                >
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#FFF4E0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Bell size={17} color="#FFB020" />
                  </div>
                  <span style={{ flex: 1, fontSize: 15 }}>{pushBusy ? "해제 중..." : "이 그룹 공지 알림 끄기"}</span>
                </div>
              )}
              <div
                onClick={openFeedback}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "0.5px solid var(--border)",
                  cursor: "pointer",
                }}
              >
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#FDEAF3", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <StickyNote size={17} color="#EC4899" />
                </div>
                <span style={{ flex: 1, fontSize: 15 }}>피드백 남기기</span>
                <ChevronRight size={18} color="var(--text-muted)" />
              </div>
              <div
                onClick={() => {
                  setGroupSettingsOpen(false);
                  setGuideOpen(true);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "0.5px solid var(--border)",
                  cursor: "pointer",
                }}
              >
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#EAF0FF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Info size={17} color="#4F7CFF" />
                </div>
                <span style={{ flex: 1, fontSize: 15 }}>사용 가이드</span>
                <ChevronRight size={18} color="var(--text-muted)" />
              </div>
            </div>

            <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "0 0 8px" }}>구성원 ({draftMembers.length}명)</p>
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
                  <div
                    onClick={() => handleAvatarClick(m.id)}
                    style={{ position: "relative", width: 28, height: 28, flexShrink: 0, cursor: "pointer" }}
                    title="사진 업로드"
                  >
                    <Avatar tier={m.tier} photo={m.photo} size={28} />
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
                      <Camera size={10} />
                    </div>
                  </div>
                  <input
                    value={m.name}
                    onChange={(e) => renameDraftMember(m.id, e.target.value)}
                    style={{ flex: 1, minWidth: 0, fontSize: 16, padding: "6px 8px" }}
                  />
                  {(isGroupOwner || m.id === myMemberId) &&
                    (confirmRemoveMemberId === m.id ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 14, color: "var(--text-danger)" }}>삭제할까요?</span>
                        <button
                          onClick={() => {
                            removeDraftMember(m.id);
                            setConfirmRemoveMemberId(null);
                          }}
                          style={{ fontSize: 14, padding: "4px 8px", background: "var(--text-danger)", color: "#fff", border: "none" }}
                        >
                          삭제
                        </button>
                        <button
                          onClick={() => setConfirmRemoveMemberId(null)}
                          style={{ fontSize: 14, padding: "4px 8px", background: "transparent", border: "0.5px solid var(--border)", color: "var(--text-secondary)" }}
                        >
                          취소
                        </button>
                      </div>
                    ) : (
                      <Trash2
                        size={20}
                        color="var(--text-danger)"
                        style={{ cursor: "pointer" }}
                        onClick={() => setConfirmRemoveMemberId(m.id)}
                      />
                    ))}
                </div>
              ))}
              {draftMembers.length === 0 && (
                <p style={{ fontSize: 14, color: "var(--text-muted)", margin: "8px 0" }}>구성원이 없어요.</p>
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
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button onClick={addDraftMember}>추가</button>
              </div>
            ) : (
              <button
                onClick={() => setShowAddMember(true)}
                style={{ width: "100%", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <Plus size={19} /> 멤버 추가
              </button>
            )}

            <button onClick={saveGroupSettings} style={{ width: "100%" }}>
              수정 완료
            </button>

            {isGroupOwner && (
            <div style={{ borderTop: "0.5px solid var(--border)", marginTop: 16, paddingTop: 12 }}>
              {!deleteConfirmOpen ? (
                <button
                  onClick={() => setDeleteConfirmOpen(true)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    background: "transparent",
                    border: "0.5px solid var(--border)",
                    color: "var(--text-danger)",
                  }}
                >
                  <Trash2 size={18} /> 그룹 삭제
                </button>
              ) : (
                <>
                  <p style={{ fontSize: 14, color: "var(--text-danger)", margin: "0 0 8px" }}>
                    삭제하면 이 그룹의 할일·일정·멤버가 전부 사라지고 되돌릴 수 없어요. 계속하려면 "{DELETE_CONFIRM_PHRASE}"를 입력하세요.
                  </p>
                  <input
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder={DELETE_CONFIRM_PHRASE}
                    style={{ width: "100%", marginBottom: 8 }}
                  />
                  {deleteError && (
                    <p style={{ fontSize: 14, color: "var(--text-danger)", margin: "0 0 8px" }}>{deleteError}</p>
                  )}
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => {
                        setDeleteConfirmOpen(false);
                        setDeleteConfirmText("");
                        setDeleteError(null);
                      }}
                      style={{ flex: 1, background: "transparent", border: "0.5px solid var(--border)", color: "var(--text-secondary)" }}
                    >
                      취소
                    </button>
                    <button
                      onClick={confirmDeleteGroup}
                      disabled={!deleteNameMatches() || deleteBusy}
                      style={{
                        flex: 1,
                        background: "var(--text-danger)",
                        color: "#fff",
                        border: "none",
                        opacity: !deleteNameMatches() ? 0.4 : 1,
                        cursor: !deleteNameMatches() ? "not-allowed" : "pointer",
                      }}
                    >
                      {deleteBusy ? "삭제 중..." : "삭제"}
                    </button>
                  </div>
                </>
              )}
            </div>
            )}
          </div>
        </div>
      )}

      {renderGuideModal()}
      {renderPhotoViewer()}

      {inviteScreenOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 25,
          }}
          onClick={closeInviteScreen}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--surface-2)",
              borderRadius: 16,
              padding: "1.25rem 1.4rem",
              width: 340,
              maxWidth: "90vw",
              maxHeight: "85vh",
              overflowY: "auto",
              WebkitOverflowScrolling: "touch",
              textAlign: "center",
            }}
          >
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
              <X size={22} color="var(--text-secondary)" style={{ cursor: "pointer" }} onClick={closeInviteScreen} />
            </div>

            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 18,
                background: active.accentBg,
                color: active.accent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 12px",
              }}
            >
              <Users size={32} />
            </div>
            <p style={{ fontWeight: 700, fontSize: 18, margin: "0 0 4px" }}>{active.name}</p>
            <p style={{ fontSize: 14, color: "var(--text-muted)", margin: "0 0 18px" }}>
              다른 사람을 그룹에 초대해보세요!
            </p>

            {inviteQrDataUrl && (
              <img
                src={inviteQrDataUrl}
                alt="초대 QR 코드"
                style={{ width: 180, height: 180, margin: "0 auto 16px", borderRadius: 12, border: "0.5px solid var(--border)" }}
              />
            )}

            <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 16px" }}>
              링크를 복사해서 보내거나, QR코드를 함께 찍어서 스캔하도록 하면 초대할 수 있어요.
            </p>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                border: "0.5px solid var(--border)",
                borderRadius: 10,
                padding: "8px 10px",
                marginBottom: 12,
                fontSize: 13,
                color: "var(--text-secondary)",
                overflow: "hidden",
              }}
            >
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>
                {`${window.location.origin}/g/${active.id}`}
              </span>
              <span
                onClick={() => copyGroupLink(`${window.location.origin}/g/${active.id}`)}
                style={{ color: "var(--accent-primary)", fontWeight: 700, cursor: "pointer", flexShrink: 0 }}
              >
                복사
              </span>
            </div>
          </div>
        </div>
      )}

      {activityScreenOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 25,
          }}
          onClick={closeActivityScreen}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--surface-2)",
              borderRadius: 16,
              padding: "1.25rem 1.4rem",
              width: 340,
              maxWidth: "90vw",
              maxHeight: "85vh",
              overflowY: "auto",
              WebkitOverflowScrolling: "touch",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <p style={{ fontWeight: 700, fontSize: 17, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 30, height: 30, borderRadius: "50%", background: "#FFF4E0", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  <Bell size={16} color="#FFB020" />
                </span>
                알림
              </p>
              <X size={22} color="var(--text-secondary)" style={{ cursor: "pointer" }} onClick={closeActivityScreen} />
            </div>

            {activityLoading && <p style={{ fontSize: 14, color: "var(--text-muted)", margin: 0 }}>불러오는 중...</p>}

            {!activityLoading && activityItems.length === 0 && (
              <p style={{ fontSize: 14, color: "var(--text-muted)", margin: 0 }}>아직 활동 내역이 없어요.</p>
            )}

            {!activityLoading && activityItems.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {activityItems.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "10px 4px",
                      borderBottom: "0.5px solid var(--border)",
                    }}
                  >
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: "50%",
                        background: active.accentBg,
                        color: active.accent,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Bell size={15} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 14, margin: 0 }}>{item.message}</p>
                      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "2px 0 0" }}>
                        {formatRelativeTime(item.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {memoListOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 25,
          }}
          onClick={() => setMemoListOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--surface-2)",
              borderRadius: 16,
              padding: "1.25rem 1.4rem",
              width: 340,
              maxWidth: "90vw",
              maxHeight: "85vh",
              overflowY: "auto",
              WebkitOverflowScrolling: "touch",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <p style={{ fontWeight: 700, fontSize: 17, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 30, height: 30, borderRadius: "50%", background: "#F1EAFE", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  <StickyNote size={16} color="#8B5CF6" />
                </span>
                공유 메모
              </p>
              <X size={22} color="var(--text-secondary)" style={{ cursor: "pointer" }} onClick={() => setMemoListOpen(false)} />
            </div>

            {active.tasks.filter((t) => t.note && isTaskVisibleToMe(t)).length === 0 && (
              <p style={{ fontSize: 14, color: "var(--text-muted)", margin: 0 }}>아직 메모가 없어요.</p>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {active.tasks
                .filter((t) => t.note && isTaskVisibleToMe(t))
                .sort((a, b) => taskMonth(a) - taskMonth(b) || taskDay(a) - taskDay(b))
                .map((m) => (
                  <div
                    key={m.id}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      fontSize: 14,
                      padding: "8px 4px",
                      borderBottom: "0.5px solid var(--border)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <StickyNote size={16} color={m.color || "var(--text-muted)"} style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: "var(--text-muted)", minWidth: 40 }}>
                      {taskMonth(m)}/{taskDay(m)}
                    </span>
                    {editingMemoId === m.id ? (
                      <input
                        autoFocus
                        value={editingMemoText}
                        onChange={(e) => setEditingMemoText(e.target.value)}
                        onBlur={saveMemoEdit}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") setEditingMemoId(null);
                        }}
                        style={{ flex: 1, minWidth: 0, fontSize: 14, padding: "4px 6px" }}
                      />
                    ) : (
                      <span onClick={() => startEditingMemo(m)} style={{ flex: 1, cursor: "pointer" }}>
                        {m.title}
                      </span>
                    )}
                    <Trash2 size={15} color="var(--text-muted)" style={{ cursor: "pointer", flexShrink: 0 }} onClick={() => deleteTask(m)} />
                    </div>
                    {editingMemoId === m.id && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 48, flexWrap: "wrap" }}>
                        {TASK_COLORS.map((c) => (
                          <div
                            key={c}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => setEditingMemoColor(c)}
                            style={{
                              width: 16,
                              height: 16,
                              borderRadius: "50%",
                              background: c,
                              cursor: "pointer",
                              border: editingMemoColor === c ? "2px solid var(--text-primary)" : "2px solid transparent",
                              boxShadow: "0 0 0 1px var(--border)",
                            }}
                          />
                        ))}
                      </div>
                    )}
                    {((m.photos && m.photos.length > 0) || editingMemoId === m.id) && (
                      <div style={{ display: "flex", gap: 6, paddingLeft: 48, flexWrap: "wrap" }}>
                        {(m.photos || []).map((src, idx) => (
                          <div key={idx} style={{ position: "relative", width: 40, height: 40 }}>
                            <img
                              src={src}
                              alt=""
                              onClick={() => openPhotoViewer(m.photos, idx)}
                              style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover", border: "0.5px solid var(--border)", cursor: "pointer" }}
                            />
                            {editingMemoId === m.id && (
                              <div
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => removePhotoFromMemo(m, idx)}
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
                                <X size={11} />
                              </div>
                            )}
                          </div>
                        ))}
                        {editingMemoId === m.id && (
                          <div
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handleEditingMemoPhotoClick(m)}
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: 6,
                              border: "1px dashed var(--border-strong)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              cursor: "pointer",
                            }}
                          >
                            <Plus size={17} color="var(--text-muted)" />
                          </div>
                        )}
                      </div>
                    )}
                    {editingMemoId === m.id && (
                      <div style={{ display: "flex", gap: 12, paddingLeft: 48, flexWrap: "wrap" }}>
                        <label
                          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}
                          onMouseDown={(e) => e.preventDefault()}
                        >
                          <input
                            type="checkbox"
                            checked={editingMemoBroadcast}
                            onChange={(e) => {
                              setEditingMemoBroadcast(e.target.checked);
                              if (e.target.checked) setEditingMemoPrivate(false);
                            }}
                          />
                          전체 공지
                        </label>
                        <label
                          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}
                          onMouseDown={(e) => e.preventDefault()}
                        >
                          <input
                            type="checkbox"
                            checked={editingMemoPrivate}
                            onChange={(e) => {
                              setEditingMemoPrivate(e.target.checked);
                              if (e.target.checked) setEditingMemoBroadcast(false);
                            }}
                          />
                          나만 보기
                        </label>
                      </div>
                    )}
                  </div>
                ))}
            </div>
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
            zIndex: 25,
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
              maxHeight: "85vh",
              overflowY: "auto",
              WebkitOverflowScrolling: "touch",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <p style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 17, margin: 0 }}>
                <span
                  style={{ width: 10, height: 10, borderRadius: "50%", background: active.accent, flexShrink: 0 }}
                />
                {openTask.broadcast ? "전체 공지" : "할일 상세"}
              </p>
              <X size={22} color="var(--text-secondary)" style={{ cursor: "pointer" }} onClick={closeTaskDetail} />
            </div>

            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="할일 또는 공지 내용"
              style={{ width: "100%", fontSize: 19, fontWeight: 600, margin: "0 0 4px", padding: "6px 8px" }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16, fontSize: 15, color: "var(--text-secondary)", flexWrap: "wrap" }}>
              {openTask.broadcast ? (
                <span>그룹 전체에게 알림</span>
              ) : (
                <>
                  <Avatar tier={memberById[draftAssignee]?.tier ?? 0} size={22} photo={memberById[draftAssignee]?.photo} />
                  <select
                    value={draftAssignee ?? ""}
                    onChange={(e) => setDraftAssignee(e.target.value)}
                    style={{ fontSize: 15, padding: "3px 6px" }}
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
              <span style={{ color: "var(--text-muted)" }}>·</span>
              <input
                type="date"
                value={draftDueDate}
                onChange={(e) => setDraftDueDate(e.target.value)}
                style={{ fontSize: 14, padding: "3px 6px" }}
              />
              <input
                type="time"
                value={draftDueTime}
                onChange={(e) => setDraftDueTime(e.target.value)}
                style={{ fontSize: 14, padding: "3px 6px" }}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>색상</span>
              {TASK_COLORS.map((c) => (
                <div
                  key={c}
                  onClick={() => setDraftColor(c)}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: c,
                    cursor: "pointer",
                    border: draftColor === c ? "2px solid var(--text-primary)" : "2px solid transparent",
                    boxShadow: "0 0 0 1px var(--border)",
                  }}
                />
              ))}
            </div>

            {draftLocation && (
              <div style={{ borderTop: "0.5px solid var(--border)", paddingTop: 12, marginBottom: 12 }}>
                <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "0 0 8px", display: "flex", alignItems: "center", gap: 5 }}>
                  <MapPin size={18} /> 장소
                </p>
                <div
                  onClick={() => {
                    setTaskLocationName(draftLocation.name || "");
                    setTaskLocationAddress(draftLocation.address || "");
                    setShowTaskLocationInput(true);
                  }}
                  style={{ border: "0.5px solid var(--border)", borderRadius: 8, padding: "10px 12px", cursor: "pointer" }}
                >
                  <p style={{ fontSize: 16, margin: "0 0 2px" }}>{draftLocation.name}</p>
                  {draftLocation.address && (
                    <p style={{ fontSize: 14, color: "var(--text-muted)", margin: 0 }}>{draftLocation.address}</p>
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
                    <Navigation size={19} /> 길찾기 시작
                  </button>
                )}
              </div>
            )}

            {!draftLocation && (
              <div style={{ borderTop: "0.5px solid var(--border)", paddingTop: 12, marginBottom: 12 }}>
                <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "0 0 8px", display: "flex", alignItems: "center", gap: 5 }}>
                  <MapPin size={18} /> 장소
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
                  <Plus size={19} /> 주소 추가
                </button>
              </div>
            )}

            <div style={{ borderTop: "0.5px solid var(--border)", paddingTop: 12, marginBottom: 12 }}>
              <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "0 0 8px", display: "flex", alignItems: "center", gap: 5 }}>
                <Camera size={18} /> 첨부 사진
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {draftPhotos.map((src, idx) => (
                  <img
                    key={idx}
                    src={src}
                    alt=""
                    onClick={() => openPhotoViewer(draftPhotos, idx)}
                    style={{ width: 52, height: 52, borderRadius: 8, objectFit: "cover", border: "0.5px solid var(--border)", cursor: "pointer" }}
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
                  <Plus size={21} color="var(--text-muted)" />
                </div>
              </div>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 16, borderTop: "0.5px solid var(--border)", paddingTop: 12, marginBottom: 12 }}>
              <input type="checkbox" checked={openTask.done} onChange={() => toggleTask(openTask.id)} />
              완료로 표시
            </label>

            {!openTask.broadcast && (
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 16, marginBottom: 12 }}>
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
              <Trash2 size={18} /> {openTask.locked ? "잠긴 항목 (삭제 불가)" : "삭제하기"}
            </button>
          </div>
        </div>
      )}

      {openEvent && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 25,
          }}
          onClick={closeEventDetail}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--surface-2)",
              borderRadius: 16,
              padding: "1.25rem 1.4rem",
              width: 340,
              maxWidth: "90vw",
              maxHeight: "85vh",
              overflowY: "auto",
              WebkitOverflowScrolling: "touch",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <p style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 17, margin: 0 }}>
                <span
                  style={{ width: 10, height: 10, borderRadius: "50%", background: active.accent, flexShrink: 0 }}
                />
                일정 상세
              </p>
              <X size={22} color="var(--text-secondary)" style={{ cursor: "pointer" }} onClick={closeEventDetail} />
            </div>

            <p style={{ fontSize: 19, fontWeight: 600, margin: "0 0 4px" }}>{openEvent.title}</p>
            <div style={{ fontSize: 15, color: "var(--text-secondary)", marginBottom: 4 }}>
              {viewMonth}월 {openEvent.date}일 · {openEvent.time}
            </div>
            {(() => {
              const lunar = getLunarLabel(viewYear, viewMonth, openEvent.date);
              return lunar ? <div style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 12 }}>{lunar}</div> : null;
            })()}

            <div style={{ borderTop: "0.5px solid var(--border)", paddingTop: 12, marginBottom: 12 }}>
              <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "0 0 8px" }}>참석자</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {openEvent.assignees.map((a) => (
                  <div key={a} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Avatar tier={memberById[a]?.tier ?? 0} size={24} photo={memberById[a]?.photo} />
                    <span style={{ fontSize: 16 }}>{memberById[a]?.name}</span>
                  </div>
                ))}
              </div>
            </div>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 16,
                borderTop: "0.5px solid var(--border)",
                paddingTop: 12,
              }}
            >
              <input
                type="checkbox"
                checked={!!(active.events.find((e) => e.id === openEvent.id) || openEvent).notify}
                onChange={() => toggleEventNotify(openEvent.id)}
              />
              알림 받기
            </label>
          </div>
        </div>
      )}
    </div>
    {renderBottomTabBar(tab)}
    {renderFeedbackModal()}
    </>
  );
}
