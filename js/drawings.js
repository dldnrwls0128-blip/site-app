/** PDF.js 도면 뷰어 (확대·페이지 이동) */
let _pdfjs;

export async function loadPdfjs() {
  if (_pdfjs) return _pdfjs;
  const mod = await import("../vendor/pdfjs/pdf.min.mjs");
  mod.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
  _pdfjs = mod;
  return mod;
}

export async function openPdfBlob(blob) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await blob.arrayBuffer());
  const task = pdfjs.getDocument({
    data,
    cMapUrl: new URL("../vendor/pdfjs/cmaps/", import.meta.url).href,
    cMapPacked: true,
    wasmUrl: new URL("../vendor/pdfjs/wasm/", import.meta.url).href,
  });
  return task.promise;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {*} pdf pdfjs document
 */
export async function renderPage(canvas, pdf, pageNum, scale) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const outputScale = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const ctx = canvas.getContext("2d");
  const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
  await page.render({ canvasContext: ctx, viewport, transform }).promise;
  return { width: viewport.width, height: viewport.height, pages: pdf.numPages };
}
