/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />
// @ts-check

/** @type {ServiceWorkerGlobalScope} */
const worker = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));
const CACHE = "binette-v0.2.0-1";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];

worker.addEventListener("install", event => {
  event.waitUntil(Promise.all([
    worker.skipWaiting(),
    caches.open(CACHE).then(cache => cache.addAll(SHELL)),
  ]));
});

worker.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith("binette-") && name !== CACHE).map(name => caches.delete(name)));
    await worker.clients.claim();
  })());
});

/** @param {Request} request @param {Cache} cache */
async function refresh(request, cache) {
  const response = await fetch(request);
  // キャッシュへの保存が失敗しても、オンラインの応答はそのまま返す
  if (response.ok) await cache.put(request, response.clone()).catch(() => {});
  return response;
}

/** @param {Request} request @param {Cache} cache */
async function navigate(request, cache) {
  let response;
  try {
    response = await refresh(request, cache);
    if (response.ok) return response;
  } catch { /* オフラインではキャッシュを使う */ }
  const saved = await cache.match(request) ?? await cache.match(new URL("./", worker.location.href)) ??
    await cache.match(new URL("./index.html", worker.location.href));
  if (saved) return saved;
  if (response) return response;
  throw new Error("オフラインのページがありません。");
}

worker.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== worker.location.origin) return;
  const cache = caches.open(CACHE);
  if (request.mode === "navigate") {
    event.respondWith(cache.then(cache => navigate(request, cache)));
    return;
  }
  // waitUntil はイベントを受け取った時点で登録し、キャッシュを返したあとも更新を続ける
  const update = cache.then(cache => refresh(request, cache));
  event.waitUntil(update.then(() => {}, () => {}));
  event.respondWith(cache.then(async cache => await cache.match(request) ?? await update));
});
