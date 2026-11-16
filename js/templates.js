/** 체크리스트 템플릿 로드·정규화·가져오기 */
import { uid, getAll, add, put, clearStore } from "./db.js";
import { loadSettings, saveSettings } from "./settings.js";

const TRADE_ALIAS = { rebar: "철근", formwork: "거푸집", concrete: "콘크리트", waterproofing: "방수", masonry: "조적", finish: "마감" };

export function normalizeIncoming(raw, trades) {
  const list = Array.isArray(raw)
    ? raw
    : raw.templates || raw.data || raw.checklistTemplates || raw.items || [];
  if (!Array.isArray(list)) throw new Error("템플릿 JSON 형식을 알 수 없습니다.");
  return list.map((t, i) => {
    const tradeName = t.trade || t.tradeName || t.공종 || TRADE_ALIAS[t.tradeId] || "";
    const tradeId =
      trades.find((x) => x.id === t.tradeId)?.id ||
      trades.find((x) => x.name === tradeName)?.id ||
      trades.find((x) => x.name === TRADE_ALIAS[t.tradeId])?.id ||
      trades[0]?.id ||
      null;
    const items = (t.items || t.checklist || []).map((it) => ({
      id: it.id || uid(),
      text: it.text || it.name || it.항목 || it.검사항목 || "",
      basis: it.basis || it.criteria || it.standard || it.판정기준 || it.근거 || "",
      kind: it.kind || it.type || "check",
      unit: it.unit || it.단위 || "",
      min: it.min ?? it.minValue,
      max: it.max ?? it.maxValue,
      inputmode: it.inputmode || it.inputMode || "",
      nowButton: !!(it.nowButton || it.now_button),
      requirePhoto: !!(it.requirePhoto || it.photoRequired || it.사진필수),
    }));
    return {
      id: t.id || t.key || uid(),
      key: t.key || t.id || "",
      tradeId,
      name: t.name || t.title || t.이름 || `템플릿 ${i + 1}`,
      category: t.category || (isQualityName(t.name || "") ? "quality" : "inspection"),
      // 사진 필수는 항목 단위(items[].requirePhoto / photoRequired)만 사용한다.
      items,
    };
  });
}

function isQualityName(name) {
  return /품질시험|타설 중/.test(name);
}

export async function loadBuiltinTemplates() {
  const res = await fetch("./data/checklistTemplates.json");
  if (!res.ok) throw new Error("기본 템플릿을 불러오지 못했습니다.");
  return res.json();
}

export async function replaceTemplates(raw, trades) {
  const list = normalizeIncoming(raw, trades);
  if (!list.length) throw new Error("가져올 템플릿이 없습니다.");
  await clearStore("checklistTemplates");
  for (const t of list) await add("checklistTemplates", t);
  return list;
}

/** 기본 템플릿 팩 버전이 올라가면 기존 DB의 기본 템플릿을 갱신한다(가져오기한 템플릿은 유지). */
export async function ensureBuiltinTemplates(trades) {
  const raw = await loadBuiltinTemplates();
  const pack = Number(raw.version || 0);
  const settings = loadSettings();
  const existing = await getAll("checklistTemplates");
  if (settings.templateSource === "imported" && existing.length) return existing;
  if (existing.length && Number(settings.templatePackVersion || 0) >= pack) return existing;
  const list = normalizeIncoming(raw, trades);
  const byKey = new Map();
  for (const prev of existing) {
    if (prev.key) byKey.set(prev.key, prev);
    if (prev.id) byKey.set(prev.id, prev);
    if (prev.name) byKey.set(prev.name, prev);
  }
  const out = list.map((tpl) => {
    const prev = byKey.get(tpl.key) || byKey.get(tpl.id) || byKey.get(tpl.name);
    const row = { ...tpl, id: prev?.id || tpl.id };
    if (prev?.tradeId && (trades || []).some((tr) => tr.id === prev.tradeId)) row.tradeId = prev.tradeId;
    return row;
  });
  await clearStore("checklistTemplates");
  for (const tpl of out) await put("checklistTemplates", tpl);
  saveSettings({ templatePackVersion: pack, templateSource: "builtin" });
  return out;
}

export async function seedTemplates(trades) {
  return ensureBuiltinTemplates(trades);
}

export function templatesOf(list, category) {
  return (list || []).filter((t) => (t.category || "inspection") === category);
}
