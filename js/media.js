/** 사진·영상 썸네일, 워터마크, 다운로드 헬퍼 */

export function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function extOf(mime, fallback = "") {
  const map = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "application/pdf": ".pdf",
    "application/zip": ".zip",
  };
  return map[mime] || fallback;
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

/**
 * 사진에 위치·공종·일시 워터마크를 canvas로 넣는다.
 * @param {Blob} blob
 * @param {{ locationLabel: string, tradeName: string, datetime: string, author?: string }} info
 * @returns {Promise<Blob>} image/jpeg
 */
export async function addWatermark(blob, info) {
  const img = await loadImage(blob);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  if (!canvas.width || !canvas.height) {
    throw new Error("이미지를 읽을 수 없습니다.");
  }
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const pad = Math.max(16, Math.round(canvas.width * 0.022));
  const fontSize = Math.max(22, Math.round(canvas.width * 0.032));
  const lines = [info.locationLabel, info.tradeName, info.datetime, info.author]
    .map((s) => (s || "").trim())
    .filter(Boolean);
  const lineGap = Math.round(fontSize * 0.35);
  const barH = pad * 2 + lines.length * fontSize + (lines.length - 1) * lineGap;
  ctx.fillStyle = "rgba(10, 16, 28, 0.58)";
  ctx.fillRect(0, canvas.height - barH, canvas.width, barH);
  ctx.fillStyle = "#ffffff";
  ctx.font = `600 ${fontSize}px "Noto Sans KR", "Apple SD Gothic Neo", sans-serif`;
  ctx.textBaseline = "top";
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 4;
  lines.forEach((line, i) => {
    ctx.fillText(line, pad, canvas.height - barH + pad + i * (fontSize + lineGap), canvas.width - pad * 2);
  });
  ctx.shadowBlur = 0;
  const out = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!out) throw new Error("워터마크 이미지를 만들 수 없습니다.");
  return out;
}

export async function imageThumb(blob, maxW = 240) {
  const img = await loadImage(blob);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = Math.min(1, maxW / w);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.8));
}

export function videoThumb(blob, maxW = 240) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    const done = (thumb) => {
      URL.revokeObjectURL(url);
      resolve(thumb);
    };
    const grab = () => {
      try {
        const w = video.videoWidth || maxW;
        const h = video.videoHeight || Math.round(maxW * 0.75);
        if (!w || !h) return done(null);
        const scale = Math.min(1, maxW / w);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => done(b), "image/jpeg", 0.8);
      } catch {
        done(null);
      }
    };
    video.onloadeddata = () => {
      if (video.readyState >= 2) {
        try {
          video.currentTime = Math.min(0.15, (video.duration || 1) * 0.01);
        } catch {
          grab();
        }
      }
    };
    video.onseeked = grab;
    video.onerror = () => done(null);
    setTimeout(() => done(null), 4000);
    video.src = url;
  });
}

export async function makeThumb(blob, mime) {
  try {
    if ((mime || blob.type || "").startsWith("video/")) return await videoThumb(blob);
    if ((mime || blob.type || "").startsWith("image/")) return await imageThumb(blob);
  } catch {
    return null;
  }
  return null;
}
