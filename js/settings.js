/** 설정값(작성자·공사명·수신·서명 이름)과 문서번호 */
const KEY = "site-app-settings";

export const DEFAULT_SETTINGS = {
  author: "현장관리인",
  projectName: "샘플 공사",
  recipient: "총괄감리원",
  signs: {
    staff: "점검직원",
    agent: "현장대리인",
    inspector: "검측자",
    chief: "총괄감리원",
  },
  docSeq: 0,
  templateSource: "builtin",
  templatePackVersion: 0,
  recentVehicles: [],
  recentLocations: [],
};

export function loadSettings() {
  let raw = {};
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    raw = {};
  }
  const legacy = localStorage.getItem("site-app-author");
  const signs = { ...DEFAULT_SETTINGS.signs, ...(raw.signs || {}) };
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    signs,
    author: raw.author || legacy || DEFAULT_SETTINGS.author,
  };
}

export function saveSettings(s) {
  const next = { ...loadSettings(), ...s, signs: { ...loadSettings().signs, ...(s.signs || {}) } };
  localStorage.setItem(KEY, JSON.stringify(next));
  localStorage.setItem("site-app-author", next.author);
  return next;
}

export function getAuthor() {
  return loadSettings().author || "현장관리인";
}

export function setAuthor(name) {
  saveSettings({ author: (name || "").trim() || "현장관리인" });
}

/** 자동 문서번호: 제2026-0001호 */
export function nextDocNo() {
  const s = loadSettings();
  s.docSeq = (s.docSeq || 0) + 1;
  saveSettings({ docSeq: s.docSeq });
  const y = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date());
  return `제${y}-${String(s.docSeq).padStart(4, "0")}호`;
}

/** Asia/Seoul 기준 datetime-local 값 */
export function nowLocalInput() {
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return fmt.format(new Date()).replace(" ", "T").slice(0, 16);
}

export function formatLocalInput(v) {
  if (!v) return "";
  const s = String(v).replace("T", " ");
  return s.length >= 16 ? s.slice(0, 16) : s;
}

export function recentVehicles(max = 8) {
  const list = loadSettings().recentVehicles || [];
  return list.filter(Boolean).slice(0, max);
}

export function rememberVehicle(no, max = 8) {
  const v = String(no || "").trim();
  if (!v) return recentVehicles(max);
  const list = [v, ...recentVehicles(max).filter((x) => x !== v)].slice(0, max);
  saveSettings({ recentVehicles: list });
  return list;
}

function locKey(entry) {
  if (!entry) return "";
  return [entry.dongId || "", entry.floorId || "", entry.unitId || "", entry.part || "", entry.tradeId || ""].join("::");
}

export function recentLocations(max = 5, except = null) {
  const list = loadSettings().recentLocations || [];
  const skip = except ? locKey(except) : "";
  return list
    .filter((x) => x && x.dongId && x.floorId)
    .filter((x) => !skip || locKey(x) !== skip)
    .slice(0, max);
}

export function rememberLocation(entry, max = 10) {
  if (!entry?.dongId || !entry?.floorId) return recentLocations(max);
  const row = {
    dongId: entry.dongId,
    floorId: entry.floorId,
    unitId: entry.unitId || null,
    part: entry.part || "",
    tradeId: entry.tradeId || null,
    label: entry.label || "",
  };
  const prev = (loadSettings().recentLocations || []).filter((x) => x && x.dongId && x.floorId);
  const list = [row, ...prev.filter((x) => locKey(x) !== locKey(row))].slice(0, max);
  saveSettings({ recentLocations: list });
  return list;
}
