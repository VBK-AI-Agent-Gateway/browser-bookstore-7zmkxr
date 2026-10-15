/* ============================================================
 * 云书阁 · Service Worker —— 仅静态缓存 / 离线
 * 架构：WASM 数据库(PGlite/降级 sql.js) 跑在【独立 Web Worker】(src/db/worker.ts)，
 *       主线程 client 通过 postMessage 调它；本 SW 不碰数据库、不做任何 import()，
 *       从而规避 "ServiceWorkerGlobalScope 禁止动态 import()" 规范限制。
 * 策略：HTML/sw.js/version.json 走 network-first（必拿最新）；其它静态 cache-first（离线可用）。
 * ============================================================ */
const CACHE = "yunshuge-static-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "./index.html"]).catch(() => undefined)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // 只处理同源静态资源；/api/ 已不经网络（走 DB Worker postMessage），跳过
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api/")) return;

  const accept = event.request.headers.get("accept") || "";
  const isNav = event.request.mode === "navigate" || accept.includes("text/html");
  const isFresh = isNav || url.pathname.endsWith("sw.js") || url.pathname.endsWith("version.json");

  if (isFresh) {
    // network-first：HTML/sw.js/version.json 必须拿最新，失败才回落缓存
    event.respondWith(
      fetch(event.request)
        .then((r) => { if (r && r.status === 200 && r.type === "basic") { caches.open(CACHE).then((c) => c.put(event.request, r.clone())); } return r; })
        .catch(() => caches.open(CACHE).then((c) => c.match(event.request, { ignoreSearch: true })))
    );
    return;
  }
  // 其它静态资源：cache-first + 后台更新（离线可浏览）
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request, { ignoreSearch: true });
      const fp = fetch(event.request).then((r) => { if (r && r.status === 200) cache.put(event.request, r.clone()); return r; }).catch(() => cached);
      return cached || fp;
    })
  );
});