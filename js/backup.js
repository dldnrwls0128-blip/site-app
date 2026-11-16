/** 전체 DB를 zip(JSON + 미디어·도면 파일)으로 내보내기/가져오기 */
import { STORES, getAll, replaceAll } from "./db.js";
import { extOf } from "./media.js";

function getJSZip() {
  const J = globalThis.JSZip;
  if (!J) throw new Error("JSZip을 불러오지 못했습니다.");
  return J;
}

function clonePlain(row) {
  const out = { ...row };
  return out;
}

/**
 * @returns {Promise<Blob>} zip blob
 */
export async function exportBackupZip() {
  const JSZip = getJSZip();
  const zip = new JSZip();
  const data = {};
  for (const name of STORES) {
    data[name] = (await getAll(name)).map(clonePlain);
  }

  for (const m of data.media || []) {
    if (m.blob) {
      const ext = extOf(m.mime, m.mime?.startsWith("video/") ? ".bin" : ".jpg");
      const file = `media/${m.id}${ext}`;
      zip.file(file, m.blob);
      m.file = file;
      delete m.blob;
    }
    if (m.thumb) {
      const tfile = `thumbs/${m.id}.jpg`;
      zip.file(tfile, m.thumb);
      m.thumbFile = tfile;
      delete m.thumb;
    }
  }
  for (const d of data.drawings || []) {
    if (d.pdfBlob) {
      const file = `drawings/${d.id}.pdf`;
      zip.file(file, d.pdfBlob);
      d.file = file;
      delete d.pdfBlob;
    }
  }

  const manifest = {
    version: 1,
    app: "현장관리",
    exportedAt: new Date().toISOString(),
    stores: STORES,
    data,
  };
  zip.file("backup.json", JSON.stringify(manifest));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

/**
 * @param {Blob|File} file
 */
export async function importBackupZip(file) {
  const JSZip = getJSZip();
  const zip = await JSZip.loadAsync(file);
  const entry = zip.file("backup.json");
  if (!entry) throw new Error("backup.json이 없는 파일입니다.");
  const manifest = JSON.parse(await entry.async("string"));
  const data = manifest.data || manifest;
  if (!data.sites || !data.locations) {
    throw new Error("백업 형식을 알 수 없습니다.");
  }

  for (const m of data.media || []) {
    if (m.file && zip.file(m.file)) {
      m.blob = await zip.file(m.file).async("blob");
      if (m.mime && m.blob.type !== m.mime) {
        m.blob = new Blob([m.blob], { type: m.mime });
      }
    }
    if (m.thumbFile && zip.file(m.thumbFile)) {
      m.thumb = await zip.file(m.thumbFile).async("blob");
      m.thumb = new Blob([m.thumb], { type: "image/jpeg" });
    }
    delete m.file;
    delete m.thumbFile;
  }
  for (const d of data.drawings || []) {
    if (d.file && zip.file(d.file)) {
      const raw = await zip.file(d.file).async("blob");
      d.pdfBlob = new Blob([raw], { type: "application/pdf" });
    }
    delete d.file;
  }

  const payload = {};
  for (const name of STORES) payload[name] = data[name] || [];
  await replaceAll(payload);
  return manifest;
}
