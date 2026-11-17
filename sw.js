/* 현장관리 서비스 워커 — 앱 셸 캐시, 오프라인 동작 */
const CACHE = "site-app-v11";
const PRECACHE = ["./", "./index.html", "./manifest.webmanifest", "./css/app.css", "./js/app.js", "./js/db.js", "./js/ctx.js", "./js/media.js", "./js/speech.js", "./js/backup.js", "./js/inspect.js", "./js/drawings.js", "./data/checklistTemplates.json", "./js/templates.js", "./js/items.js", "./js/settings.js", "./icons/icon-192.png", "./icons/icon-512.png", "./vendor/jszip/jszip.min.js", "./vendor/jspdf/jspdf.umd.min.js", "./vendor/xlsx/xlsx.mjs", "./vendor/pdfjs/pdf.min.mjs", "./vendor/pdfjs/pdf.worker.min.mjs", "./vendor/fonts/NotoSansKR-Regular.ttf"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const copy = res.clone();
          const cache = await caches.open(CACHE);
          cache.put(req, copy);
        }
        return res;
      } catch (err) {
        if (cached) return cached;
        if (req.mode === "navigate") {
          const fallback = await caches.match("./index.html");
          if (fallback) return fallback;
        }
        throw err;
      }
    })()
  );
});
