/** 검측요청서 PDF(별지 제6호 요지) / 엑셀, 한글 폰트 임베드 */
import * as XLSX from "../vendor/xlsx/xlsx.mjs";
import { formatWhen, formatDay, officialLocation, formatRecordLocation, tradeName, labelPath, STATUS_LABEL } from "./ctx.js";
import { loadSettings, formatLocalInput } from "./settings.js";
import { resolveItem, rangeHint, qualityColumnLabel, isNaValue } from "./items.js";

let _fontB64;

async function koreanFontBase64() {
  if (_fontB64) return _fontB64;
  const res = await fetch("./vendor/fonts/NotoSansKR-Regular.ttf");
  if (!res.ok) throw new Error("한글 폰트를 불러오지 못했습니다.");
  const bytes = new Uint8Array(await res.arrayBuffer());
  const chunk = 8192;
  const parts = [];
  for (let i = 0; i < bytes.length; i += chunk) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + chunk)));
  }
  _fontB64 = btoa(parts.join(""));
  return _fontB64;
}

function getJsPDF() {
  const J = globalThis.jspdf?.jsPDF || globalThis.jsPDF;
  if (!J) throw new Error("jsPDF를 불러오지 못했습니다.");
  return J;
}

export async function attachKoreanFont(doc) {
  const b64 = await koreanFontBase64();
  doc.addFileToVFS("NotoSansKR-Regular.ttf", b64);
  doc.addFont("NotoSansKR-Regular.ttf", "NotoSansKR", "normal");
  doc.setFont("NotoSansKR", "normal");
}

function wrapLines(doc, text, maxW) {
  const s = String(text ?? "");
  const lines = [];
  for (const para of s.split(/\n/)) {
    if (!para) {
      lines.push("");
      continue;
    }
    let cur = "";
    for (const ch of para) {
      const trial = cur + ch;
      if (doc.getTextWidth(trial) > maxW && cur) {
        lines.push(cur);
        cur = ch;
      } else cur = trial;
    }
    if (cur) lines.push(cur);
  }
  return lines.length ? lines : [""];
}

function resultText(item, side) {
  const it = resolveItem(item);
  const v = side?.value;
  if (v == null || v === "") return "-";
  if (isNaValue(v)) return "해당없음";
  if (it.kind === "number") return `${v}${it.unit ? " " + it.unit : ""}`;
  if (it.kind === "time") return formatLocalInput(v) || String(v);
  return String(v);
}

/** 해당없음이면 결과 칸에 '해당없음'만 넣고 합격 칸은 비운다. */
function pdfResultLine(item, side, label) {
  const v = side?.value;
  if (isNaValue(v)) return "해당없음";
  return `${label}: ${resultText(item, side)}`;
}

/**
 * 주택건설공사 감리업무 세부기준 별지 제6호 요지의 검측요청·결과 통보서
 */
export async function exportInspectionPdf({ record, template, locations, trades, siteName, media = [] }) {
  const extra = record.extra || {};
  const settings = loadSettings();
  const jsPDF = getJsPDF();
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  await attachKoreanFont(doc);

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const m = 14;
  let y = 16;

  const ensure = (need) => {
    if (y + need > pageH - 14) {
      doc.addPage();
      doc.setFont("NotoSansKR", "normal");
      doc.setTextColor(0, 0, 0);
      y = 16;
    }
  };

  const isRe = !!(extra.parentInspectionId || extra.parentDocNo);
  const locText = formatRecordLocation(locations, record);
  const tName = [tradeName(trades, record.tradeId), extra.subTrade].filter(Boolean).join(" / ");

  doc.setFont("NotoSansKR", "normal");
  doc.setFontSize(16);
  doc.text("검측요청·결과 통보내용", pageW / 2, y, { align: "center" });
  doc.setFontSize(9);
  doc.text("〔주택건설공사 감리업무 세부기준 별지 제6호 요지〕", pageW / 2, y + 6, { align: "center" });
  if (isRe) {
    doc.setTextColor(193, 18, 31);
    doc.setFontSize(16);
    doc.text("(재)", pageW - m, 14, { align: "right" });
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.text(`원본 문서번호: ${extra.parentDocNo || "-"}`, pageW - m, 22, { align: "right" });
  }
  y = 28;

  doc.setFontSize(11);
  const head = [
    ["문서번호", extra.docNo || "-"],
    ["수신", `${settings.recipient || "총괄감리원"}`],
    ["공사명", extra.projectName || settings.projectName || "-"],
    ["현장명", siteName || "-"],
    ["요청일", extra.requestDate ? formatDay(extra.requestDate) : formatDay(record.createdAt)],
  ];
  for (const [k, v] of head) {
    ensure(7);
    doc.text(k, m, y);
    doc.text(String(v), m + 28, y);
    y += 6.5;
  }

  y += 1;
  doc.setFontSize(10);
  const intro = "다음과 같은 세부공종에 대하여 검측요청 하오니 검사 후 승인하여 주시기 바랍니다.";
  for (const line of wrapLines(doc, intro, pageW - m * 2)) {
    ensure(6);
    doc.text(line, m, y);
    y += 6;
  }

  const boxRow = (label, value, hMin = 8) => {
    const lines = wrapLines(doc, value || "-", pageW - m * 2 - 36);
    const h = Math.max(hMin, 6 + lines.length * 5);
    ensure(h);
    doc.setDrawColor(40, 40, 40);
    doc.rect(m, y, 32, h);
    doc.rect(m + 32, y, pageW - m * 2 - 32, h);
    doc.setFontSize(10);
    doc.text(label, m + 2, y + 5.5);
    doc.text(lines, m + 34, y + 5.5);
    y += h;
  };

  boxRow("위치 및 공종", `${locText}  /  ${tName}`);
  boxRow("검측 부위", extra.part || extra.locationSentence || locText);
  boxRow("검측 요구 일시", formatLocalInput(extra.requestDateTime) || formatWhen(record.createdAt));
  boxRow("검측 사항", extra.matters || record.title || template?.name || "-", 12);

  y += 4;
  ensure(16);
  doc.setFontSize(11);
  doc.text("붙임", m, y);
  y += 6;
  doc.setFontSize(10);
  const atts = extra.attachments || {};
  const attLines = [
    `1. 체크리스트(점검표)  ${atts.checklist === false ? "미첨부" : "첨부"}`,
    `2. 시험성과  ${atts.testReport ? "첨부" : "해당 시 첨부"}`,
    `3. 도면(야장 포함)  ${atts.drawing ? "첨부" : "해당 시 첨부"}`,
    `4. 공사참여자 실명부  ${atts.roster ? "첨부" : "해당 시 첨부"}`,
  ];
  for (const line of attLines) {
    ensure(6);
    doc.text(line, m, y);
    y += 5.5;
  }

  y += 6;
  signRow(doc, pageW, m, y, [
    ["요청자 (시공 점검직원)", settings.signs.staff],
    ["현장대리인", settings.signs.agent],
  ]);
  y += 28;

  ensure(40);
  doc.setFillColor(26, 39, 68);
  doc.rect(m, y, pageW - m * 2, 8, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.text("검측결과 통보", m + 2, y + 5.5);
  doc.setTextColor(0, 0, 0);
  y += 10;

  const finalLabel = extra.finalResult || STATUS_LABEL[record.status] || "-";
  boxRow("최종 결과", finalLabel);
  boxRow("부적합 내용과 조치", [extra.nonconformity, extra.action].filter(Boolean).join(" / ") || extra.instruction || "-");
  boxRow("재검측일자", extra.reinspectDate ? formatDay(extra.reinspectDate) : isRe ? formatDay(record.createdAt) : "-");
  boxRow("자체점검 의견", extra.selfOpinion || "-");

  y += 6;
  signRow(doc, pageW, m, y, [
    ["검측자 (감리원)", settings.signs.inspector],
    ["총괄감리원", settings.signs.chief],
  ]);
  y += 32;

  // ----- checklist page -----
  doc.addPage();
  doc.setFont("NotoSansKR", "normal");
  y = 16;
  doc.setFontSize(14);
  doc.text("검측 체크리스트", pageW / 2, y, { align: "center" });
  y += 6;
  doc.setFontSize(9);
  doc.text(`${locText}  /  ${tName}  /  ${extra.docNo || ""}`, pageW / 2, y, { align: "center" });
  y += 6;
  doc.text("검사결과는 위줄 시공자 자체점검, 아래줄 감리 검측으로 기재한다.", m, y);
  y += 5;

  const items = template?.items || [];
  const byId = Object.fromEntries((extra.results || []).map((r) => [r.itemId, r]));
  const colW = { no: 10, item: 52, basis: 48, self: 28, note: pageW - m * 2 - 10 - 52 - 48 - 28 };

  const headerH = 8;
  ensure(headerH);
  doc.setFillColor(26, 39, 68);
  doc.rect(m, y, pageW - m * 2, headerH, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  let x = m;
  const headers = [
    ["번호", colW.no],
    ["검측항목", colW.item],
    ["판정기준(근거)", colW.basis],
    ["결과", colW.self],
    ["비고·사진번호", colW.note],
  ];
  for (const [lab, w] of headers) {
    doc.text(lab, x + 1, y + 5.5);
    x += w;
  }
  doc.setTextColor(0, 0, 0);
  y += headerH;

  items.forEach((item, i) => {
    const r = byId[item.id] || {};
    const self = resultText(item, r.self);
    const sup = resultText(item, r.supervisor);
    const photoNo = (r.photoNos || r.self?.mediaIds || []).join(", ");
    doc.setFontSize(8);
    const itemLines = wrapLines(doc, `${item.text}`, colW.item - 2);
    const basisLines = wrapLines(doc, item.basis || "", colW.basis - 2);
    const noteLines = wrapLines(doc, [r.self?.note, r.supervisor?.note, photoNo ? `사진 ${photoNo}` : ""].filter(Boolean).join(" / ") || "-", colW.note - 2);
    const resLines = [pdfResultLine(item, r.self, "자체"), pdfResultLine(item, r.supervisor, "감리")];
    const h = Math.max(12, 4 + Math.max(itemLines.length, basisLines.length, resLines.length, noteLines.length) * 4.2);
    ensure(h);
    doc.setDrawColor(180, 180, 180);
    doc.rect(m, y, pageW - m * 2, h);
    let cx = m;
    const cols = [colW.no, colW.item, colW.basis, colW.self, colW.note];
    for (const w of cols) {
      doc.rect(cx, y, w, h);
      cx += w;
    }
    doc.text(String(i + 1), m + 2, y + 5);
    doc.text(itemLines, m + colW.no + 1, y + 4.5);
    doc.text(basisLines, m + colW.no + colW.item + 1, y + 4.5);
    const rx = m + colW.no + colW.item + colW.basis + 1;
    doc.text(resLines[0], rx, y + 4.5);
    doc.text(resLines[1], rx, y + 8.7);
    doc.text(noteLines, m + colW.no + colW.item + colW.basis + colW.self + 1, y + 4.5);
    y += h;
  });

  y += 8;
  ensure(16);
  doc.setFontSize(10);
  doc.text(`시공자 점검일: ${formatDay(record.createdAt)}    점검직원: ${settings.signs.staff}    (서명) __________`, m, y);
  y += 8;
  doc.text(`감리 검측일: ${extra.supervisedAt ? formatDay(extra.supervisedAt) : ""}    검측자: ${settings.signs.inspector}    (서명) __________`, m, y);

  // ----- photo sheet -----
  const recMedia = media.filter((mm) => mm.recordId === record.id || (record.mediaIds || []).includes(mm.id));
  doc.addPage();
  doc.setFont("NotoSansKR", "normal");
  y = 16;
  doc.setFontSize(14);
  doc.text("사진대지", pageW / 2, y, { align: "center" });
  y += 8;
  doc.setFontSize(10);
  if (!recMedia.length) {
    doc.text("첨부 사진 없음.", m, y);
  } else {
    for (let i = 0; i < recMedia.length; i++) {
      ensure(78);
      const mm = recMedia[i];
      const no = i + 1;
      const boxH = 72;
      doc.setDrawColor(40, 40, 40);
      doc.rect(m, y, pageW - m * 2, boxH);
      const imgW = 70;
      const imgH = boxH - 4;
      if (mm.blob && (mm.mime || "").startsWith("image/")) {
        try {
          const dataUrl = await blobToDataUrl(mm.blob);
          doc.addImage(dataUrl, "JPEG", m + 2, y + 2, imgW, imgH * 0.9);
        } catch (e) {
          doc.text("(사진을 넣지 못함)", m + 4, y + 20);
        }
      }
      const tx = m + imgW + 8;
      doc.setFontSize(10);
      doc.text(`사진번호: ${no}`, tx, y + 10);
      doc.text(`위치: ${locText}`, tx, y + 18);
      doc.text(`일시: ${formatWhen(mm.createdAt || record.createdAt)}`, tx, y + 26);
      const desc = wrapLines(doc, mm.caption || record.title || extra.part || "", pageW - tx - m);
      doc.text("설명:", tx, y + 34);
      doc.text(desc, tx, y + 40);
      y += boxH + 4;
    }
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("NotoSansKR", "normal");
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text(`현장관리 · ${extra.docNo || ""}  ${i}/${pages}`, m, pageH - 8);
    doc.setTextColor(0, 0, 0);
  }

  return doc.output("blob");
}

function signRow(doc, pageW, m, y, pair) {
  const w = (pageW - m * 2 - 4) / 2;
  pair.forEach((p, i) => {
    const x = m + i * (w + 4);
    doc.setDrawColor(40, 40, 40);
    doc.rect(x, y, w, 26);
    doc.setFontSize(9);
    doc.text(p[0], x + 2, y + 5);
    doc.text(`성명: ${p[1] || ""}`, x + 2, y + 11);
    doc.text("소속: ____________________", x + 2, y + 16.5);
    doc.text("일자: __________   서명: __________", x + 2, y + 22.5);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export function exportInspectionXlsx({ record, template, locations, trades, siteName }) {
  const extra = record.extra || {};
  const settings = loadSettings();
  const locText = formatRecordLocation(locations, record);
  const tName = [tradeName(trades, record.tradeId), extra.subTrade].filter(Boolean).join(" / ");
  const rows = [
    ["검측요청·결과 통보내용"],
    ["〔주택건설공사 감리업무 세부기준 별지 제6호 요지〕"],
    [],
    ["재검측 여부", extra.parentInspectionId || extra.parentDocNo ? "재검측" : "최초"],
    ["원본 문서번호", extra.parentDocNo || ""],
    ["문서번호", extra.docNo || ""],
    ["수신", settings.recipient || "총괄감리원"],
    ["공사명", extra.projectName || settings.projectName || ""],
    ["현장명", siteName || ""],
    ["요청일", extra.requestDate ? formatDay(extra.requestDate) : formatDay(record.createdAt)],
    ["위치 및 공종", `${locText} / ${tName}`],
    ["검측 부위", extra.part || ""],
    ["검측 요구 일시", formatLocalInput(extra.requestDateTime) || ""],
    ["검측 사항", extra.matters || ""],
    ["자체점검 의견", extra.selfOpinion || ""],
    ["최종 결과", extra.finalResult || STATUS_LABEL[record.status] || ""],
    ["부적합 내용", extra.nonconformity || ""],
    ["조치", extra.action || ""],
    ["재검측일자", extra.reinspectDate || ""],
    ["붙임(체크리스트)", extra.attachments?.checklist === false ? "미첨부" : "첨부"],
    ["붙임(시험성과)", extra.attachments?.testReport ? "첨부" : ""],
    ["붙임(도면)", extra.attachments?.drawing ? "첨부" : ""],
    ["붙임(공사참여자 실명부)", extra.attachments?.roster ? "첨부" : ""],
    ["서명(점검직원)", settings.signs.staff],
    ["서명(현장대리인)", settings.signs.agent],
    ["서명(검측자)", settings.signs.inspector],
    ["서명(총괄감리원)", settings.signs.chief],
    [],
    ["번호", "검측항목", "판정기준(근거)", "자체점검 결과", "감리검측 결과", "비고", "사진번호"],
  ];
  const items = template?.items || [];
  const byId = Object.fromEntries((extra.results || []).map((r) => [r.itemId, r]));
  items.forEach((item, i) => {
    const r = byId[item.id] || {};
    const photos = (r.photoNos || []).join(", ");
    rows.push([
      i + 1,
      item.text,
      item.basis || "",
      resultText(item, r.self),
      resultText(item, r.supervisor),
      [r.self?.note, r.supervisor?.note].filter(Boolean).join(" / "),
      photos,
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [8, 40, 36, 16, 16, 20, 12].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "검측요청서");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function qualityCellValue(item, result) {
  const it = resolveItem(item);
  const v = result?.self?.value ?? "";
  if (v === "" || v == null) return "";
  if (it.kind === "time") return formatLocalInput(v);
  return String(v);
}

/** 차량(배치) 1대 = 1행. 항목마다 열을 두어 타설 관리대장에 옮길 수 있게 한다. */
export function exportQualityXlsx({ record, template, locations, trades, siteName, records }) {
  const items = template?.items || [];
  const headers = ["위치", "작성일시", "작성자", ...items.map((it) => qualityColumnLabel(it))];
  const sameTpl = (r) => !template?.id || !r.extra?.templateId || r.extra.templateId === template.id;
  const list = (records && records.length ? records : [record])
    .filter((r) => r && r.type === "quality" && sameTpl(r))
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  const dataRows = list.map((r) => {
    const locText = formatRecordLocation(locations, r);
    const byId = Object.fromEntries((r.extra?.results || []).map((x) => [x.itemId, x]));
    return [
      locText,
      formatWhen(r.createdAt),
      r.author || "",
      ...items.map((it) => qualityCellValue(it, byId[it.id])),
    ];
  });
  const rows = [
    ["콘크리트 타설 중 품질시험"],
    ["현장명", siteName || ""],
    ["공종", tradeName(trades, record?.tradeId)],
    [],
    headers,
    ...dataRows,
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = headers.map((h) => ({ wch: Math.min(28, Math.max(10, String(h).length + 4)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "타설관리대장");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
