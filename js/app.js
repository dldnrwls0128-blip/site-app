/** 현장관리 PWA — 화면·라우팅 (명세 v0.3) */
import * as db from "./db.js";
import {
  loadCtx,
  saveCtx,
  getAuthor,
  childrenOf,
  rootsOf,
  idsInScope,
  leafLocationId,
  hasDongFloor,
  decomposePath,
  labelPath,
  tradeName,
  formatWhen,
  officialLocation,
  formatLocation,
  formatRecordLocation,
  formatCommonLevel,
  TYPE_LABEL,
  STATUS_LABEL,
  parseFloorToken,
  planDongStructure,
  compactLocationLine,
  siblingFloor,
  COMMON_AREA_PRESETS,
  isCommonDong,
  sortDongs,
  findCommonDong,
  planCommonDong,
  planCommonArea,
  pickerFloors,
} from "./ctx.js";
import { addWatermark, makeThumb, downloadBlob } from "./media.js";
import { speechSupported, startDictation } from "./speech.js";
import { exportBackupZip, importBackupZip } from "./backup.js";
import { exportInspectionPdf, exportInspectionXlsx, exportQualityXlsx } from "./inspect.js";
import { openPdfBlob, renderPage } from "./drawings.js";
import { loadSettings, saveSettings, nextDocNo, nowLocalInput, formatLocalInput, recentVehicles, rememberVehicle, recentLocations, rememberLocation } from "./settings.js";
import { resolveItem, isOutOfRange, rangeHint, allSelfFilled, selfFilled, PARTS, itemRequiresPhoto, effectiveItem, needsSpecOverride, missingPhotoItems, shortItemLabel, isVehicleItem, isNaResult, isNaValue } from "./items.js";
import { replaceTemplates, templatesOf, ensureBuiltinTemplates } from "./templates.js";

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? "").replace(/[&<>"'`]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c])
  );
}

const state = {
  tab: "home",
  view: "home",
  recordId: null,
  drawingId: null,
  typeFilter: "all",
  drawingQuery: "",
  isMemo: false,
  data: {
    sites: [],
    locations: [],
    trades: [],
    records: [],
    media: [],
    checklistTemplates: [],
    drawings: [],
  },
  ctx: {},
  toastTimer: 0,
  pdfDoc: null,
  pdfPage: 1,
  pdfScale: 1.15,
  dictation: null,
  inspectDraft: null,
  inspectTemplateId: null,
  pendingByItem: {},
  photoTargetItemId: null,
  specOverrides: {},
  qualityTemplateId: null,
  locPicker: null,
};

function toast(msg, ms = 2000) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("toast-top");
  const focus = document.activeElement;
  if (focus && /INPUT|TEXTAREA|SELECT/.test(focus.tagName)) {
    const r = focus.getBoundingClientRect();
    const tabH = ($(".tab-bar")?.getBoundingClientRect().height) || 64;
    const zoneTop = window.innerHeight - tabH - 72;
    if (r.bottom > zoneTop) el.classList.add("toast-top");
  }
  el.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

function site() {
  const { sites } = state.data;
  return sites.find((s) => s.id === state.ctx.siteId) || sites[0] || null;
}

function currentLocationId() {
  return leafLocationId(state.ctx);
}

function locationLabel() {
  return formatLocation(state.data.locations, state.ctx, { part: state.ctx.part }) || labelPath(state.data.locations, currentLocationId());
}

async function reload() {
  state.data = await db.loadAll();
  if (!state.data.specOverrides) state.data.specOverrides = [];
  state.specOverrides = Object.fromEntries(
    (state.data.specOverrides || []).map((o) => [o.itemId ? `${o.templateId || ""}::${o.itemId}` : o.id, o])
  );
  const ctx = loadCtx();
  const s = state.data.sites[0];
  if (!ctx.siteId && s) ctx.siteId = s.id;
  if (!ctx.tradeId && state.data.trades[0]) {
    ctx.tradeId = (state.data.trades.find((t) => t.name === "철근") || state.data.trades[0]).id;
  }
  if (!ctx.dongId && s) {
    const dongs = sortDongs(rootsOf(state.data.locations, s.id, "동")).filter((d) => !isCommonDong(d));
    if (dongs[0]) {
      const floors = childrenOf(state.data.locations, dongs[0].id, "층");
      ctx.dongId = dongs[0].id;
      ctx.floorId = floors[0]?.id || null;
      ctx.unitId = null;
      ctx.siteId = s.id;
    }
  }
  state.ctx = ctx;
  saveCtx(ctx);
  await ensureCommonDongPersisted();
}

async function ensureCommonDongPersisted() {
  const s = site();
  if (!s) return null;
  const { dong, created } = planCommonDong({ siteId: s.id, existing: state.data.locations, uid: db.uid });
  for (const row of created) {
    await db.add("locations", row);
    state.data.locations.push(row);
  }
  return dong;
}

async function addCommonArea(name) {
  const s = site();
  if (!s) return [];
  const dong = await ensureCommonDongPersisted();
  if (!dong) return [];
  const created = planCommonArea({
    siteId: s.id,
    dong,
    name,
    existing: state.data.locations,
    uid: db.uid,
  });
  for (const row of created) {
    await db.add("locations", row);
    state.data.locations.push(row);
  }
  return created;
}

function go(hash) {
  location.hash = hash.startsWith("#") ? hash : `#/${hash.replace(/^\//, "")}`;
}

function parseHash() {
  const raw = (location.hash || "#/home").replace(/^#\/?/, "");
  const [a, b] = raw.split("/");
  const tabs = new Set(["home", "browse", "drawings", "settings"]);
  state.recordId = null;
  state.drawingId = null;
  if (tabs.has(a) && !b) {
    state.tab = a;
    state.view = a;
  } else if (a === "capture" || a === "inspect" || a === "note" || a === "quality") {
    state.tab = "home";
    state.view = a;
  } else if (a === "specs") {
    state.tab = "settings";
    state.view = "specs";
  } else if (a === "record" && b) {
    state.tab = "browse";
    state.view = "record";
    state.recordId = b;
  } else if (a === "drawing" && b) {
    state.tab = "drawings";
    state.view = "drawing";
    state.drawingId = b;
  } else {
    state.tab = "home";
    state.view = "home";
  }
}

function headerTitle() {
  return {
    home: "현장관리",
    browse: "조회",
    drawings: "도면",
    settings: "설정",
    capture: "촬영",
    inspect: "검측",
    note: "기록",
    quality: "품질시험",
    record: "기록 상세",
    drawing: "도면 보기",
    specs: "현장 시방값",
  }[state.view] || "현장관리";
}

function render() {
  const app = $("#view");
  const back = !["home", "browse", "drawings", "settings"].includes(state.view);
  $("#header-title").textContent = headerTitle();
  $("#btn-back").hidden = !back;
  $$(".tab-item").forEach((t) => t.classList.toggle("active", t.dataset.tab === state.tab));
  const views = {
    home: renderHome,
    browse: renderBrowse,
    drawings: renderDrawings,
    settings: renderSettings,
    capture: renderCapture,
    inspect: renderInspect,
    note: renderNote,
    quality: renderQuality,
    record: renderRecord,
    drawing: renderDrawingView,
    specs: renderSpecs,
  };
  app.innerHTML = (views[state.view] || renderHome)();
  if (state.view === "drawing") queueMicrotask(paintDrawing);
  if (state.view === "inspect") queueMicrotask(updateRequestEnabled);
  if (state.view === "quality") queueMicrotask(updateQualitySaveEnabled);
  syncLocPicker();
}

function locEntryFrom(ctx, label) {
  return {
    dongId: ctx.dongId,
    floorId: ctx.floorId,
    unitId: ctx.unitId || null,
    part: ctx.part || "",
    tradeId: ctx.tradeId || null,
    label: label || compactLocationLine(state.data.locations, state.data.trades, ctx),
  };
}

function rememberCurrentLocation() {
  rememberLocation(locEntryFrom(state.ctx));
}

function locationCard(opts = {}) {
  const line = compactLocationLine(state.data.locations, state.data.trades, state.ctx);
  const editable = !opts.readonly;
  const home = state.view === "home";
  const down = siblingFloor(state.data.locations, state.ctx, -1);
  const up = siblingFloor(state.data.locations, state.ctx, 1);
  const floorBtns = home && editable
    ? `<div class="floor-step">
        <button type="button" class="btn-floor" id="btn-floor-down" ${down ? "" : "disabled"} aria-label="한 층 아래">−1</button>
        <button type="button" class="btn-floor" id="btn-floor-up" ${up ? "" : "disabled"} aria-label="한 층 위">+1</button>
      </div>`
    : "";
  const chips = home && editable
    ? `<div class="loc-chips" aria-label="최근 위치">${recentLocations(5, locEntryFrom(state.ctx))
        .map((row) => {
          const lab = compactLocationLine(state.data.locations, state.data.trades, row);
          return `<button type="button" class="chip" data-loc-chip="${esc(JSON.stringify({ dongId: row.dongId, floorId: row.floorId, unitId: row.unitId, part: row.part, tradeId: row.tradeId }))}">${esc(lab)}</button>`;
        })
        .join("")}</div>`
    : "";
  const inner = `
      <span class="loc-kicker">현재 위치</span>
      <span class="loc-line" id="loc-official">${esc(line)}</span>`;
  const summary = editable
    ? `<button type="button" class="loc-summary card location-card" id="btn-open-loc-picker" aria-label="위치 선택">${inner}</button>`
    : `<div class="loc-summary card location-card is-static" id="location-card">${inner}</div>`;
  return `
    <section class="loc-block">
      <div class="loc-compact-row">
        ${summary}
        ${floorBtns}
      </div>
      ${chips}
    </section>`;
}

function openLocPicker() {
  state.locPicker = {
    open: true,
    step: "dong",
    draft: {
      dongId: state.ctx.dongId || null,
      floorId: state.ctx.floorId || null,
      unitId: state.ctx.unitId || null,
      part: state.ctx.part || "",
      tradeId: state.ctx.tradeId || null,
    },
  };
  render();
}

function closeLocPicker() {
  state.locPicker = null;
  render();
}

function completeLocPicker() {
  const d = state.locPicker?.draft;
  if (!d?.dongId || !d?.floorId) return toast("동과 층을 선택하세요.");
  setCtx({
    dongId: d.dongId,
    floorId: d.floorId,
    unitId: d.unitId || null,
    part: d.part || "",
    tradeId: d.tradeId || state.ctx.tradeId,
  });
  rememberCurrentLocation();
  closeLocPicker();
}

function shiftFloor(delta) {
  const next = siblingFloor(state.data.locations, state.ctx, delta);
  if (!next) return toast(delta < 0 ? "더 아래 층이 없습니다." : "더 위 층이 없습니다.");
  setCtx({ floorId: next.id, unitId: null });
  rememberCurrentLocation();
  render();
}

function applyLocChip(row) {
  if (!row?.dongId || !row?.floorId) return;
  setCtx({
    dongId: row.dongId,
    floorId: row.floorId,
    unitId: row.unitId || null,
    part: row.part || "",
    tradeId: row.tradeId || state.ctx.tradeId,
  });
  rememberCurrentLocation();
  render();
}

function locPickerHtml() {
  const p = state.locPicker;
  if (!p?.open) return "";
  const { locations, trades } = state.data;
  const s = site();
  const dongs = s ? sortDongs(rootsOf(locations, s.id, "동")) : [];
  const floors = p.draft.dongId ? pickerFloors(locations, p.draft.dongId) : [];
  const units = p.draft.floorId
    ? childrenOf(locations, p.draft.floorId).filter((l) => l.type === "호수" || l.type === "구역")
    : [];
  const steps = [
    { id: "dong", lab: "동" },
    { id: "floor", lab: "층" },
    { id: "unit", lab: "호수/부위" },
    { id: "trade", lab: "공종" },
  ];
  const btn = (label, selected, attrs) =>
    `<button type="button" class="picker-btn${selected ? " on" : ""}" ${attrs}>${esc(label)}</button>`;
  let body = "";
  if (p.step === "dong") {
    body = `<div class="picker-grid">${dongs.map((d) => btn(d.name, p.draft.dongId === d.id, `data-pick="dong" data-id="${esc(d.id)}"`)).join("")}</div>`;
  } else if (p.step === "floor") {
    body = `<div class="picker-grid">${floors.map((f) => {
      const lab = isCommonDong(locations.find((l) => l.id === p.draft.dongId)) ? formatCommonLevel(f) : f.name;
      return btn(lab, p.draft.floorId === f.id, `data-pick="floor" data-id="${esc(f.id)}"`);
    }).join("")}</div>`;
  } else if (p.step === "unit") {
    const unitBtns = units.map((u) => btn(u.name, p.draft.unitId === u.id, `data-pick="unit" data-id="${esc(u.id)}"`)).join("")
      + btn("선택 안 함", !p.draft.unitId, `data-pick="unit" data-id=""`);
    const partBtns = PARTS.map((pt) => btn(pt, p.draft.part === pt, `data-pick="part" data-id="${esc(pt)}"`)).join("")
      + btn("선택 안 함", !p.draft.part, `data-pick="part" data-id=""`);
    body = `
      <p class="help">호수와 부위는 선택 사항입니다. 고르지 않아도 됩니다.</p>
      <h3 class="picker-sub">호수</h3>
      <div class="picker-grid">${unitBtns}</div>
      <h3 class="picker-sub">부위</h3>
      <div class="picker-grid">${partBtns}</div>
      <button type="button" class="btn btn-primary btn-lg" id="btn-picker-next">다음 (공종)</button>`;
  } else {
    const list = trades.slice().sort((a, b) => a.order - b.order);
    body = `<div class="picker-grid">${list.map((tr) => btn(tr.name, p.draft.tradeId === tr.id, `data-pick="trade" data-id="${esc(tr.id)}"`)).join("")}</div>`;
  }
  const dongObj = locations.find((l) => l.id === p.draft.dongId);
  const floorTitle = isCommonDong(dongObj) ? "공용 구역·층을 고르세요" : "층을 고르세요";
  const titles = { dong: "동을 고르세요", floor: floorTitle, unit: "호수·부위를 고르세요 (선택)", trade: "공종을 고르세요" };
  return `
    <div class="loc-picker" id="loc-picker" role="dialog" aria-modal="true" aria-labelledby="loc-picker-title">
      <header class="picker-head">
        <h2 id="loc-picker-title">위치 선택</h2>
      </header>
      <nav class="picker-steps">${steps.map((st) => `<button type="button" class="picker-step${p.step === st.id ? " on" : ""}" data-picker-step="${st.id}">${esc(st.lab)}</button>`).join("")}</nav>
      <p class="picker-lead">${esc(titles[p.step] || "")}</p>
      <div class="picker-body">${body}</div>
      <button type="button" class="btn btn-primary btn-lg picker-done" id="btn-picker-done">완료</button>
    </div>`;
}

function syncLocPicker() {
  let root = $("#loc-picker-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "loc-picker-root";
    document.body.appendChild(root);
  }
  root.innerHTML = state.locPicker?.open ? locPickerHtml() : "";
  document.body.classList.toggle("picker-open", !!state.locPicker?.open);
}

function applyPick(kind, id) {
  const p = state.locPicker;
  if (!p) return;
  if (kind === "dong") {
    p.draft.dongId = id || null;
    p.draft.floorId = null;
    p.draft.unitId = null;
    p.step = "floor";
  } else if (kind === "floor") {
    p.draft.floorId = id || null;
    p.draft.unitId = null;
    p.step = "trade";
  } else if (kind === "unit") {
    p.draft.unitId = id || null;
  } else if (kind === "part") {
    p.draft.part = id || "";
  } else if (kind === "trade") {
    p.draft.tradeId = id || null;
  }
  render();
}


function renderHome() {
  const recents = state.data.records
    .slice()
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, 4);
  return `
    <div class="home-screen">
      <div class="home-upper">
        ${locationCard()}
        <section class="block">
          <h2 class="block-title">최근 기록</h2>
          ${recents.length ? recordList(recents) : `<p class="empty">아직 기록이 없습니다. 촬영·검측·기록·품질시험으로 남겨 보세요.</p>`}
        </section>
      </div>
      <section class="action-grid home-actions" aria-label="바로가기">
        <button class="action-btn" id="btn-capture" data-go="capture">
          <span class="action-ico">${iconCamera()}</span><span>촬영</span>
        </button>
        <button class="action-btn" id="btn-inspect" data-go="inspect">
          <span class="action-ico">${iconCheck()}</span><span>검측</span>
        </button>
        <button class="action-btn" id="btn-note" data-go="note">
          <span class="action-ico">${iconMemo()}</span><span>기록</span>
        </button>
        <button class="action-btn" id="btn-quality" data-go="quality">
          <span class="action-ico">${iconFlask()}</span><span>품질시험</span>
        </button>
      </section>
    </div>`;
}

function recordList(list) {
  const { locations, trades } = state.data;
  return `<ul class="list">${list
    .map((r) => {
      const t = TYPE_LABEL[r.type] || r.type;
      const st = r.type === "inspection" ? STATUS_LABEL[r.status] || "" : "";
      const loc = formatRecordLocation(locations, r);
      return `<li>
        <a class="list-item" href="#/record/${esc(r.id)}">
          <span class="badge badge-${esc(r.type)}">${esc(t)}${st ? "·" + st : ""}</span>
          <span class="list-body">
            <strong>${esc(r.title || (r.text || "").slice(0, 40) || t)}</strong>
            <small>${esc(loc)} · ${esc(tradeName(trades, r.tradeId))}<br>${esc(formatWhen(r.createdAt))}</small>
          </span>
        </a>
      </li>`;
    })
    .join("")}</ul>`;
}

function renderBrowse() {
  const scope = idsInScope(state.data.locations, state.ctx.dongId || currentLocationId());
  let list = state.data.records
    .filter((r) => !r.locationId || scope.has(r.locationId))
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  if (state.typeFilter !== "all") list = list.filter((r) => r.type === state.typeFilter);
  const chips = ["all", "photo", "video", "inspection", "quality", "issue", "memo"]
    .map((t) => {
      const label = t === "all" ? "전체" : TYPE_LABEL[t];
      return `<button class="chip ${state.typeFilter === t ? "on" : ""}" data-filter="${t}">${label}</button>`;
    })
    .join("");
  return `
    ${locationCard()}
    <div class="chips" id="type-chips">${chips}</div>
    ${list.length ? recordList(list) : `<p class="empty">이 위치·필터에 해당하는 기록이 없습니다.</p>`}`;
}

function renderDrawings() {
  const dongId = state.ctx.dongId;
  const tradeId = state.ctx.tradeId;
  const q = (state.drawingQuery || "").trim().toLowerCase();
  const list = state.data.drawings
    .filter((d) => !dongId || d.locationId === dongId)
    .filter((d) => !tradeId || !d.tradeId || d.tradeId === tradeId)
    .filter((d) => !q || (d.name || "").toLowerCase().includes(q))
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko"));
  const items = list
    .map(
      (d) => `<li>
        <a class="list-item" href="#/drawing/${esc(d.id)}">
          <span class="badge badge-drawing">PDF</span>
          <span class="list-body">
            <strong>${esc(d.name)}</strong>
            <small>${esc(formatLocation(state.data.locations, { locationId: d.locationId }) || labelPath(state.data.locations, d.locationId))} · ${esc(tradeName(state.data.trades, d.tradeId))}</small>
          </span>
        </a>
      </li>`
    )
    .join("");
  return `
    ${locationCard()}
    <p class="help">도면은 동·공종 태그와 파일명으로만 찾습니다. 층에 연결하지 않습니다.</p>
    <label>파일명 검색
      <input id="inp-drawing-search" value="${esc(state.drawingQuery || "")}" placeholder="파일명 일부" />
    </label>
    <div class="row-actions">
      <button class="btn btn-primary" id="btn-upload-pdf">도면 PDF 올리기</button>
    </div>
    ${list.length ? `<ul class="list">${items}</ul>` : `<p class="empty">이 동·공종·검색어에 해당하는 도면이 없습니다.</p>`}`;
}

function renderSettings() {
  const s = site();
  const set = loadSettings();
  const { locations, trades } = state.data;
  const dongs = s ? sortDongs(rootsOf(locations, s.id, "동")) : [];
  const locTree = dongs
    .map((d) => {
      const fl = pickerFloors(locations, d.id)
        .map((f) => {
          const us = childrenOf(locations, f.id)
            .map((u) => `<li class="tree-unit">${esc(u.name)}</li>`)
            .join("");
          const nHo = childrenOf(locations, f.id).filter((x) => x.type === "호수").length;
          const ho = nHo ? ` (${nHo}호)` : "";
          const lab = isCommonDong(d) ? formatCommonLevel(f) : f.name;
          return `<li>${esc(lab)}${ho}<ul>${us}</ul></li>`;
        })
        .join("");
      return `<li><strong>${esc(d.name)}</strong><ul>${fl}</ul></li>`;
    })
    .join("");
  const presetChips = COMMON_AREA_PRESETS.map((name) => `<button type="button" class="chip" data-common-preset="${esc(name)}">${esc(name)}</button>`).join("");
  const tradeList = trades
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((t) => `<li>${esc(t.name)}</li>`)
    .join("");
  const sw = navigator.serviceWorker?.controller ? "등록됨 (제어 중)" : "등록 대기 또는 미사용";
  const tplCount = state.data.checklistTemplates.length;
  return `
    <section class="card">
      <h2 class="block-title">기본 정보</h2>
      <label>사용자명 (기록 작성자)
        <input id="inp-author" value="${esc(set.author)}" maxlength="40" />
      </label>
      <label>현장 이름
        <input id="inp-site" value="${esc(s?.name || "")}" maxlength="60" />
      </label>
      <label>공사명
        <input id="inp-project" value="${esc(set.projectName)}" maxlength="80" />
      </label>
      <label>수신 (총괄감리원)
        <input id="inp-recipient" value="${esc(set.recipient)}" maxlength="40" />
      </label>
      <h3 class="sub-title">서명란 기본 이름</h3>
      <label>점검직원 <input id="sign-staff" value="${esc(set.signs.staff)}" /></label>
      <label>현장대리인 <input id="sign-agent" value="${esc(set.signs.agent)}" /></label>
      <label>검측자 <input id="sign-inspector" value="${esc(set.signs.inspector)}" /></label>
      <label>총괄감리원 <input id="sign-chief" value="${esc(set.signs.chief)}" /></label>
      <button class="btn btn-primary" id="btn-save-profile">저장</button>
    </section>
    <section class="card">
      <h2 class="block-title">위치 구조 생성</h2>
      <p class="help">동마다 최하층·최상층·호수 수를 다르게 넣을 수 있습니다. 예: 최하층 지하2, 최상층 15, 호수 수 4.</p>
      <ul class="tree">${locTree || "<li>아직 위치가 없습니다.</li>"}</ul>
      <div class="stack-form">
        <label>동 이름 <input id="inp-gen-dong" placeholder="예: 103동" /></label>
        <div class="loc-grid">
          <label>최하층 <input id="inp-gen-min" placeholder="예: 1 또는 지하2" /></label>
          <label>최상층 <input id="inp-gen-max" placeholder="예: 15" /></label>
        </div>
        <label>호수 수 <input id="inp-gen-units" type="number" min="0" value="4" inputmode="numeric" /></label>
        <button class="btn btn-primary" id="btn-gen-structure">구조 생성</button>
      </div>
      <h3 class="sub-title" id="common-area-title">공용구역</h3>
      <p class="help">가상 동 «공용»이 위치 선택기 동 그리드의 마지막에 놓입니다. 프리셋 칩이나 직접 입력으로 구역을 넣습니다. 지하주차장은 B1·B2를 고를 수 있습니다. 코어는 각 동의 호수/부위에서 고릅니다.</p>
      <div class="chip-row" id="common-presets" aria-label="공용구역 프리셋">${presetChips}</div>
      <label>구역 추가
        <span class="inline">
          <input id="inp-common-area" placeholder="예: 주민공동시설" />
          <button type="button" class="btn" id="btn-add-common-area">구역 추가</button>
        </span>
      </label>
    </section>
    <section class="card">
      <h2 class="block-title">공종</h2>
      <ul class="plain">${tradeList || "<li>아직 공종이 없습니다.</li>"}</ul>
      <label>공종 추가
        <span class="inline">
          <input id="inp-trade" placeholder="예: 도장" />
          <button class="btn" id="btn-add-trade">추가</button>
        </span>
      </label>
    </section>
    <section class="card">
      <h2 class="block-title">현장 시방값</h2>
      <p class="help">슬럼프·공기량·염화물·공시체·도막두께 등, 템플릿에 최소·최대가 비어 있는 숫자 항목의 현장 기준을 넣습니다. 템플릿 원본은 그대로 두고 오버라이드로 저장됩니다.</p>
      <a class="btn btn-primary" id="btn-open-specs" href="#/specs">현장 시방값 입력</a>
    </section>
    <section class="card">
      <h2 class="block-title">체크리스트 템플릿</h2>
      <p class="help">현재 ${tplCount}개. 설정에서 JSON으로 교체할 수 있습니다. (가져오기는 기존 템플릿을 덮어씁니다.)</p>
      <button class="btn" id="btn-import-templates">템플릿 JSON 가져오기</button>
    </section>
    <section class="card">
      <h2 class="block-title">백업</h2>
      <p class="help">모든 기록과 사진·도면을 하나의 zip 파일로 저장하거나 가져옵니다. 가져오기는 현재 데이터를 덮어씁니다.</p>
      <div class="row-actions">
        <button class="btn btn-primary" id="btn-export">내보내기</button>
        <button class="btn" id="btn-import">가져오기</button>
      </div>
      <button type="button" class="btn btn-danger" id="btn-wipe-data">데이터 삭제</button>
      <p class="help">이 기기의 모든 기록·사진·도면·위치를 지우고 처음 상태로 돌립니다. 삭제 전에 백업을 내보내 두세요.</p>
    </section>
    <section class="card muted-card">
      <h2 class="block-title">앱 정보</h2>
      <p>서비스 워커: <span id="sw-status">${esc(sw)}</span></p>
      <p>데이터는 이 기기 브라우저의 IndexedDB에만 저장됩니다.</p>
      <p>음성 입력은 기기·브라우저가 지원할 때만 동작하며, 오프라인에서는 실패할 수 있습니다. 항상 텍스트로 입력할 수 있습니다.</p>
    </section>`;
}

function renderSpecs() {
  const tpls = (state.data.checklistTemplates || []).slice().sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko"));
  const blocks = [];
  for (const tpl of tpls) {
    const rows = (tpl.items || []).filter((it) => needsSpecOverride(it));
    if (!rows.length) continue;
    const fields = rows
      .map((it) => {
        const o = (state.data.specOverrides || []).find((x) => x.itemId === it.id && x.templateId === tpl.id)
          || (state.data.specOverrides || []).find((x) => x.itemId === it.id)
          || {};
        const unit = it.unit ? ` (${it.unit})` : "";
        return `<div class="spec-row" data-template="${esc(tpl.id)}" data-item="${esc(it.id)}">
          <div class="spec-label"><strong>${esc(it.text)}</strong><small>${esc(it.basis || "")}${esc(unit)}</small></div>
          <label>최소 <input type="number" step="any" inputmode="decimal" class="spec-min" value="${esc(o.min ?? "")}" /></label>
          <label>최대 <input type="number" step="any" inputmode="decimal" class="spec-max" value="${esc(o.max ?? "")}" /></label>
        </div>`;
      })
      .join("");
    blocks.push(`<section class="card"><h2 class="block-title">${esc(tpl.name)}</h2>${fields}</section>`);
  }
  return `
    <p class="help">템플릿에 최소·최대가 비어 있는 숫자 항목만 보입니다. 저장해도 템플릿 원본은 바뀌지 않고, 이 현장 값만 따로 보관되며 백업에 포함됩니다. 값이 있을 때만 입력값이 범위를 벗어나면 빨간색으로 표시됩니다.</p>
    ${blocks.length ? blocks.join("") : `<p class="empty">기준을 넣을 숫자 항목이 없습니다.</p>`}
    ${blocks.length ? `<div class="stack-actions"><button type="button" class="btn btn-primary btn-lg" id="btn-save-specs">시방값 저장</button></div>` : ""}`;
}

function needDongFloor() {
  if (!hasDongFloor(state.ctx)) {
    toast("동과 층을 선택하세요. 호수·부위는 선택 사항입니다.");
    return false;
  }
  return true;
}

function renderCapture() {
  return `
    ${locationCard({ readonly: true })}
    <p class="help">사진은 위치·공종·일시 워터마크가 들어갑니다. 영상은 원본 그대로 저장합니다.</p>
    <div class="stack-actions">
      <button class="btn btn-primary btn-lg" id="btn-shot-photo">사진 촬영</button>
      <button class="btn btn-lg" id="btn-shot-video">영상 촬영</button>
      <button class="btn btn-lg" id="btn-shot-album">앨범에서 선택</button>
    </div>`;
}

function currentTemplate(category) {
  const list = templatesOf(state.data.checklistTemplates, category);
  const tradeId = state.ctx.tradeId;
  const idKey = category === "quality" ? "qualityTemplateId" : "inspectTemplateId";
  const selectedId =
    state[idKey] ||
    list.find((t) => t.tradeId === tradeId)?.id ||
    list[0]?.id;
  state[idKey] = selectedId;
  return list.find((t) => t.id === selectedId) || null;
}

function templateSelect(category) {
  const list = templatesOf(state.data.checklistTemplates, category);
  const preferred = state.ctx.tradeId;
  const ordered = [
    ...list.filter((t) => t.tradeId === preferred),
    ...list.filter((t) => t.tradeId !== preferred),
  ];
  const idKey = category === "quality" ? "qualityTemplateId" : "inspectTemplateId";
  if (!ordered.length) return `<option value="">저장된 템플릿이 없습니다</option>`;
  return ordered
    .map((t) => `<option value="${esc(t.id)}" ${t.id === state[idKey] ? "selected" : ""}>${esc(t.name)}</option>`)
    .join("");
}

function eff(it, templateId) {
  return effectiveItem(it, state.data.specOverrides || [], templateId);
}

function itemPhotos(itemId) {
  return state.pendingByItem[itemId] || [];
}

function itemWidget(it, result, role, prefix) {
  const item = eff(it, it._templateId);
  const val = result?.[role]?.value ?? "";
  const id = it.id;
  if (item.kind === "check") {
    const btn = (v, lab, cls = "") =>
      `<button type="button" class="seg ${cls} ${val === v ? "on on-" + v : ""}" data-item="${esc(id)}" data-role="${esc(role)}" data-val="${esc(v)}">${lab}</button>`;
    return `<div class="seg-block">
      <div class="seg-row seg-row-2">${btn("합격", "합격")}${btn("불합격", "불합격")}</div>
      ${btn("해당없음", "해당없음", "seg-na")}
    </div>`;
  }
  if (item.kind === "number") {
    const na = isNaValue(val);
    const shown = na ? "" : val;
    const out = !na && isOutOfRange(item, shown) ? "out-of-range" : "";
    const hint = rangeHint(item);
    return `<div class="num-field">
      <input type="number" step="any" inputmode="decimal" class="val-inp ${out}" data-item="${esc(id)}" data-role="${esc(role)}" value="${esc(shown)}" />
      <span class="unit">${esc(item.unit || "")}</span>
      ${hint ? `<small class="hint">기준 ${esc(hint)}</small>` : ""}
    </div>`;
  }
  if (item.kind === "time") {
    const iid = `${prefix}-${role}-${id}`;
    const today = nowLocalInput().slice(0, 10);
    const date = (val && String(val).slice(0, 10)) || today;
    const hm = val && String(val).includes("T") ? String(val).slice(11, 16) : "";
    const [hh, mm] = hm ? hm.split(":") : ["", ""];
    const dateLab = date === today ? "오늘" : date.replace(/-/g, ".");
    const nowBtn = item.nowButton
      ? `<button type="button" class="btn time-now-btn" data-time-now="${esc(iid)}">지금</button>`
      : "";
    return `<div class="time-hm" data-date="${esc(date)}">
      <input type="hidden" id="${esc(iid)}" class="val-inp" data-item="${esc(id)}" data-role="${esc(role)}" value="${esc(val)}" />
      <div class="time-date">${esc(dateLab)} ${esc(date.slice(5).replace("-", "."))}</div>
      <div class="time-hm-row">
        <input type="text" class="time-hour" inputmode="numeric" pattern="[0-9]*" maxlength="2" aria-label="시" placeholder="시" value="${esc(hh)}" />
        <span class="time-colon">:</span>
        <input type="text" class="time-minute" inputmode="numeric" pattern="[0-9]*" maxlength="2" aria-label="분" placeholder="분" value="${esc(mm)}" />
        ${nowBtn}
      </div>
    </div>`;
  }
  const mode = item.inputmode || "";
  const modeAttr = mode && mode !== "text" ? ` inputmode="${esc(mode)}"${mode === "numeric" ? ' pattern="[0-9]*"' : ""}` : "";
  const chips = isVehicleItem(item)
    ? (recentVehicles(8).map((no) => {
        const on = val === no ? " on" : "";
        return `<button type="button" class="chip${on}" data-vehicle-chip="${esc(no)}" data-item="${esc(id)}" data-role="${esc(role)}">${esc(no)}</button>`;
      }).join(""))
    : "";
  return `<div class="text-field">
    <input type="text" class="val-inp" data-item="${esc(id)}" data-role="${esc(role)}"${modeAttr} value="${esc(val)}" placeholder="${esc(item.text)}" />
    ${chips ? `<div class="chip-row" aria-label="최근 차량번호">${chips}</div>` : ""}
  </div>`;
}

function itemPhotoBar(it, result, { required }) {
  const need = required && itemRequiresPhoto(it) && !isNaResult(result);
  const photos = itemPhotos(it.id);
  const missing = need && photos.length === 0;
  const thumbs = photos
    .map((ph, i) => {
      const url = ph.thumb ? URL.createObjectURL(ph.thumb) : ph.blob ? URL.createObjectURL(ph.blob) : "";
      return url
        ? `<span class="item-thumb-wrap"><img class="item-thumb" alt="사진 ${i + 1}" src="${url}" /><button type="button" class="thumb-del" data-photo-remove="${esc(it.id)}" data-photo-index="${i}" aria-label="사진 삭제">×</button></span>`
        : "";
    })
    .join("");
  if (!required && !photos.length && !itemRequiresPhoto(it)) return "";
  const flag = need
    ? (missing ? `<span class="photo-flag">사진 필수 — 아직 없음</span>` : `<span class="photo-flag">사진 필수 · ${photos.length}장</span>`)
    : `<span class="photo-flag muted">사진 ${photos.length}장</span>`;
  return `<div class="photo-req ${need ? (missing ? "missing" : "ok") : "optional"}">
    ${flag}
    <div class="photo-actions">
      <button type="button" class="btn" data-photo-item="${esc(it.id)}" data-photo-src="camera">촬영</button>
      <button type="button" class="btn" data-photo-item="${esc(it.id)}" data-photo-src="album">선택</button>
    </div>
    ${photos.length ? `<div class="item-thumbs">${thumbs}</div>` : ""}
  </div>`;
}

function renderInspect() {
  const tpl = currentTemplate("inspection");
  const draft = state.inspectDraft || {};
  const items = (tpl?.items || [])
    .map((it) => {
      const r = (draft.results && draft.results[it.id]) || {};
      const need = itemRequiresPhoto(it) && !isNaResult(r);
      const missing = need && itemPhotos(it.id).length === 0;
      it._templateId = tpl.id;
      return `<div class="check-item ${missing ? "needs-photo" : ""}" data-id="${esc(it.id)}">
        <div class="check-text"><strong>${esc(it.text)}</strong><small>판정기준: ${esc(it.basis || "-")}</small></div>
        <div class="role-block"><span class="role-lab">자체점검</span>${itemWidget(it, r, "self", "ins")}</div>
        <input class="note-inp" data-note="${esc(it.id)}" data-role="self" placeholder="비고" value="${esc(r.self?.note || "")}" />
        ${itemPhotoBar(it, r, { required: true })}
      </div>`;
    })
    .join("");
  return `
    ${locationCard({ readonly: true })}
    <form id="form-inspect" class="stack-form">
      <label>체크리스트
        <select id="sel-template">${templateSelect("inspection")}</select>
      </label>
      <label>세부공종
        <input id="inp-subtrade" value="${esc(draft.subTrade || tpl?.name || "")}" />
      </label>
      <label>검측 부위
        <input id="inp-part" value="${esc(draft.part || state.ctx.part || "")}" placeholder="예: 슬래브" />
      </label>
      <label>검측 요구 일시
        <div class="time-field">
          <input type="datetime-local" id="inp-req-dt" value="${esc(draft.requestDateTime || nowLocalInput())}" />
          <button type="button" class="btn" data-time-now="inp-req-dt">현재 시각</button>
        </div>
      </label>
      <label>검측 사항
        ${textWithSpeech("inp-matters", draft.matters || "", "검측 요청 내용을 입력하세요")}
      </label>
      <div id="check-list">${items || `<p class="empty">템플릿이 없습니다. 설정에서 JSON을 가져오세요.</p>`}</div>
      <label>자체점검 합격 의견 (요청 시 필수)
        ${textWithSpeech("inp-self-opinion", draft.selfOpinion || "", "자체점검 결과 합격으로 확인한 의견을 적으세요")}
      </label>
      <fieldset class="attach-set">
        <legend>붙임</legend>
        <label class="chk"><input type="checkbox" id="att-checklist" ${draft.attachments?.checklist === false ? "" : "checked"} /> 체크리스트</label>
        <label class="chk"><input type="checkbox" id="att-test" ${draft.attachments?.testReport ? "checked" : ""} /> 시험성과</label>
        <label class="chk"><input type="checkbox" id="att-drawing" ${draft.attachments?.drawing ? "checked" : ""} /> 도면</label>
        <label class="chk"><input type="checkbox" id="att-roster" ${draft.attachments?.roster ? "checked" : ""} /> 공사참여자 실명부</label>
      </fieldset>
      ${requestActionBar(requestGaps(tpl))}
    </form>`;
}

function renderQuality() {
  const tpl = currentTemplate("quality");
  const draft = state.inspectDraft || {};
  const items = (tpl?.items || [])
    .map((it) => {
      const r = (draft.results && draft.results[it.id]) || {};
      it._templateId = tpl.id;
      const item = eff(it, tpl.id);
      const need = itemRequiresPhoto(it) && !isNaResult(r);
      const missing = need && itemPhotos(it.id).length === 0;
      const naBtn = itemRequiresPhoto(it) && item.kind !== "check"
        ? `<button type="button" class="seg seg-na ${isNaResult(r) ? "on on-해당없음" : ""}" data-item="${esc(it.id)}" data-role="self" data-val="해당없음">해당없음</button>`
        : "";
      return `<div class="check-item ${missing ? "needs-photo" : ""}" data-id="${esc(it.id)}">
        <div class="check-text"><strong>${esc(item.text)}</strong><small>${esc(item.basis || "")}</small></div>
        ${itemWidget(it, r, "self", "qa")}
        ${naBtn}
        ${itemRequiresPhoto(it) ? itemPhotoBar(it, r, { required: true }) : ""}
      </div>`;
    })
    .join("");
  return `
    ${locationCard({ readonly: true })}
    <form id="form-quality" class="stack-form">
      <label>시험 양식
        <select id="sel-q-template">${templateSelect("quality")}</select>
      </label>
      <div id="quality-list">${items || `<p class="empty">품질시험 템플릿이 없습니다.</p>`}</div>
      <p class="help">기준값(최소·최대)을 벗어나면 빨간색으로 표시됩니다. 차량번호는 한글이 섞여도 됩니다. 최근 번호는 칩을 눌러 넣을 수 있습니다. 도착·타설완료 시각은 «지금»으로 넣고, 생산시각은 납품서를 보고 직접 입력하세요. 사진이 필수인 항목은 촬영하거나 앨범에서 고를 수 있고, 해당없음이면 사진이 면제됩니다.</p>
      <p class="help" id="quality-photo-hint"></p>
      <button type="submit" class="btn btn-primary btn-lg" id="btn-save-quality">품질시험 저장</button>
    </form>`;
}

function renderNote() {
  const isMemo = state.isMemo;
  return `
    ${locationCard({ readonly: true })}
    <form id="form-note" class="stack-form">
      <label class="toggle-row">
        <input type="checkbox" id="tog-memo" ${isMemo ? "checked" : ""} />
        <span>지적 아님 (메모)</span>
      </label>
      <p class="help">${isMemo ? "메모로 저장합니다." : "지적 사항으로 저장합니다. 메모는 «지적 아님»을 켜세요."}</p>
      <label>제목
        <input id="inp-note-title" maxlength="80" placeholder="${isMemo ? "메모 제목(선택)" : "지적 제목"}" ${isMemo ? "" : "required"} />
      </label>
      <label>내용
        ${textWithSpeech("inp-note-text", "", isMemo ? "메모를 입력하거나 음성으로 말하세요" : "지적 내용을 입력하세요")}
      </label>
      <button type="submit" class="btn btn-primary btn-lg">${isMemo ? "메모 저장" : "지적 저장"}</button>
    </form>`;
}

function textWithSpeech(id, value, placeholder) {
  const mic = speechSupported()
    ? `<button type="button" class="btn-mic" data-mic="${esc(id)}" aria-label="음성 입력">${iconMic()}</button>`
    : "";
  return `<div class="text-speech">
    <textarea id="${esc(id)}" rows="4" placeholder="${esc(placeholder)}">${esc(value)}</textarea>
    ${mic}
    <p class="help speech-hint">음성 입력은 오프라인에서 동작하지 않을 수 있습니다. 텍스트로도 입력할 수 있습니다.</p>
  </div>`;
}

function renderRecord() {
  const r = state.data.records.find((x) => x.id === state.recordId);
  if (!r) return `<p class="empty">기록을 찾을 수 없습니다.</p>`;
  const medias = state.data.media.filter((m) => m.recordId === r.id || (r.mediaIds || []).includes(m.id));
  const mediaHtml = medias
    .map((m) => {
      const url = m.blob ? URL.createObjectURL(m.blob) : m.thumb ? URL.createObjectURL(m.thumb) : "";
      if ((m.mime || "").startsWith("video/")) return `<video class="media-view" controls src="${url}"></video>`;
      return `<img class="media-view" alt="" src="${url}" />`;
    })
    .join("");
  let extra = "";
  if (r.type === "inspection") extra = renderInspectDetail(r, medias);
  if (r.type === "quality") extra = renderQualityDetail(r);
  return `
    <article class="card">
      <span class="badge badge-${esc(r.type)}">${esc(TYPE_LABEL[r.type] || r.type)}${r.type === "inspection" ? " · " + esc(STATUS_LABEL[r.status] || "") : ""}</span>
      <h2>${esc(r.title || TYPE_LABEL[r.type])}</h2>
      <p class="muted">${esc(formatRecordLocation(state.data.locations, r, { trade: tradeName(state.data.trades, r.tradeId) }))}<br>
      ${esc(formatWhen(r.createdAt))} · ${esc(r.author || getAuthor())}</p>
      ${r.text ? `<p class="body-text">${esc(r.text)}</p>` : ""}
      ${r.extra?.selfOpinion ? `<p><strong>자체점검 의견</strong> ${esc(r.extra.selfOpinion)}</p>` : ""}
      ${mediaHtml}
      ${extra}
      <button class="btn btn-danger" id="btn-del-record">삭제</button>
    </article>`;
}

function renderInspectDetail(r, medias) {
  const tpl = state.data.checklistTemplates.find((t) => t.id === r.extra?.templateId);
  const byId = Object.fromEntries((r.extra?.results || []).map((x) => [x.itemId, x]));
  const rows = (tpl?.items || [])
    .map((it, i) => {
      const x = byId[it.id] || {};
      return `<tr>
        <td>${i + 1}</td>
        <td>${esc(it.text)}</td>
        <td>${esc(it.basis || "")}</td>
        <td>${esc(resultLabel(it, x.self))}<br>${esc(resultLabel(it, x.supervisor))}</td>
        <td>${esc([x.self?.note, x.supervisor?.note].filter(Boolean).join(" / "))}</td>
      </tr>`;
    })
    .join("");
  const stage2 = r.status === "requested" ? supervisorForm(r, tpl) : "";
  const reBtn = r.status === "fail" ? `<button class="btn btn-primary" id="btn-reinspect">재검측</button>` : "";
  return `
    <p>문서번호 ${esc(r.extra?.docNo || "-")} ${r.extra?.parentDocNo ? " · 원본 " + esc(r.extra.parentDocNo) + " (재)" : ""}</p>
    <div class="table-wrap"><table class="chk-table">
      <thead><tr><th>No</th><th>항목</th><th>근거</th><th>자체 / 감리</th><th>비고</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${stage2}
    <div class="row-actions">
      <button class="btn btn-primary" id="btn-export-pdf">검측요청서 PDF</button>
      <button class="btn" id="btn-export-xlsx">엑셀</button>
      ${reBtn}
    </div>`;
}

function supervisorForm(r, tpl) {
  const draft = state.inspectDraft || { results: Object.fromEntries((r.extra?.results || []).map((x) => [x.itemId, x])) };
  const items = (tpl?.items || [])
    .map((it) => {
      const res = draft.results?.[it.id] || {};
      return `<div class="check-item">
        <div class="check-text"><strong>${esc(it.text)}</strong></div>
        <div class="role-block"><span class="role-lab">감리 검측</span>${itemWidget(it, res, "supervisor", "sup")}</div>
        <input class="note-inp" data-note="${esc(it.id)}" data-role="supervisor" placeholder="조치·비고" value="${esc(res.supervisor?.note || "")}" />
      </div>`;
    })
    .join("");
  return `
    <form id="form-supervisor" class="stack-form">
      <h3 class="sub-title">2단계 감리 검측 결과</h3>
      ${items}
      <label>부적합 내용 <textarea id="inp-noncon" rows="2">${esc(r.extra?.nonconformity || "")}</textarea></label>
      <label>조치 <textarea id="inp-action" rows="2">${esc(r.extra?.action || "")}</textarea></label>
      <label>최종 결과
        <div class="seg-row">
          <button type="button" class="seg ${r.extra?.finalResult === "합격" ? "on on-합격" : ""}" id="btn-final-pass" data-final="합격">합격</button>
          <button type="button" class="seg ${r.extra?.finalResult === "불합격" ? "on on-불합격" : ""}" id="btn-final-fail" data-final="불합격">불합격</button>
        </div>
      </label>
      <button type="button" class="btn btn-primary btn-lg" id="btn-save-supervisor">검측 결과 저장</button>
    </form>`;
}

function resultLabel(it, side) {
  if (!side || side.value == null || side.value === "") return "-";
  const item = resolveItem(it);
  if (item.kind === "number") return `${side.value}${item.unit ? " " + item.unit : ""}`;
  if (item.kind === "time") return formatLocalInput(side.value) || side.value;
  return String(side.value);
}

function renderQualityDetail(r) {
  const tpl = state.data.checklistTemplates.find((t) => t.id === r.extra?.templateId);
  const byId = Object.fromEntries((r.extra?.results || []).map((x) => [x.itemId, x]));
  const rows = (tpl?.items || [])
    .map((it) => {
      const item = effectiveItem(it, state.data.specOverrides || [], tpl?.id);
      const v = byId[it.id]?.self?.value ?? "";
      const out = isOutOfRange(item, v);
      return `<tr class="${out ? "row-out" : ""}"><td>${esc(item.text)}</td><td>${esc(v)} ${esc(item.unit || "")}</td><td>${esc(rangeHint(item))}</td></tr>`;
    })
    .join("");
  return `
    <div class="table-wrap"><table class="chk-table">
      <thead><tr><th>항목</th><th>결과</th><th>기준</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <button class="btn" id="btn-export-q-xlsx">엑셀</button>`;
}

function renderDrawingView() {
  const d = state.data.drawings.find((x) => x.id === state.drawingId);
  if (!d) return `<p class="empty">도면을 찾을 수 없습니다.</p>`;
  return `
    <div class="pdf-toolbar">
      <button class="btn" id="pdf-prev">이전</button>
      <span id="pdf-page">-</span>
      <button class="btn" id="pdf-next">다음</button>
      <button class="btn" id="pdf-zoom-out">−</button>
      <button class="btn" id="pdf-zoom-in">+</button>
      <button class="btn btn-danger" id="btn-del-drawing">삭제</button>
    </div>
    <p class="help">${esc(d.name)} · ${esc(labelPath(state.data.locations, d.locationId))}</p>
    <div class="pdf-stage"><canvas id="pdf-canvas"></canvas></div>`;
}

async function paintDrawing() {
  const d = state.data.drawings.find((x) => x.id === state.drawingId);
  const canvas = $("#pdf-canvas");
  if (!d?.pdfBlob || !canvas) return;
  try {
    if (!state.pdfDoc || state.pdfDoc._drawingId !== d.id) {
      const pdf = await openPdfBlob(d.pdfBlob);
      pdf._drawingId = d.id;
      state.pdfDoc = pdf;
      state.pdfPage = 1;
    }
    const pdf = state.pdfDoc;
    state.pdfPage = Math.min(Math.max(1, state.pdfPage), pdf.numPages);
    await renderPage(canvas, pdf, state.pdfPage, state.pdfScale);
    const info = $("#pdf-page");
    if (info) info.textContent = `${state.pdfPage} / ${pdf.numPages}`;
  } catch (e) {
    console.error(e);
    toast("도면을 열 수 없습니다.");
  }
}

function iconCamera() {
  return `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 8h3l2-3h6l2 3h3v11H4V8z"/><circle cx="12" cy="13" r="3.5"/></svg>`;
}
function iconCheck() {
  return `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 12l2.5 2.5L16 9"/></svg>`;
}
function iconMemo() {
  return `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 3h8l5 5v13H7V3z"/><path d="M15 3v5h5M9 13h6M9 17h4"/></svg>`;
}
function iconFlask() {
  return `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 3h6M10 3v6L5 18a3 3 0 0 0 2.6 4h8.8A3 3 0 0 0 19 18l-5-9V3"/><path d="M8 14h8"/></svg>`;
}
function iconMic() {
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4"/></svg>`;
}

function setCtx(patch) {
  state.ctx = { ...state.ctx, ...patch };
  saveCtx(state.ctx);
}

function onChangeLocation(e) {
  const { locations } = state.data;
  if (e.target.id === "sel-dong") {
    const dongId = e.target.value || null;
    const floors = dongId ? childrenOf(locations, dongId, "층") : [];
    setCtx({ dongId, floorId: floors[0]?.id || null, unitId: null });
    render();
  } else if (e.target.id === "sel-floor") {
    setCtx({ floorId: e.target.value || null, unitId: null });
    render();
  } else if (e.target.id === "sel-unit") {
    setCtx({ unitId: e.target.value || null });
    render();
  } else if (e.target.id === "sel-part") {
    setCtx({ part: e.target.value || "" });
    render();
  } else if (e.target.id === "sel-trade") {
    setCtx({ tradeId: e.target.value || null });
    render();
  } else if (e.target.id === "sel-template") {
    state.inspectTemplateId = e.target.value;
    state.inspectDraft = { results: {}, subTrade: state.data.checklistTemplates.find((t) => t.id === e.target.value)?.name || "", selfOpinion: "", matters: "" };
    state.pendingByItem = {};
    render();
  } else if (e.target.id === "sel-q-template") {
    state.qualityTemplateId = e.target.value;
    state.inspectDraft = { results: {} };
    render();
  } else if (e.target.id === "tog-memo") {
    state.isMemo = e.target.checked;
    render();
  }
}

function inspectDraftFromDom() {
  const results = { ...(state.inspectDraft?.results || {}) };
  $$(".seg.on[data-item]").forEach((el) => {
    const id = el.dataset.item;
    const role = el.dataset.role || "self";
    if (!id) return;
    results[id] = results[id] || { self: {}, supervisor: {} };
    results[id][role] = { ...(results[id][role] || {}), value: el.dataset.val };
  });
  $$(".val-inp").forEach((el) => {
    const id = el.dataset.item;
    const role = el.dataset.role || "self";
    if (!id) return;
    results[id] = results[id] || { self: {}, supervisor: {} };
    const v = el.value;
    if (v === "" && isNaValue(results[id][role]?.value)) return;
    results[id][role] = { ...(results[id][role] || {}), value: v };
  });
  $$(".note-inp").forEach((inp) => {
    const id = inp.dataset.note;
    const role = inp.dataset.role || "self";
    results[id] = results[id] || { self: {}, supervisor: {} };
    results[id][role] = { ...(results[id][role] || {}), note: inp.value };
  });
  state.inspectDraft = {
    ...(state.inspectDraft || {}),
    results,
    requestDateTime: $("#inp-req-dt")?.value || state.inspectDraft?.requestDateTime,
    matters: $("#inp-matters")?.value ?? state.inspectDraft?.matters,
    selfOpinion: $("#inp-self-opinion")?.value ?? state.inspectDraft?.selfOpinion,
    subTrade: $("#inp-subtrade")?.value ?? state.inspectDraft?.subTrade,
    part: $("#inp-part")?.value ?? state.inspectDraft?.part,
    attachments: {
      checklist: $("#att-checklist") ? $("#att-checklist").checked : true,
      testReport: $("#att-test")?.checked || false,
      drawing: $("#att-drawing")?.checked || false,
      roster: $("#att-roster")?.checked || false,
    },
    nonconformity: $("#inp-noncon")?.value ?? state.inspectDraft?.nonconformity,
    action: $("#inp-action")?.value ?? state.inspectDraft?.action,
    finalResult: state.inspectDraft?.finalResult,
  };
}

/** 자체점검 합격 의견: #inp-self-opinion (draft.selfOpinion / extra.selfOpinion). */
function selfOpinionValue(draft = state.inspectDraft) {
  const el = $("#inp-self-opinion");
  if (el) return String(el.value || "").trim();
  return String(draft?.selfOpinion || "").trim();
}

function requestGaps(tpl) {
  const results = state.inspectDraft?.results || {};
  const missingPhotos = missingPhotoItems(tpl, state.pendingByItem, results);
  const photoIds = new Set(missingPhotos.map((it) => it.id));
  const unfilled = (tpl?.items || []).filter((it) => !selfFilled(it, results[it.id]));
  const unfilledIds = new Set(unfilled.map((it) => it.id));
  const opinionMissing = !selfOpinionValue();
  const gaps = [];
  for (const it of tpl?.items || []) {
    if (unfilledIds.has(it.id)) gaps.push({ type: "result", item: it, selector: `.check-item[data-id="${it.id}"]` });
    else if (photoIds.has(it.id)) gaps.push({ type: "photo", item: it, selector: `.check-item[data-id="${it.id}"]` });
  }
  if (opinionMissing) gaps.push({ type: "opinion", item: null, selector: "#inp-self-opinion" });
  return {
    count: gaps.length,
    unfilled,
    missingPhotos,
    opinionMissing,
    gaps,
    ok: gaps.length === 0,
  };
}

function canRequestInspect(tpl) {
  const g = requestGaps(tpl);
  return {
    ok: g.ok,
    missingVals: g.unfilled.length > 0,
    missingOpinion: g.opinionMissing,
    missingPhotos: g.missingPhotos,
    count: g.count,
    gaps: g.gaps,
  };
}

function scrollToGap(gap) {
  if (!gap) return;
  const el = document.querySelector(gap.selector);
  if (!el) return;
  el.scrollIntoView({ behavior: "instant", block: "center" });
  if (gap.type === "opinion") {
    const inp = $("#inp-self-opinion");
    if (inp && typeof inp.focus === "function") inp.focus({ preventScroll: true });
  }
}

function toastRequestGaps(tpl) {
  inspectDraftFromDom();
  const g = requestGaps(tpl);
  if (g.ok) return true;
  scrollToGap(g.gaps[0]);
  const first = g.gaps[0];
  if (first?.type === "result") toast("모든 항목의 자체점검 결과를 입력하세요.");
  else if (first?.type === "photo") {
    const names = g.missingPhotos.map((it) => shortItemLabel(it));
    toast(`사진이 필요한 항목: ${names.join(", ")}`);
  } else if (first?.type === "opinion") toast("자체점검 합격 의견을 입력하세요.");
  syncRequestState();
  return false;
}

function requestHintText(tpl, g) {
  if (g.ok) return (tpl?.items || []).some(itemRequiresPhoto) ? "필수 항목을 모두 채웠습니다." : "";
  return `자체점검 ${g.count}개 남음 (결과 미입력 ${g.unfilled.length}, 사진 부족 ${g.missingPhotos.length}, 합격 의견 ${g.opinionMissing ? "미입력" : "입력됨"})`;
}

function requestActionBar(g) {
  const remain = g.ok ? "" : `자체점검 ${g.count}개 남음`;
  const hint = requestHintText(currentTemplate("inspection"), g);
  return `<p class="help ${g.ok ? "" : "warn-text"}" id="photo-hint">${esc(hint)}</p>
      <div class="stack-actions">
        <button type="button" class="btn btn-lg" id="btn-save-draft">작성 저장</button>
        <button type="button" class="request-remain" id="btn-request-remain" ${g.ok ? "hidden" : ""}>${esc(remain)}</button>
        <button type="button" class="btn btn-primary btn-lg${g.ok ? " is-ready" : ""}" id="btn-request-inspect"${g.ok ? "" : " disabled"} aria-disabled="${g.ok ? "false" : "true"}">요청</button>
      </div>`;
}

/** 남은 개수와 요청 버튼 상태를 한곳에서 다시 계산한다. */
function syncRequestState() {
  const btn = $("#btn-request-inspect");
  if (!btn) return null;
  inspectDraftFromDom();
  const tpl = currentTemplate("inspection");
  const g = requestGaps(tpl);
  btn.classList.toggle("is-ready", g.ok);
  if (g.ok) btn.removeAttribute("disabled");
  else btn.setAttribute("disabled", "");
  btn.disabled = !g.ok;
  btn.setAttribute("aria-disabled", g.ok ? "false" : "true");
  btn.textContent = "요청";
  const remain = $("#btn-request-remain");
  if (remain) {
    remain.hidden = g.ok;
    remain.textContent = g.ok ? "" : `자체점검 ${g.count}개 남음`;
  }
  const hint = $("#photo-hint");
  if (hint) {
    hint.textContent = requestHintText(tpl, g);
    hint.classList.toggle("warn-text", !g.ok);
  }
  return g;
}

function updateRequestEnabled() {
  return syncRequestState();
}

function qualityPhotoGaps(tpl) {
  inspectDraftFromDom();
  return missingPhotoItems(tpl, state.pendingByItem, state.inspectDraft?.results || {});
}

function updateQualitySaveEnabled() {
  const btn = $("#btn-save-quality");
  if (!btn) return;
  const tpl = currentTemplate("quality");
  const missing = qualityPhotoGaps(tpl);
  const ok = missing.length === 0;
  btn.classList.toggle("is-ready", ok);
  btn.setAttribute("aria-disabled", ok ? "false" : "true");
  const hint = $("#quality-photo-hint");
  if (hint) {
    hint.textContent = ok ? "" : `사진이 필요한 항목 ${missing.length}개. 해당없음이면 면제됩니다.`;
    hint.classList.toggle("warn-text", !ok);
  }
}

async function flushPendingMedia(recordId) {
  const recIds = [];
  const byItem = {};
  const photoNosByItem = {};
  let no = 1;
  for (const [itemId, files] of Object.entries(state.pendingByItem)) {
    byItem[itemId] = [];
    photoNosByItem[itemId] = [];
    for (const p of files || []) {
      const media = {
        id: db.uid(),
        recordId,
        itemId,
        blob: p.blob,
        mime: p.mime,
        thumb: p.thumb,
        createdAt: db.nowIso(),
        caption: p.caption || "",
      };
      await db.add("media", media);
      recIds.push(media.id);
      byItem[itemId].push(media.id);
      photoNosByItem[itemId].push(String(no++));
    }
  }
  state.pendingByItem = {};
  state.photoTargetItemId = null;
  return { recIds, byItem, photoNosByItem };
}

async function saveInspect(asRequest) {
  if (!needDongFloor()) return;
  inspectDraftFromDom();
  const tpl = currentTemplate("inspection");
  if (!tpl) return toast("체크리스트를 선택하세요.");
  const draft = state.inspectDraft;
  if (asRequest && !toastRequestGaps(tpl)) return;
  const results = (tpl.items || []).map((it) => {
    const r = draft.results?.[it.id] || {};
    return {
      itemId: it.id,
      self: { value: r.self?.value ?? "", note: r.self?.note || "", mediaIds: [] },
      supervisor: { value: r.supervisor?.value ?? "", note: r.supervisor?.note || "", mediaIds: [] },
      photoNos: r.photoNos || [],
    };
  });
  const rec = {
    id: db.uid(),
    type: "inspection",
    locationId: currentLocationId(),
    tradeId: state.ctx.tradeId,
    createdAt: db.nowIso(),
    author: getAuthor(),
    status: asRequest ? "requested" : "draft",
    title: tpl.name,
    text: draft.matters || "",
    mediaIds: [],
    extra: {
      templateId: tpl.id,
      docNo: asRequest ? nextDocNo() : "",
      requestDate: (draft.requestDateTime || nowLocalInput()).slice(0, 10),
      requestDateTime: draft.requestDateTime || nowLocalInput(),
      part: draft.part || state.ctx.part || "",
      subTrade: draft.subTrade || tpl.name,
      locationSentence: officialLocation(state.data.locations, state.ctx, draft.part || state.ctx.part),
      matters: draft.matters || "",
      selfOpinion: draft.selfOpinion || "",
      results,
      attachments: draft.attachments || { checklist: true },
      projectName: loadSettings().projectName,
      parentInspectionId: draft.parentInspectionId || null,
      parentDocNo: draft.parentDocNo || "",
    },
  };
  const flushed = await flushPendingMedia(rec.id);
  rec.mediaIds = flushed.recIds;
  rec.extra.results = rec.extra.results.map((row) => ({
    ...row,
    self: { ...(row.self || {}), mediaIds: flushed.byItem[row.itemId] || [] },
    photoNos: flushed.photoNosByItem[row.itemId] || [],
  }));
  await db.add("records", rec);
  state.inspectDraft = null;
  state.pendingByItem = {};
  await reload();
  toast(asRequest ? "검측을 요청했습니다." : "작성 중인 검측을 저장했습니다.");
  go(`/record/${rec.id}`);
  state.inspectDraft = null;
  state.pendingByItem = {};
}

async function saveSupervisor() {
  const r = state.data.records.find((x) => x.id === state.recordId);
  if (!r) return;
  inspectDraftFromDom();
  const final = state.inspectDraft?.finalResult;
  if (final !== "합격" && final !== "불합격") return toast("최종 결과(합격/불합격)를 선택하세요.");
  const tpl = state.data.checklistTemplates.find((t) => t.id === r.extra?.templateId);
  const draft = state.inspectDraft;
  const results = (tpl?.items || []).map((it) => {
    const prev = (r.extra.results || []).find((x) => x.itemId === it.id) || {};
    const cur = draft.results?.[it.id] || {};
    return {
      itemId: it.id,
      self: prev.self || { value: "", note: "", mediaIds: [] },
      supervisor: { value: cur.supervisor?.value ?? "", note: cur.supervisor?.note || "", mediaIds: [] },
      photoNos: prev.photoNos || [],
    };
  });
  r.status = final === "합격" ? "pass" : "fail";
  r.extra = {
    ...r.extra,
    results,
    finalResult: final,
    nonconformity: draft.nonconformity || "",
    action: draft.action || "",
    supervisedAt: db.nowIso(),
  };
  r.author = r.author || getAuthor();
  await db.put("records", r);
  state.inspectDraft = null;
  await reload();
  toast("검측 결과를 저장했습니다.");
  render();
}

async function startReinspect() {
  const r = state.data.records.find((x) => x.id === state.recordId);
  if (!r) return;
  state.inspectTemplateId = r.extra?.templateId;
  state.inspectDraft = {
    results: {},
    parentInspectionId: r.id,
    parentDocNo: r.extra?.docNo || "",
    part: r.extra?.part || "",
    subTrade: r.extra?.subTrade || r.title,
    matters: r.extra?.matters || "",
    attachments: r.extra?.attachments,
  };
  if (r.locationId) setCtx({ ...state.ctx, ...decomposePath(state.data.locations, r.locationId), part: r.extra?.part || "" });
  toast("재검측 작성을 시작합니다. 자체점검을 다시 입력하세요.");
  go("/inspect");
}

async function saveQuality(ev) {
  ev.preventDefault();
  if (!needDongFloor()) return;
  inspectDraftFromDom();
  const tpl = currentTemplate("quality");
  if (!tpl) return toast("시험 양식을 선택하세요.");
  const draft = state.inspectDraft || {};
  const missing = qualityPhotoGaps(tpl);
  if (missing.length) {
    const first = missing[0];
    const el = document.querySelector(`.check-item[data-id="${first.id}"]`);
    if (el) el.scrollIntoView({ behavior: "instant", block: "center" });
    toast(`사진이 필요한 항목: ${missing.map((it) => shortItemLabel(it)).join(", ")}`);
    updateQualitySaveEnabled();
    return;
  }
  const results = (tpl.items || []).map((it) => {
    const r = draft.results?.[it.id] || {};
    return { itemId: it.id, self: { value: r.self?.value ?? "", note: r.self?.note || "", mediaIds: [] }, supervisor: { value: "", note: "", mediaIds: [] }, photoNos: [] };
  });
  const rec = {
    id: db.uid(),
    type: "quality",
    locationId: currentLocationId(),
    tradeId: state.ctx.tradeId,
    createdAt: db.nowIso(),
    author: getAuthor(),
    status: "recorded",
    title: tpl.name,
    text: "",
    mediaIds: [],
    extra: {
      templateId: tpl.id,
      locationSentence: officialLocation(state.data.locations, state.ctx, state.ctx.part),
      part: state.ctx.part || "",
      results,
    },
  };
  const flushed = await flushPendingMedia(rec.id);
  rec.mediaIds = flushed.recIds;
  rec.extra.results = rec.extra.results.map((row) => ({
    ...row,
    self: { ...(row.self || {}), mediaIds: flushed.byItem[row.itemId] || [] },
    photoNos: flushed.photoNosByItem[row.itemId] || [],
  }));
  await db.add("records", rec);
  for (const it of tpl.items || []) {
    if (isVehicleItem(it)) {
      const v = results.find((r) => r.itemId === it.id)?.self?.value;
      rememberVehicle(v);
    }
  }
  state.inspectDraft = null;
  state.pendingByItem = {};
  await reload();
  toast("품질시험을 저장했습니다.");
  go(`/record/${rec.id}`);
  state.inspectDraft = null;
  state.pendingByItem = {};
}

async function saveNote(ev) {
  ev.preventDefault();
  if (!needDongFloor()) return;
  const isMemo = state.isMemo;
  const title = ($("#inp-note-title")?.value || "").trim();
  const text = ($("#inp-note-text")?.value || "").trim();
  if (!isMemo && !title) return toast("제목을 입력하세요.");
  if (!text) return toast("내용을 입력하세요.");
  const rec = {
    id: db.uid(),
    type: isMemo ? "memo" : "issue",
    locationId: currentLocationId(),
    tradeId: state.ctx.tradeId,
    createdAt: db.nowIso(),
    author: getAuthor(),
    status: isMemo ? "recorded" : "open",
    title: title || text.slice(0, 24),
    text,
    mediaIds: [],
    extra: { locationSentence: officialLocation(state.data.locations, state.ctx, state.ctx.part), part: state.ctx.part || "" },
  };
  await db.add("records", rec);
  await reload();
  toast(isMemo ? "메모를 저장했습니다." : "지적을 저장했습니다.");
  go(`/record/${rec.id}`);
}

async function handleFiles(files, source) {
  if (!needDongFloor()) return;
  const list = [...files];
  if (!list.length) return;
  for (const file of list) {
    const mime = file.type || "";
    const isVideo = mime.startsWith("video/");
    const isImage = mime.startsWith("image/");
    if (!isVideo && !isImage) {
      toast("사진 또는 영상만 저장할 수 있습니다.");
      continue;
    }
    let blob = file;
    const info = {
      locationLabel: locationLabel(),
      tradeName: tradeName(state.data.trades, state.ctx.tradeId),
      datetime: formatWhen(new Date().toISOString()),
      author: getAuthor(),
    };
    if (isImage) {
      try {
        blob = await addWatermark(file, info);
      } catch (e) {
        console.error(e);
        toast("워터마크를 넣지 못해 원본을 저장합니다.");
        blob = file;
      }
    }
    const rec = {
      id: db.uid(),
      type: isVideo ? "video" : "photo",
      locationId: currentLocationId(),
      tradeId: state.ctx.tradeId,
      createdAt: db.nowIso(),
      author: getAuthor(),
      status: "recorded",
      title: isVideo ? "현장 영상" : "현장 사진",
      text: "",
      mediaIds: [],
      extra: { source, watermarked: isImage && blob !== file, locationSentence: locationLabel(), part: state.ctx.part || "" },
    };
    const media = {
      id: db.uid(),
      recordId: rec.id,
      blob,
      mime: isImage ? "image/jpeg" : mime,
      thumb: await makeThumb(blob, isImage ? "image/jpeg" : mime),
      createdAt: rec.createdAt,
    };
    rec.mediaIds = [media.id];
    await db.add("records", rec);
    await db.add("media", media);
  }
  await reload();
  toast("저장했습니다.");
  go("/browse");
}

async function handleInspectPhotos(files) {
  inspectDraftFromDom();
  const itemId = state.photoTargetItemId;
  if (!itemId) {
    toast("사진을 붙일 항목의 «촬영» 또는 «선택»을 먼저 눌러 주세요.");
    return;
  }
  if (!state.pendingByItem[itemId]) state.pendingByItem[itemId] = [];
  const added = [];
  for (const file of files || []) {
    if (!(file.type || "").startsWith("image/")) continue;
    const rec = { blob: file, mime: file.type || "image/jpeg", thumb: file, caption: "" };
    state.pendingByItem[itemId].push(rec);
    added.push({ rec, file });
  }
  if (!added.length) return;
  const n = itemPhotos(itemId).length;
  toast(`이 항목에 사진 ${n}장 첨부`);
  syncRequestState();
  render();
  for (const { rec, file } of added) {
    try {
      rec.blob = await addWatermark(file, {
        locationLabel: locationLabel(),
        tradeName: tradeName(state.data.trades, state.ctx.tradeId),
        datetime: formatWhen(new Date().toISOString()),
        author: getAuthor(),
      });
      rec.mime = "image/jpeg";
      rec.thumb = await makeThumb(rec.blob, "image/jpeg");
    } catch {
      try { rec.thumb = await makeThumb(rec.blob || file, file.type || "image/jpeg"); } catch { /* keep file */ }
    }
  }
  inspectDraftFromDom();
  render();
}

async function handlePdf(files) {
  if (!state.ctx.dongId) {
    toast("도면은 동을 선택한 뒤 올리세요.");
    return;
  }
  const file = files[0];
  if (!file) return;
  if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return toast("PDF 파일만 올릴 수 있습니다.");
  }
  const drawing = {
    id: db.uid(),
    locationId: state.ctx.dongId,
    tradeId: state.ctx.tradeId,
    name: file.name.replace(/\.pdf$/i, "") || "도면",
    pdfBlob: file,
  };
  await db.add("drawings", drawing);
  await reload();
  toast("도면을 올렸습니다.");
  go(`/drawing/${drawing.id}`);
}

async function doExport() {
  try {
    toast("백업 파일을 만드는 중…", 8000);
    const blob = await exportBackupZip();
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `현장관리-백업-${stamp}.zip`);
    toast("백업을 내보냈습니다.");
  } catch (e) {
    console.error(e);
    toast("내보내기에 실패했습니다.");
  }
}

async function doImport(file) {
  if (!file) return;
  try {
    toast("가져오는 중…", 8000);
    await importBackupZip(file);
    await reload();
    render();
    toast("백업을 가져왔습니다. 기존 데이터는 덮어썼습니다.");
  } catch (e) {
    console.error(e);
    toast(e.message || "가져오기에 실패했습니다.");
  }
}

async function importTemplatesFile(file) {
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    const list = await replaceTemplates(raw, state.data.trades);
    saveSettings({ templateSource: "imported" });
    await reload();
    render();
    toast(`템플릿 ${list.length}개를 가져왔습니다.`);
  } catch (e) {
    console.error(e);
    toast(e.message || "템플릿을 가져오지 못했습니다.");
  }
}

async function exportCurrentPdf() {
  const r = state.data.records.find((x) => x.id === state.recordId);
  if (!r) return;
  const tpl = state.data.checklistTemplates.find((t) => t.id === r.extra?.templateId);
  try {
    toast("PDF를 만드는 중…", 12000);
    const blob = await exportInspectionPdf({
      record: r,
      template: tpl,
      locations: state.data.locations,
      trades: state.data.trades,
      siteName: site()?.name,
      media: state.data.media,
    });
    downloadBlob(blob, `${r.extra?.docNo || "검측요청서"}.pdf`);
    toast("검측요청서 PDF를 저장했습니다.");
  } catch (e) {
    console.error(e);
    toast("PDF 작성에 실패했습니다.");
  }
}

async function exportCurrentXlsx() {
  const r = state.data.records.find((x) => x.id === state.recordId);
  if (!r) return;
  const tpl = state.data.checklistTemplates.find((t) => t.id === r.extra?.templateId);
  const blob =
    r.type === "quality"
      ? exportQualityXlsx({
          record: r,
          template: tpl,
          locations: state.data.locations,
          trades: state.data.trades,
          siteName: site()?.name,
          records: state.data.records.filter((x) => x.type === "quality"),
        })
      : exportInspectionXlsx({ record: r, template: tpl, locations: state.data.locations, trades: state.data.trades, siteName: site()?.name });
  downloadBlob(blob, `${r.title || "검측"}.xlsx`);
  toast("엑셀 파일을 저장했습니다.");
}

async function saveSpecs() {
  const rows = $$(".spec-row");
  const existing = state.data.specOverrides || [];
  const seen = new Set();
  for (const row of rows) {
    const templateId = row.dataset.template;
    const itemId = row.dataset.item;
    const min = row.querySelector(".spec-min")?.value ?? "";
    const max = row.querySelector(".spec-max")?.value ?? "";
    const id = `${templateId}::${itemId}`;
    seen.add(id);
    const prev = existing.find((o) => o.id === id || (o.templateId === templateId && o.itemId === itemId));
    if (min === "" && max === "") {
      if (prev) await db.remove("specOverrides", prev.id);
      continue;
    }
    await db.put("specOverrides", { id, templateId, itemId, min, max });
  }
  await reload();
  toast("현장 시방값을 저장했습니다.");
  render();
}

function startMic(targetId) {
  const ta = document.getElementById(targetId);
  if (!ta) return;
  if (!speechSupported()) {
    toast("이 브라우저는 음성 입력을 지원하지 않습니다. 텍스트로 입력하세요.");
    return;
  }
  if (state.dictation) {
    try { state.dictation.stop(); } catch {}
    state.dictation = null;
    toast("음성 입력을 멈췄습니다.");
    return;
  }
  const base = ta.value;
  const rec = startDictation({
    onText: (text) => {
      ta.value = (base ? base + (base.endsWith("\n") ? "" : " ") : "") + text;
    },
    onError: (err) => {
      state.dictation = null;
      const map = {
        "not-allowed": "마이크 권한이 없습니다. 텍스트로 입력하세요.",
        network: "음성 인식 서버에 연결할 수 없습니다. 텍스트로 입력하세요.",
        "no-speech": "음성이 감지되지 않았습니다.",
        unsupported: "음성 입력을 지원하지 않습니다. 텍스트로 입력하세요.",
      };
      toast(map[err] || "음성 입력을 사용할 수 없습니다. 텍스트로 입력하세요.");
    },
    onEnd: () => {
      state.dictation = null;
    },
  });
  state.dictation = rec;
  if (rec) toast("듣고 있습니다… 말하면 텍스트로 들어갑니다.");
}

async function onClick(e) {
  const t = e.target.closest("[data-go],[data-tab],button,a");
  if (!t) return;
  if (t.dataset.timeNow) {
    e.preventDefault();
    const now = nowLocalInput();
    const inp = document.getElementById(t.dataset.timeNow);
    if (inp) {
      inp.value = now;
      inp.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const wrap = t.closest(".time-hm");
    if (wrap) {
      wrap.dataset.date = now.slice(0, 10);
      const [hh, mm] = now.slice(11, 16).split(":");
      const h = wrap.querySelector(".time-hour");
      const m = wrap.querySelector(".time-minute");
      if (h) h.value = hh;
      if (m) m.value = mm;
    }
    return;
  }
  if (t.dataset.vehicleChip != null) {
    e.preventDefault();
    inspectDraftFromDom();
    const itemId = t.dataset.item;
    const role = t.dataset.role || "self";
    const v = t.dataset.vehicleChip;
    if (itemId) {
      const draft = state.inspectDraft || { results: {} };
      draft.results = draft.results || {};
      draft.results[itemId] = draft.results[itemId] || { self: {}, supervisor: {} };
      draft.results[itemId][role] = { ...(draft.results[itemId][role] || {}), value: v };
      state.inspectDraft = draft;
    }
    render();
    return;
  }
  if (t.id === "btn-open-loc-picker") {
    e.preventDefault();
    openLocPicker();
    return;
  }
  if (t.id === "btn-floor-down") {
    e.preventDefault();
    shiftFloor(-1);
    return;
  }
  if (t.id === "btn-floor-up") {
    e.preventDefault();
    shiftFloor(1);
    return;
  }
  if (t.id === "btn-picker-done") {
    e.preventDefault();
    completeLocPicker();
    return;
  }
  if (t.id === "btn-picker-next") {
    e.preventDefault();
    if (state.locPicker) state.locPicker.step = "trade";
    render();
    return;
  }
  if (t.dataset.pickerStep) {
    e.preventDefault();
    if (state.locPicker) state.locPicker.step = t.dataset.pickerStep;
    render();
    return;
  }
  if (t.dataset.pick) {
    e.preventDefault();
    applyPick(t.dataset.pick, t.dataset.id ?? "");
    return;
  }
  if (t.dataset.locChip != null) {
    e.preventDefault();
    try { applyLocChip(JSON.parse(t.dataset.locChip)); } catch {}
    return;
  }
  if (t.dataset.go) {
    e.preventDefault();
    if (!needDongFloor()) return;
    if (t.dataset.go === "note") state.isMemo = false;
    if (t.dataset.go === "inspect" || t.dataset.go === "quality") {
      if (!state.inspectDraft?.parentInspectionId) {
        state.inspectDraft = null;
        state.pendingByItem = {};
        state.photoTargetItemId = null;
      }
    }
    go(t.dataset.go);
    return;
  }
  if (t.id === "btn-back") {
    history.back();
    return;
  }
  if (t.dataset.filter) {
    state.typeFilter = t.dataset.filter;
    render();
    return;
  }
  if (t.dataset.item && t.dataset.val) {
    inspectDraftFromDom();
    const id = t.dataset.item;
    const role = t.dataset.role || "self";
    state.inspectDraft.results = state.inspectDraft.results || {};
    state.inspectDraft.results[id] = state.inspectDraft.results[id] || { self: {}, supervisor: {} };
    state.inspectDraft.results[id][role] = { ...(state.inspectDraft.results[id][role] || {}), value: t.dataset.val };
    render();
    return;
  }
  if (t.dataset.final) {
    inspectDraftFromDom();
    state.inspectDraft.finalResult = t.dataset.final;
    render();
    return;
  }
  if (t.dataset.photoRemove != null) {
    e.preventDefault();
    inspectDraftFromDom();
    const id = t.dataset.photoRemove;
    const idx = Number(t.dataset.photoIndex);
    const list = state.pendingByItem[id] || [];
    if (Number.isInteger(idx) && idx >= 0 && idx < list.length) list.splice(idx, 1);
    if (!list.length) delete state.pendingByItem[id];
    syncRequestState();
    render();
    return;
  }
  if (t.dataset.photoItem) {
    e.preventDefault();
    inspectDraftFromDom();
    state.photoTargetItemId = t.dataset.photoItem;
    const src = t.dataset.photoSrc || "album";
    const inp = src === "camera" ? $("#input-item-camera") : $("#input-inspect-photo");
    if (inp) inp.click();
    return;
  }
  if (t.dataset.commonPreset) {
    e.preventDefault();
    const created = await addCommonArea(t.dataset.commonPreset);
    await reload();
    toast(created.length ? `«${t.dataset.commonPreset}»을 공용구역에 추가했습니다.` : `«${t.dataset.commonPreset}»은 이미 있습니다.`);
    render();
    return;
  }
  if (t.dataset.mic) {
    e.preventDefault();
    startMic(t.dataset.mic);
    return;
  }
  switch (t.id) {
    case "btn-shot-photo":
      $("#input-photo").click();
      break;
    case "btn-shot-video":
      $("#input-video").click();
      break;
    case "btn-shot-album":
      $("#input-album").click();
      break;
    case "btn-upload-pdf":
      $("#input-pdf").click();
      break;
    case "btn-export":
      await doExport();
      break;
    case "btn-import":
      $("#input-backup").click();
      break;
    case "btn-import-templates":
      $("#input-templates").click();
      break;
    case "btn-save-specs":
      await saveSpecs();
      break;
    case "btn-export-pdf":
      await exportCurrentPdf();
      break;
    case "btn-export-xlsx":
    case "btn-export-q-xlsx":
      await exportCurrentXlsx();
      break;
    case "btn-save-draft":
      await saveInspect(false);
      break;
    case "btn-request-remain":
      toastRequestGaps(currentTemplate("inspection"));
      break;
    case "btn-request-inspect":
      if ($("#btn-request-inspect")?.disabled || $("#btn-request-inspect")?.getAttribute("aria-disabled") === "true") {
        return;
      }
      await saveInspect(true);
      break;
    case "btn-add-common-area": {
      const name = ($("#inp-common-area")?.value || "").trim();
      if (!name) return toast("구역 이름을 입력하세요.");
      const created = await addCommonArea(name);
      await reload();
      toast(created.length ? `«${name}»을 공용구역에 추가했습니다.` : `«${name}»은 이미 있습니다.`);
      render();
      break;
    }
    case "btn-wipe-data":
      await wipeAllData();
      break;
    case "btn-save-supervisor":
      await saveSupervisor();
      break;
    case "btn-reinspect":
      await startReinspect();
      break;
    case "btn-save-profile": {
      const s = site();
      if (s) {
        s.name = $("#inp-site").value.trim() || s.name;
        await db.put("sites", s);
      }
      saveSettings({
        author: $("#inp-author").value,
        projectName: $("#inp-project").value,
        recipient: $("#inp-recipient").value,
        signs: {
          staff: $("#sign-staff").value,
          agent: $("#sign-agent").value,
          inspector: $("#sign-inspector").value,
          chief: $("#sign-chief").value,
        },
      });
      await reload();
      toast("저장했습니다.");
      render();
      break;
    }
    case "btn-gen-structure": {
      const s = site();
      if (!s) return;
      const name = ($("#inp-gen-dong").value || "").trim();
      const minF = parseFloorToken($("#inp-gen-min").value);
      const maxF = parseFloorToken($("#inp-gen-max").value);
      const unitCount = Number($("#inp-gen-units").value || 0);
      if (!name || minF == null || maxF == null) return toast("동 이름과 최하층·최상층을 입력하세요.");
      let dong = rootsOf(state.data.locations, s.id, "동").find((d) => d.name === name);
      if (!dong) {
        dong = { id: db.uid(), siteId: s.id, parentId: null, type: "동", name, order: rootsOf(state.data.locations, s.id, "동").length + 1 };
        await db.add("locations", dong);
        state.data.locations.push(dong);
      }
      const created = planDongStructure({
        siteId: s.id,
        dong,
        dongName: name,
        minFloor: minF,
        maxFloor: maxF,
        unitCount,
        existing: state.data.locations,
        uid: db.uid,
      });
      for (const row of created) await db.add("locations", row);
      await reload();
      toast(`${name} 구조를 생성했습니다. (${created.length}개 추가)`);
      render();
      break;
    }
    case "btn-add-trade": {
      const name = $("#inp-trade").value.trim();
      if (!name) return toast("공종 이름을 입력하세요.");
      await db.add("trades", { id: db.uid(), name, order: state.data.trades.length + 1 });
      await reload();
      toast("공종을 추가했습니다.");
      render();
      break;
    }
    case "btn-del-record": {
      if (!confirm("이 기록을 삭제할까요? 연결된 사진·영상도 삭제됩니다.")) return;
      const id = state.recordId;
      const medias = state.data.media.filter((m) => m.recordId === id);
      for (const m of medias) await db.remove("media", m.id);
      await db.remove("records", id);
      await reload();
      toast("삭제했습니다.");
      go("/browse");
      break;
    }
    case "btn-del-drawing": {
      if (!confirm("이 도면을 삭제할까요?")) return;
      await db.remove("drawings", state.drawingId);
      state.pdfDoc = null;
      await reload();
      toast("삭제했습니다.");
      go("/drawings");
      break;
    }
    case "pdf-prev":
      state.pdfPage -= 1;
      await paintDrawing();
      break;
    case "pdf-next":
      state.pdfPage += 1;
      await paintDrawing();
      break;
    case "pdf-zoom-in":
      state.pdfScale = Math.min(3, state.pdfScale + 0.2);
      await paintDrawing();
      break;
    case "pdf-zoom-out":
      state.pdfScale = Math.max(0.5, state.pdfScale - 0.2);
      await paintDrawing();
      break;
  }
}

function onSubmit(e) {
  if (e.target.id === "form-quality") return saveQuality(e);
  if (e.target.id === "form-note") return saveNote(e);
}

async function registerSw() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("./sw.js");
    const status = $("#sw-status");
    if (status) status.textContent = reg.active || navigator.serviceWorker.controller ? "등록됨" : "등록 중";
  } catch (e) {
    console.warn("SW register failed", e);
  }
}

async function wipeAllData() {
  if (!confirm("모든 기록·사진·도면과 위치 데이터를 이 기기에서 삭제합니다. 백업을 먼저 저장했나요?")) return;
  if (!confirm("되돌릴 수 없습니다. 정말 삭제할까요?")) return;
  for (const name of db.STORES) await db.clearStore(name);
  localStorage.removeItem("site-app-ctx");
  localStorage.removeItem("site-app-settings");
  state.inspectDraft = null;
  state.pendingByItem = {};
  location.reload();
}

async function init() {
  const seeded = await db.seedIfEmpty();
  const trades = await db.getAll("trades");
  await ensureBuiltinTemplates(trades);
  await reload();
  if (seeded && seeded.dongId) {
    setCtx({
      siteId: seeded.siteId,
      tradeId: seeded.tradeId,
      dongId: seeded.dongId,
      floorId: seeded.floorId,
      unitId: null,
      part: "",
    });
  }
  parseHash();
  rememberCurrentLocation();
  render();
  await registerSw();
  if (state.view === "settings") render();
}

document.addEventListener("change", (e) => {
  const id = e.target.id;
  if (["sel-dong", "sel-floor", "sel-unit", "sel-part", "sel-trade", "sel-template", "sel-q-template", "tog-memo"].includes(id)) {
    onChangeLocation(e);
    return;
  }
  if (state.view === "inspect" && e.target.matches("textarea, input, .val-inp, .note-inp, #inp-self-opinion")) {
    syncRequestState();
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "inp-drawing-search") {
    state.drawingQuery = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const inp = $("#inp-drawing-search");
    if (inp) { inp.focus(); inp.setSelectionRange(pos, pos); }
    return;
  }
  if (e.target.classList.contains("time-hour") || e.target.classList.contains("time-minute")) {
    const wrap = e.target.closest(".time-hm");
    if (wrap) {
      const date = wrap.dataset.date || nowLocalInput().slice(0, 10);
      const rawH = (wrap.querySelector(".time-hour")?.value || "").replace(/\D/g, "").slice(0, 2);
      const rawM = (wrap.querySelector(".time-minute")?.value || "").replace(/\D/g, "").slice(0, 2);
      if (e.target.value !== rawH && e.target.classList.contains("time-hour")) e.target.value = rawH;
      if (e.target.value !== rawM && e.target.classList.contains("time-minute")) e.target.value = rawM;
      const hidden = wrap.querySelector(".val-inp");
      if (hidden) {
        if (rawH !== "" && rawM !== "") {
          const h = Math.min(23, Number(rawH));
          const m = Math.min(59, Number(rawM));
          hidden.value = `${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        } else {
          hidden.value = "";
        }
        hidden.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  }
  if (e.target.classList.contains("val-inp") && e.target.type === "number") {
    const raw = currentItemById(e.target.dataset.item) || {};
    const tplId = raw._templateId || currentTemplate(state.view === "quality" ? "quality" : "inspection")?.id;
    e.target.classList.toggle("out-of-range", isOutOfRange(
      effectiveItem(raw, state.data.specOverrides || [], tplId),
      e.target.value
    ));
  }
  if (state.view === "inspect" || state.view === "record") {
    if (e.target.matches(".val-inp, .note-inp, textarea, input, #inp-self-opinion")) syncRequestState();
  }
  if (state.view === "quality") {
    if (e.target.matches(".val-inp, .note-inp, textarea, input")) updateQualitySaveEnabled();
  }
});
document.addEventListener("click", (e) => {
  onClick(e).catch((err) => {
    console.error(err);
    toast("작업에 실패했습니다.");
  });
});
document.addEventListener("submit", (e) => {
  const p = onSubmit(e);
  if (p && p.catch) p.catch((err) => { console.error(err); toast("저장에 실패했습니다."); });
});
window.addEventListener("hashchange", () => {
  const prev = state.view;
  const raw = (location.hash || "#/home").replace(/^#\/?/, "");
  const next = raw.split("/")[0];
  if ((prev === "inspect" || prev === "quality") && next === prev) inspectDraftFromDom();
  state.pdfDoc = null;
  parseHash();
  render();
});

function currentItemById(id) {
  const tpls = state.data.checklistTemplates;
  for (const t of tpls) {
    const it = (t.items || []).find((x) => x.id === id);
    if (it) return { ...it, _templateId: t.id };
  }
  return null;
}

$("#input-photo").addEventListener("change", (e) => {
  handleFiles(e.target.files, "camera").finally(() => { e.target.value = ""; });
});
$("#input-video").addEventListener("change", (e) => {
  handleFiles(e.target.files, "camera").finally(() => { e.target.value = ""; });
});
$("#input-album").addEventListener("change", (e) => {
  handleFiles(e.target.files, "album").finally(() => { e.target.value = ""; });
});
$("#input-pdf").addEventListener("change", (e) => {
  handlePdf(e.target.files).finally(() => { e.target.value = ""; });
});
$("#input-backup").addEventListener("change", (e) => {
  doImport(e.target.files[0]).finally(() => { e.target.value = ""; });
});
$("#input-inspect-photo").addEventListener("change", (e) => {
  handleInspectPhotos(e.target.files).finally(() => { e.target.value = ""; });
});
$("#input-item-camera")?.addEventListener("change", (e) => {
  handleInspectPhotos(e.target.files).finally(() => { e.target.value = ""; });
});
$("#input-templates").addEventListener("change", (e) => {
  importTemplatesFile(e.target.files[0]).finally(() => { e.target.value = ""; });
});

init().catch((e) => {
  console.error(e);
  toast("앱을 시작하지 못했습니다.");
});

window.__siteapp = {
  db,
  reload,
  getState: () => state,
  exportBackupZip,
  importBackupZip,
  exportInspectionPdf,
  exportInspectionXlsx,
  addWatermark,
  toast,
  missingPhotoItems: () => {
    inspectDraftFromDom();
    return missingPhotoItems(currentTemplate("inspection"), state.pendingByItem, state.inspectDraft?.results || {});
  },
  qualityMissingPhotos: () => missingPhotoItems(currentTemplate("quality"), state.pendingByItem, state.inspectDraft?.results || {}),
  requestGaps: () => {
    inspectDraftFromDom();
    return requestGaps(currentTemplate("inspection"));
  },
  syncRequestState,
  formatLocation: (ctx, opts) => formatLocation(state.data.locations, ctx, opts),
  formatRecordLocation: (rec, opts) => formatRecordLocation(state.data.locations, rec, opts),
  addCommonArea,
  addPendingPhoto: (itemId, rec) => {
    inspectDraftFromDom();
    if (!state.pendingByItem[itemId]) state.pendingByItem[itemId] = [];
    state.pendingByItem[itemId].push(rec);
    syncRequestState();
  },
  rerender: () => render(),
  rememberVehicle,
  recentVehicles,
  rememberLocation,
  recentLocations,
  openLocPicker,
};
