/** 체크리스트 항목 타입(check|number|text|time) 해석 */

export function resolveItem(item) {
  const text = item?.text || item?.name || "";
  const kind = item?.kind || item?.type || "check";
  const inputmode = item?.inputmode || item?.inputMode || "";
  return {
    ...item,
    text,
    kind,
    inputmode,
    nowButton: !!(item?.nowButton || item?.now_button),
    unit: item?.unit || "",
    min: item?.min,
    max: item?.max,
  };
}

/** 차량번호 입력칸(최근 입력 칩용). 타입/키패드는 바꾸지 않는다. */
export function isVehicleItem(item) {
  const it = item || {};
  const text = it.text || it.name || "";
  const id = it.id || "";
  return id === "concrete-qa-03" || /운반차\s*번호|차량번호|차량\s*번호/.test(text);
}

/** 타설 관리대장용 짧은 열 이름 */
export function qualityColumnLabel(item) {
  const it = resolveItem(item);
  const id = it.id || "";
  const text = it.text || "";
  let label = "";
  if (id === "concrete-qa-03" || /운반차\s*번호|차량번호|차량\s*번호/.test(text)) label = "차량번호";
  else if (id === "concrete-qa-04b" || /도착시각|도착\s*시각/.test(text)) label = "도착시각";
  else if (id === "concrete-qa-04c" || /타설완료시각|타설완료\s*시각/.test(text)) label = "타설완료시각";
  else if (id === "concrete-qa-04" || /생산시각|생산\s*시각/.test(text)) label = "생산시각";
  else if (id === "concrete-qa-07" || /슬럼프/.test(text)) label = "슬럼프";
  else if (id === "concrete-qa-08" || /공기량/.test(text)) label = "공기량";
  else if (id === "concrete-qa-09" || /염화물/.test(text)) label = "염화물";
  else if (id === "concrete-qa-10" || /공시체/.test(text)) label = "공시체";
  else label = shortItemLabel(it, 18).replace(/…$/, "");
  if (it.kind === "number" && it.unit) label = `${label}(${it.unit})`;
  return label;
}

export function isOutOfRange(item, value) {
  if (value === "" || value == null) return false;
  const n = Number(value);
  if (Number.isNaN(n)) return false;
  if (item.min != null && item.min !== "" && n < Number(item.min)) return true;
  if (item.max != null && item.max !== "" && n > Number(item.max)) return true;
  return false;
}

export function rangeHint(item) {
  const unit = item.unit ? ` ${item.unit}` : "";
  if (item.min != null && item.max != null && item.min !== "" && item.max !== "") {
    return `${item.min} ~ ${item.max}${unit}`;
  }
  if (item.min != null && item.min !== "") return `${item.min}${unit} 이상`;
  if (item.max != null && item.max !== "") return `${item.max}${unit} 이하`;
  return "";
}

export function isNaValue(v) {
  return v === "해당없음";
}

export function isNaResult(result) {
  return isNaValue(result?.self?.value);
}

export function selfFilled(item, result) {
  const it = resolveItem(item);
  const v = result?.self?.value;
  if (isNaValue(v)) return true;
  if (it.kind === "check") return v === "합격" || v === "불합격";
  return v !== undefined && v !== null && String(v).trim() !== "";
}

export function allSelfFilled(template, resultsById) {
  return (template?.items || []).every((it) => selfFilled(it, resultsById[it.id]));
}

export const PARTS = ["슬래브", "벽체", "구간", "코어"];

export function itemRequiresPhoto(item) {
  return !!(item?.requirePhoto || item?.photoRequired);
}

function hasBound(v) {
  return v != null && v !== "";
}

/** 템플릿 원본의 min/max가 비어 시방값을 채울 대상인지 */
export function needsSpecOverride(item) {
  const it = resolveItem(item);
  if (it.kind !== "number") return false;
  return !hasBound(it.min) || !hasBound(it.max);
}

export function applyOverride(item, override) {
  const base = resolveItem(item);
  if (!override) return base;
  return {
    ...base,
    min: hasBound(override.min) ? override.min : base.min,
    max: hasBound(override.max) ? override.max : base.max,
    _overridden: !!(hasBound(override.min) || hasBound(override.max)),
  };
}

export function overrideOf(overrides, item, templateId) {
  if (!overrides) return null;
  if (Array.isArray(overrides)) {
    return (
      overrides.find((o) => o.itemId === item.id && (!templateId || o.templateId === templateId)) ||
      overrides.find((o) => o.itemId === item.id) ||
      null
    );
  }
  return overrides[`${templateId}::${item.id}`] || overrides[item.id] || null;
}

export function effectiveItem(item, overrides, templateId) {
  return applyOverride(item, overrideOf(overrides, item, templateId));
}

/** 사진 필수인데 아직 사진이 없는 항목 */
export function missingPhotoItems(template, photosByItem = {}, resultsById = {}) {
  return (template?.items || []).filter((it) => {
    if (!itemRequiresPhoto(it)) return false;
    if (isNaResult(resultsById[it.id])) return false;
    const list = photosByItem[it.id];
    const n = Array.isArray(list) ? list.length : list ? 1 : 0;
    return n < 1;
  });
}

export function shortItemLabel(item, max = 22) {
  const s = (item?.text || "").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
