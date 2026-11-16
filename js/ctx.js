/** 현재 위치·공종 컨텍스트와 위치 트리 헬퍼 */
import { getAuthor as settingsAuthor, setAuthor as settingsSetAuthor } from "./settings.js";

const KEY = "site-app-ctx";

export function loadCtx() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export function saveCtx(ctx) {
  localStorage.setItem(KEY, JSON.stringify(ctx));
}

export function getAuthor() {
  return settingsAuthor();
}

export function setAuthor(name) {
  settingsSetAuthor(name);
}

export function getPath(locations, id) {
  const map = Object.fromEntries(locations.map((l) => [l.id, l]));
  const path = [];
  let cur = map[id];
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    cur = cur.parentId ? map[cur.parentId] : null;
  }
  return path;
}

export function labelPath(locations, id) {
  if (!id) return "위치 미선택";
  const path = getPath(locations, id);
  return path.length ? path.map((l) => l.name).join(" · ") : "위치 미선택";
}

export function childrenOf(locations, parentId, type) {
  return locations
    .filter((l) => l.parentId === parentId && (!type || l.type === type))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ko"));
}

export function rootsOf(locations, siteId, type = "동") {
  return locations
    .filter((l) => l.siteId === siteId && l.parentId == null && (!type || l.type === type))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ko"));
}

/** locationId와 그 하위 위치 id 집합 */
export function idsInScope(locations, locationId) {
  if (!locationId) return new Set(locations.map((l) => l.id));
  const ids = new Set([locationId]);
  const byParent = new Map();
  for (const l of locations) {
    const k = l.parentId;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(l);
  }
  const walk = (id) => {
    for (const k of byParent.get(id) || []) {
      ids.add(k.id);
      walk(k.id);
    }
  };
  walk(locationId);
  return ids;
}

/** 카드에서 고른 동/층/호 중 가장 구체적인 위치(호수는 선택) */
export function leafLocationId(ctx) {
  return ctx.unitId || ctx.floorId || ctx.dongId || null;
}

/** 검측·기록은 동+층이면 저장 가능 */
export function hasDongFloor(ctx) {
  return !!(ctx.dongId && ctx.floorId);
}

export function decomposePath(locations, locationId) {
  const path = getPath(locations, locationId);
  const dong = path.find((l) => l.type === "동");
  const floor = path.find((l) => l.type === "층");
  const unit = path.find((l) => l.type === "호수" || l.type === "구역");
  return {
    dongId: dong?.id || null,
    floorId: floor?.id || null,
    unitId: unit?.id || null,
  };
}

export function tradeName(trades, id) {
  return trades.find((t) => t.id === id)?.name || "공종 미선택";
}

/** 지하는 B1/B2, 지상은 n층. */
export function formatFloorMark(floor) {
  if (!floor) return "";
  const n = floor.floorNo ?? parseFloorToken(floor.name);
  if (n != null && n < 0) return `B${-n}`;
  if (n != null && n > 0) return `${n}층`;
  return floor.name || "";
}

/** 공용 동 하위 한 칸: "지하주차장 B1" / "옥상" / "코어" */
export function formatCommonLevel(floor) {
  if (!floor) return "";
  const n = floor.floorNo ?? parseFloorToken(floor.name);
  const area = floor.area || (n != null && n < 0 ? "지하주차장" : "");
  const mark = n != null && n < 0 ? `B${-n}` : (n != null && n > 0 ? `${n}층` : "");
  if (area && mark) return `${area} ${mark}`;
  if (mark && area) return `${area} ${mark}`;
  return floor.name || mark || area || "";
}

/**
 * 위치 표시 단일 함수.
 * 일반: "101동 1층 101호 슬래브"
 * 공용: "공용 · 지하주차장 B1" / "공용 · 옥상"
 * opts.part, opts.trade(문자열) — 공종이 있으면 뒤에 " · 철근"
 */
export function formatLocation(locations, ctx = {}, opts = {}) {
  const locs = locations || [];
  let dongId = ctx.dongId || null;
  let floorId = ctx.floorId || null;
  let unitId = ctx.unitId || null;
  if ((!dongId && !floorId) && ctx.locationId) {
    const path = decomposePath(locs, ctx.locationId);
    dongId = path.dongId;
    floorId = path.floorId;
    unitId = path.unitId || unitId;
  }
  const dong = locs.find((l) => l.id === dongId);
  const floor = locs.find((l) => l.id === floorId);
  const unit = locs.find((l) => l.id === unitId);
  const part = opts.part !== undefined ? opts.part : (ctx.part || "");
  let text = "";
  if (isCommonDong(dong)) {
    const rest = [formatCommonLevel(floor), unit?.name, part].filter(Boolean).join(" ");
    text = rest ? `공용 · ${rest}` : "공용";
  } else {
    const bits = [];
    if (dong?.name) bits.push(dong.name);
    if (floor?.name) bits.push(floor.name);
    if (unit?.name) bits.push(unit.name);
    if (part) bits.push(part);
    text = bits.join(" ");
  }
  const trade = typeof opts.trade === "string" ? opts.trade : "";
  if (trade) text = text ? `${text} · ${trade}` : trade;
  return text;
}

/** 공식 칸용 문장. 공용은 "공용 · 지하주차장 B1" 형식. */
export function officialLocation(locations, ctx, part) {
  return formatLocation(locations, ctx || {}, { part: part !== undefined ? part : ctx?.part });
}

/** 기록 위치 표시. 저장된 문장보다 현재 트리 기준 표시를 우선한다. */
export function formatRecordLocation(locations, record, opts = {}) {
  const extra = record?.extra || {};
  const part = opts.part !== undefined ? opts.part : extra.part;
  const text = formatLocation(locations, { locationId: record?.locationId, part }, opts);
  return text || extra.locationSentence || labelPath(locations, record?.locationId) || "";
}

export function formatWhen(iso) {
  const d = iso ? new Date(iso) : new Date();
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function formatDay(iso) {
  const d = iso ? new Date(iso) : new Date();
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export const TYPE_LABEL = {
  photo: "사진",
  video: "영상",
  memo: "메모",
  issue: "지적",
  inspection: "검측",
  quality: "품질시험",
};

export const STATUS_LABEL = {
  draft: "작성",
  requested: "요청",
  pass: "합격",
  fail: "불합격",
  recorded: "",
  open: "미해결",
  resolved: "해결",
  submitted: "요청",
};

/** "지하2" | "B2" | "-2" | "15" | "15층" → 정수(지하는 음수) */
export function parseFloorToken(s) {
  const t = String(s || "").trim();
  if (!t) return null;
  const under = t.match(/^(?:지하|B|b)\s*(\d+)\s*층?$/);
  if (under) return -Number(under[1]);
  const n = t.match(/^-?\d+/);
  if (!n) return null;
  return Number(n[0]);
}

export function floorLabel(n) {
  if (n < 0) return `지하${-n}층`;
  return `${n}층`;
}

/**
 * 동별 최하층·최상층·호수 수로 위치 레코드를 만든다.
 * 이미 있는 같은 이름의 층·호는 건너뛴다.
 */
export function planDongStructure({ siteId, dong, dongName, minFloor, maxFloor, unitCount, existing, uid }) {
  const created = [];
  const floors = existing.filter((l) => l.parentId === dong.id && l.type === "층");
  const lo = Math.min(minFloor, maxFloor);
  const hi = Math.max(minFloor, maxFloor);
  let order = floors.length;
  for (let n = lo; n <= hi; n++) {
    if (n === 0) continue;
    const name = floorLabel(n);
    let floor = floors.find((f) => f.name === name);
    if (!floor) {
      order += 1;
      floor = { id: uid(), siteId, parentId: dong.id, type: "층", name, order, floorNo: n };
      created.push(floor);
    }
    if (unitCount > 0) {
      const units = existing.concat(created).filter((l) => l.parentId === floor.id && (l.type === "호수" || l.type === "구역"));
      const abs = Math.abs(n);
      for (let i = 1; i <= unitCount; i++) {
        const ho = n < 0 ? `B${abs}${String(i).padStart(2, "0")}호` : `${abs}${String(i).padStart(2, "0")}호`;
        if (units.some((u) => u.name === ho)) continue;
        created.push({
          id: uid(),
          siteId,
          parentId: floor.id,
          type: "호수",
          name: ho,
          order: units.length + i,
        });
      }
    }
  }
  return created;
}


/** "101동 1층 · 철근" / "공용 · 지하주차장 B1 · 철근" */
export function compactLocationLine(locations, trades, ctx) {
  if (!ctx?.dongId || !ctx?.floorId) {
    return formatLocation(locations, ctx || {}, { part: ctx?.part }) || "동·층을 선택하세요";
  }
  const trade = ctx.tradeId ? tradeName(trades, ctx.tradeId) : "";
  return formatLocation(locations, ctx, { part: ctx?.part, trade });
}

/** 같은 동에서 delta층(−1/+1). 없으면 null. */
export function siblingFloor(locations, ctx, delta) {
  if (!ctx?.dongId) return null;
  const floors = childrenOf(locations, ctx.dongId, "층")
    .slice()
    .sort((a, b) => (a.floorNo ?? parseFloorToken(a.name) ?? 0) - (b.floorNo ?? parseFloorToken(b.name) ?? 0));
  const idx = floors.findIndex((f) => f.id === ctx.floorId);
  if (idx < 0) return null;
  return floors[idx + delta] || null;
}


export const COMMON_DONG_NAME = "공용";
export const COMMON_AREA_PRESETS = ["지하주차장", "옥상", "기계·전기실", "피트", "단지 외부"];
export const PARKING_AREA = "지하주차장";
export const PARKING_FLOORS = [-2, -1];

export function isCommonDong(loc) {
  return !!(loc && (loc.isCommon || loc.name === COMMON_DONG_NAME));
}

/** 일반 동 다음, 가상 동 «공용»은 항상 마지막. */
export function sortDongs(dongs) {
  const list = (dongs || []).slice();
  const normal = list.filter((d) => !isCommonDong(d)).sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name, "ko"));
  const common = list.filter(isCommonDong).sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name, "ko"));
  return [...normal, ...common];
}

export function findCommonDong(locations, siteId) {
  return (locations || []).find((l) => (!siteId || l.siteId === siteId) && l.parentId == null && isCommonDong(l)) || null;
}

/** 없으면 가상 동 «공용» 레코드를 만든다(기존은 그대로). */
export function planCommonDong({ siteId, existing, uid }) {
  const found = findCommonDong(existing, siteId);
  if (found) return { dong: found, created: [] };
  const others = (existing || []).filter((l) => l.siteId === siteId && l.parentId == null && l.type === "동");
  const order = Math.max(100, ...others.map((d) => d.order || 0)) + 1;
  const dong = { id: uid(), siteId, parentId: null, type: "동", name: COMMON_DONG_NAME, order, isCommon: true };
  return { dong, created: [dong] };
}

/**
 * 공용 구역 추가. 지하주차장은 B1~B2를 만들고,
 * 그 외 프리셋·직접 입력은 공용 동 아래 층급 구역으로 둔다. 이미 있으면 빈 배열.
 */
export function planCommonArea({ siteId, dong, name, existing, uid }) {
  const created = [];
  const label = String(name || "").trim();
  if (!label || !dong) return created;
  const all = (existing || []).concat(created);
  const kids = () => all.filter((l) => l.parentId === dong.id);
  const nextOrder = () => Math.max(0, ...kids().map((l) => l.order || 0)) + 1;
  if (label === PARKING_AREA) {
    for (const n of PARKING_FLOORS) {
      const flName = floorLabel(n);
      const exists = kids().some((l) => l.type === "층" && (l.floorNo === n || l.name === flName));
      if (exists) continue;
      const row = {
        id: uid(),
        siteId,
        parentId: dong.id,
        type: "층",
        name: flName,
        order: nextOrder(),
        floorNo: n,
        area: PARKING_AREA,
        isCommonArea: true,
      };
      created.push(row);
      all.push(row);
    }
    return created;
  }
  if (kids().some((l) => l.name === label)) return created;
  created.push({
    id: uid(),
    siteId,
    parentId: dong.id,
    type: "층",
    name: label,
    order: nextOrder(),
    floorNo: null,
    isCommonArea: true,
  });
  return created;
}

/** 공용 동이면 층·구역을 모두, 일반 동이면 층만. */
export function pickerFloors(locations, dongId) {
  const dong = (locations || []).find((l) => l.id === dongId);
  const kids = childrenOf(locations, dongId);
  const floors = isCommonDong(dong)
    ? kids.filter((l) => l.type === "층" || l.type === "구역" || l.isCommonArea)
    : kids.filter((l) => l.type === "층");
  return floors.slice().sort((a, b) => {
    const an = a.floorNo ?? (a.isCommonArea ? 1000 : parseFloorToken(a.name) ?? 0);
    const bn = b.floorNo ?? (b.isCommonArea ? 1000 : parseFloorToken(b.name) ?? 0);
    if (an !== bn) return an - bn;
    return (a.order - b.order) || a.name.localeCompare(b.name, "ko");
  });
}
