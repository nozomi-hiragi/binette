/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />
// @ts-check

/** @type {ServiceWorkerGlobalScope} */
const worker = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));
const CACHE = "binette-v0.2.0-3";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./regie.js", "./regie-worker.js"];

worker.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // HTTP キャッシュに残った前の版を混ぜないよう、配信元へ取り直す。
    await cache.addAll(SHELL.map(path => new Request(new URL(path, worker.location.href), { cache: "reload" })));
    // 配置の途中に入口と JS の版が混ざっていたら、新しい SW を有効にしない。
    const html = await cache.match(new URL("./index.html", worker.location.href));
    const kernel = await cache.match(new URL("./regie.js", worker.location.href));
    const script = (await html?.clone().text())?.match(/<script\b[^>]*\bsrc="\.\/regie\.js"[^>]*>/)?.[0];
    const integrity = script?.match(/\bintegrity="(sha384-[A-Za-z0-9+/]+={0,2})"/)?.[1];
    if (!integrity || !kernel || !html) throw new Error("入口の SRI またはカーネルがありません。");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-384", await kernel.arrayBuffer()));
    if (`sha384-${btoa(String.fromCharCode(...digest))}` !== integrity) {
      throw new Error("入口とカーネルの版が一致しません。");
    }
    // / と index.html も、同じ応答へ揃える。
    await cache.put(new URL("./", worker.location.href), html);
    await worker.skipWaiting();
  })());
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

/** 入口とカーネルは install 時の組を保持し、個別にネット更新しない。
 * @param {Cache} cache @param {URL} url
 */
async function fixedResponse(cache, url) {
  return await cache.match(url) ?? new Response("保存されたカーネルがありません。再読み込みしてください。", {
    status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** @param {string} path */
function canonical(path) {
  return path.startsWith("/") && !/[\\%?#\s]/.test(path) &&
    ![...path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
    path.slice(1).split("/").every(part => part && part !== "." && part !== "..");
}

/** 目録と本体を同じ readonly トランザクションで読み、更新中の版を混ぜない。
 * @param {string[]} paths
 * @returns {Promise<(Uint8Array | undefined)[]>}
 */
async function readFiles(paths) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("binette-apps");
    // SW は DB の新規作成や移行を受け持たない。
    request.onupgradeneeded = () => request.transaction?.abort();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("files", "readonly");
      const store = transaction.objectStore("files");
      /** @type {(Uint8Array | undefined)[]} */
      const values = new Array(paths.length);
      paths.forEach((path, index) => {
        const request = store.get(path);
        request.onsuccess = () => { values[index] = request.result; };
      });
      transaction.oncomplete = () => resolve(values);
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

/** @param {string} path */
function mime(path) {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  /** @type {Record<string, string>} */
  const types = {
    wasm: "application/wasm", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
    json: "application/json; charset=utf-8", html: "text/html; charset=utf-8", css: "text/css; charset=utf-8",
    svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", ico: "image/x-icon", txt: "text/plain; charset=utf-8", ts: "text/plain; charset=utf-8",
    woff: "font/woff", woff2: "font/woff2",
  };
  return types[extension] ?? "application/octet-stream";
}

/** 保存済み目録の形式も検査する。署名のない目録自体の信頼は配布側と同じ制限を持つ。
 * @param {Uint8Array | undefined} saved @param {string} path
 */
function manifestFile(saved, path) {
  if (!saved) throw new Error("保存された目録がありません。");
  const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(saved));
  if (!manifest || typeof manifest.version !== "string" || !manifest.version.trim() || !Array.isArray(manifest.files)) {
    throw new Error("目録が不正です。");
  }
  const seen = new Set();
  for (const file of manifest.files) {
    if (!file || typeof file.path !== "string" || !file.path.startsWith("system/") ||
      !canonical(`/${file.path}`) || file.path === "system/.manifest.json" || seen.has(file.path) ||
      typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.size) || file.size < 0) throw new Error("目録が不正です。");
    seen.add(file.path);
  }
  return manifest.files.find(/** @param {{path: string}} file */ file => `/${file.path}` === path);
}

/** @param {string} encoded */
async function fileResponse(encoded) {
  /** @param {number} status @param {string} message */
  const failure = (status, message) => new Response(message, {
    status, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
  let path;
  try {
    // 区切りを復号して別のファイルを指す URL は受け付けない。
    if (/%2f|%5c/i.test(encoded)) return failure(400, "パスが不正です。");
    path = decodeURIComponent(encoded);
    if (!canonical(path)) return failure(400, "パスが不正です。");
  } catch { return failure(400, "パスが不正です。"); }
  if (path === "/user" || path.startsWith("/user/") || path === "/system/.manifest.json") {
    return failure(404, "ファイルがありません。");
  }
  try {
    const direct = path.startsWith("/system/");
    const fixed = direct ? path : `/system${path}`;
    const settings = path === "/apps/settings" || path.startsWith("/apps/settings/");
    const [saved, system, user] = await readFiles([
      "/system/.manifest.json", fixed, ...(direct || settings ? [] : [`/user${path}`]),
    ]);
    let data = user;
    if (data === undefined) {
      const file = manifestFile(saved, fixed);
      if (!file && system === undefined) return failure(404, "ファイルがありません。");
      if (!file || !(system instanceof Uint8Array) || system.byteLength !== file.size) {
        throw new Error("固定物の大きさが一致しません。");
      }
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", system.slice()));
      if ([...hash].map(byte => byte.toString(16).padStart(2, "0")).join("") !== file.sha256) {
        throw new Error("固定物の SHA-256 が一致しません。");
      }
      data = system;
    }
    if (!(data instanceof Uint8Array)) throw new Error("ファイルの形式が不正です。");
    return new Response(data.slice(), { headers: {
      "Content-Type": mime(path), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch { return failure(500, "ファイルの読み込みまたは検証に失敗しました。"); }
}

worker.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== worker.location.origin) return;
  // 目録と固定物は取得側で版とハッシュを確かめるため、SW のキャッシュを通さない。
  const base = new URL("./", worker.location.href);
  if (url.pathname === `${base.pathname}manifest.json` || url.pathname.startsWith(`${base.pathname}system/`)) return;
  if (url.pathname.startsWith(`${base.pathname}fs/`)) {
    event.respondWith(fileResponse(url.pathname.slice(`${base.pathname}fs`.length)));
    return;
  }
  const cache = caches.open(CACHE);
  if (request.mode === "navigate") {
    event.respondWith(cache.then(cache => fixedResponse(cache, new URL("./index.html", worker.location.href))));
    return;
  }
  if (SHELL.some(path => new URL(path, worker.location.href).pathname === url.pathname)) {
    event.respondWith(cache.then(cache => fixedResponse(cache, new URL(url.pathname, url.origin))));
    return;
  }
  // waitUntil はイベントを受け取った時点で登録し、キャッシュを返したあとも更新を続ける
  const update = cache.then(cache => refresh(request, cache));
  event.waitUntil(update.then(() => {}, () => {}));
  event.respondWith(cache.then(async cache => await cache.match(request) ?? await update));
});
