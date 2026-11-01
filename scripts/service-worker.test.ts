import { assert, assertEquals, assertRejects } from "@std/assert";

const source = await Deno.readTextFile(new URL("../public/sw.js", import.meta.url));
const BASE = "https://example.test/binette/";
const kernelHash = new Uint8Array(await crypto.subtle.digest("SHA-384", new TextEncoder().encode("シェル:./regie.js")));
const ENTRY = `<script integrity="sha384-${btoa(String.fromCharCode(...kernelHash))}" type="module" src="./regie.js"></script>`;
const CACHE = "binette-v0.2.0-3";
type Fetcher = (request: Request) => Promise<Response>;
type TestEvent = { request?: Request; waitUntil(promise: Promise<unknown>): void; respondWith(promise: Promise<Response>): void };

function setup(base = BASE) {
  const files = new Map<string, Uint8Array>();
  const opened: string[] = [];
  let failDatabase = false;
  let mixedInstall = false;
  let transactions = 0;
  let closed = 0;
  const indexedDB = {
    open(name: string) {
      opened.push(name);
      const request = {
        result: {
          close() { closed++; },
          transaction(name: string, mode: string) {
            assertEquals([name, mode], ["files", "readonly"]);
            transactions++;
            const snapshot = structuredClone(files);
            const tx = {
              oncomplete: () => {},
              objectStore(name: string) {
                assertEquals(name, "files");
                return { get(path: string) {
                  const result = { result: snapshot.get(path), onsuccess: () => {} };
                  queueMicrotask(() => result.onsuccess());
                  return result;
                } };
              },
            };
            queueMicrotask(() => queueMicrotask(() => tx.oncomplete()));
            return tx;
          },
        },
        error: new Error("DB の読み込み失敗"),
        onsuccess: () => {}, onerror: () => {},
      };
      queueMicrotask(() => failDatabase ? request.onerror() : request.onsuccess());
      return request;
    },
  };
  const handlers = new Map<string, (event: TestEvent) => void>();
  const stored = new Map<string, Map<string, Response>>();
  let skipped = 0;
  let claimed = 0;
  let network: Fetcher = () => Promise.resolve(new Response("ネット"));
  const requests: string[] = [];
  const reloads: RequestCache[] = [];
  const key = (request: Request | URL | string) => new URL(request instanceof Request ? request.url : String(request), base).href;
  const open = (name: string) => {
    if (!stored.has(name)) stored.set(name, new Map());
    const entries = stored.get(name)!;
    return {
      match(request: Request | URL | string) { return Promise.resolve(entries.get(key(request))?.clone()); },
      put(request: Request | URL | string, response: Response) { entries.set(key(request), response.clone()); return Promise.resolve(); },
      addAll(requests: (Request | string)[]) {
        for (const request of requests) {
          // HTTP キャッシュを通さず取り直すこと
          if (request instanceof Request) reloads.push(request.cache);
          const path = `./${new URL(key(request)).pathname.slice(new URL(base).pathname.length)}`;
          entries.set(key(request), new Response(path === "./index.html" ? ENTRY : mixedInstall && path === "./regie.js" ? "別版" : `シェル:${path === "./" ? "./" : path}`));
        }
        return Promise.resolve();
      },
    };
  };
  const worker = {
    location: new URL("sw.js", base),
    skipWaiting() { skipped++; return Promise.resolve(); },
    clients: { claim() { claimed++; return Promise.resolve(); } },
    addEventListener(type: string, listener: (event: TestEvent) => void) { handlers.set(type, listener); },
  };
  const caches = {
    open(name: string) { return Promise.resolve(open(name)); },
    keys() { return Promise.resolve([...stored.keys()]); },
    delete(name: string) { return Promise.resolve(stored.delete(name)); },
  };
  // 実際に配る classic worker を、グローバルを共有せずに実行する
  new Function("self", "caches", "indexedDB", "fetch", source)(worker, caches, indexedDB, (request: Request) => {
    requests.push(request.url);
    return network(request);
  });
  function dispatch(type: string, request?: Request) {
    const pending: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    handlers.get(type)!({ request, waitUntil(promise) { pending.push(promise); }, respondWith(promise) { response = promise; } });
    return { response, done: () => Promise.all(pending) };
  }
  function request(path: string, navigate = false, method = "GET") {
    const request = new Request(new URL(path, base), { method });
    if (navigate) Object.defineProperty(request, "mode", { value: "navigate" });
    return dispatch("fetch", request);
  }
  return {
    stored, requests, open, dispatch, request, files, opened,
    set mixedInstall(value: boolean) { mixedInstall = value; },
    set failDatabase(value: boolean) { failDatabase = value; },
    get transactions() { return transactions; }, get closed() { return closed; },
    set network(fetcher: Fetcher) { network = fetcher; },
    get reloads() { return reloads; },
    get skipped() { return skipped; }, get claimed() { return claimed; },
  };
}

Deno.test("SW はサブパスのシェルを入れて待機を飛ばし、古い binette キャッシュだけを消す", async () => {
  const sw = setup();
  await sw.dispatch("install").done();
  assertEquals(sw.skipped, 1);
  assert(sw.reloads.length > 0 && sw.reloads.every(cache => cache === "reload"));
  assertEquals([...sw.stored.get(CACHE)!.keys()], ["", "index.html", "manifest.webmanifest", "icon.svg", "regie.js", "regie-worker.js"].map(path => BASE + path));
  sw.open("binette-old"); sw.open("another-app");
  await sw.dispatch("activate").done();
  assertEquals([...sw.stored.keys()], [CACHE, "another-app"]);
  assertEquals(sw.claimed, 1);
});

Deno.test("SW はオンライン更新中も入口とカーネルの同じ組を返し、個別に更新しない", async () => {
  const sw = setup();
  await sw.dispatch("install").done();
  sw.network = () => Promise.resolve(new Response("配布元の新しい版"));
  assertEquals(await (await sw.request("screen", true).response!).text(), ENTRY);
  for (const path of ["", "index.html", "regie.js", "regie-worker.js"]) {
    const event = sw.request(`${path}?v=2`);
    assertEquals(await (await event.response!).text(), path === "" || path === "index.html" ? ENTRY : `シェル:./${path}`);
    await event.done();
  }
  sw.network = () => Promise.reject(new Error("オフライン"));
  assertEquals(await (await sw.request("unknown", true).response!).text(), ENTRY);
  assertEquals(sw.requests, []);
  sw.stored.get(CACHE)!.clear();
  assertEquals((await sw.request("unknown", true).response!).status, 503);
  assertEquals((await sw.request("regie.js").response!).status, 503);
});

Deno.test("SW は install で入口の SRI と JS の不一致を拒否して待機を飛ばさない", async () => {
  const sw = setup();
  sw.mixedInstall = true;
  await assertRejects(() => sw.dispatch("install").done(), Error, "入口とカーネルの版が一致しません");
  assertEquals(sw.skipped, 0);
});

Deno.test("SW の同じオリジンの GET はキャッシュをすぐ返し、裏で新しい応答に置き換える", async () => {
  const sw = setup();
  await sw.open(CACHE).put("assets/main-hash.js", new Response("古い JS"));
  let complete: (response: Response) => void = () => {};
  sw.network = () => new Promise(resolve => { complete = resolve; });
  const event = sw.request("assets/main-hash.js");
  assertEquals(await (await event.response!).text(), "古い JS");
  complete(new Response("新しい JS"));
  await event.done();
  assertEquals(await (await sw.open(CACHE).match("assets/main-hash.js"))!.text(), "新しい JS");
  sw.network = () => Promise.reject(new Error("オフライン"));
  const offline = sw.request("assets/main-hash.js");
  assertEquals(await (await offline.response!).text(), "新しい JS");
  await offline.done();
});

Deno.test("SW は未保存の GET をネットから保存し、別オリジンと GET 以外には触らない", async () => {
  const sw = setup();
  const fresh = sw.request("assets/home-hash.binapp");
  assertEquals(await (await fresh.response!).text(), "ネット");
  await fresh.done();
  assertEquals(await (await sw.open(CACHE).match("assets/home-hash.binapp"))!.text(), "ネット");
  for (const method of ["POST", "PUT", "DELETE", "HEAD"]) assertEquals(sw.request("api", false, method).response, undefined);
  assertEquals(sw.request("https://other.test/asset.js").response, undefined);
  assertEquals(sw.requests, [BASE + "assets/home-hash.binapp"]);
});

Deno.test("SW はルート・サブパスの目録と system 配布物をキャッシュから切り離す", async () => {
  for (const base of ["https://example.test/", BASE, "https://example.test/nested/binette/"]) {
    const sw = setup(base);
    const paths = ["manifest.json", "manifest.json?version=2", "system/boot.json", "system/apps/home/app.wasm", "system/bundled/designer/icon.svg", "system/"];
    for (const path of paths) {
      await sw.open(CACHE).put(path, new Response("古い配布物"));
      for (const navigate of [false, true]) {
        const event = sw.request(path, navigate);
        // respondWith しないので、ブラウザが通常のネットワーク取得を行う。
        assertEquals(event.response, undefined);
        await event.done();
      }
      assertEquals(await (await sw.open(CACHE).match(path))!.text(), "古い配布物");
    }
    assertEquals(sw.requests, []);
    // 名前が似た通常のファイルや、別の配信ベースには従来どおり応答する。
    for (const path of ["manifest.webmanifest", "manifest.json.bak", "systematic/file", "assets/system/file", "other/manifest.json"]) {
      await sw.open(CACHE).put(path, new Response("保存済み"));
      const event = sw.request(path);
      assertEquals(await (await event.response!).text(), "保存済み");
      await event.done();
      assertEquals(await (await sw.open(CACHE).match(path))!.text(), path === "manifest.webmanifest" ? "保存済み" : "ネット");
    }
  }
});

async function systemFiles(sw: ReturnType<typeof setup>, input: Record<string, string>) {
  const files = await Promise.all(Object.entries(input).map(async ([path, text]) => {
    const data = new TextEncoder().encode(text);
    sw.files.set(`/system/${path}`, data);
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
    return { path: `system/${path}`, size: data.byteLength,
      sha256: [...hash].map(byte => byte.toString(16).padStart(2, "0")).join("") };
  }));
  sw.files.set("/system/.manifest.json", new TextEncoder().encode(JSON.stringify({ version: "test", files })));
}

Deno.test("SW はオフラインでも入口と固定名のカーネルを返す", async () => {
  const sw = setup();
  await sw.dispatch("install").done();
  sw.network = () => Promise.reject(new Error("オフライン"));
  for (const path of ["regie.js", "regie-worker.js"]) {
    const event = sw.request(path);
    assertEquals(await (await event.response!).text(), `シェル:./${path}`);
    await event.done();
  }
});

Deno.test("SW の fs は root とサブパスで user を優先し、設定と直接 system は検証して返す", async () => {
  for (const base of ["https://example.test/", BASE, "https://example.test/nested/binette/"]) {
    const sw = setup(base);
    await systemFiles(sw, { "apps/home/icon.svg": "固定", "apps/settings/app.wasm": "設定" });
    sw.files.set("/user/apps/home/icon.svg", new TextEncoder().encode("上書き"));
    sw.files.set("/user/apps/settings/app.wasm", new TextEncoder().encode("偽設定"));
    await sw.open(CACHE).put("fs/apps/home/icon.svg", new Response("古い応答"));
    for (const [path, text, type] of [
      ["apps/home/icon.svg", "上書き", "image/svg+xml"],
      ["system/apps/home/icon.svg", "固定", "image/svg+xml"],
      ["apps/settings/app.wasm", "設定", "application/wasm"],
    ]) {
      const response = await sw.request(`fs/${path}?v=1`, true).response!;
      assertEquals(response.status, 200);
      assertEquals(await response.text(), text);
      assertEquals(response.headers.get("Content-Type"), type);
      assertEquals(response.headers.get("Cache-Control"), "no-store");
      assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");
    }
    sw.files.delete("/user/apps/home/icon.svg");
    assertEquals(await (await sw.request("fs/apps/home/icon.svg").response!).text(), "固定");
    assertEquals(sw.requests, []);
    assertEquals(sw.opened, Array(4).fill("binette-apps"));
    assertEquals(sw.transactions, 4);
    assertEquals(sw.closed, 4);
  }
});

Deno.test("SW は固定物を毎回検証し、欠損・目録外・壊れた目録・DB 失敗をネットへ逃がさない", async () => {
  const sw = setup();
  await systemFiles(sw, { "tools/asc.js": "正しい JS" });
  assertEquals((await sw.request("fs/tools/asc.js").response!).status, 200);
  sw.files.set("/system/tools/asc.js", new TextEncoder().encode("壊れた JS"));
  assertEquals((await sw.request("fs/tools/asc.js").response!).status, 500);
  sw.files.delete("/system/tools/asc.js");
  assertEquals((await sw.request("fs/tools/asc.js").response!).status, 500);
  assertEquals((await sw.request("fs/tools/missing.js").response!).status, 404);
  sw.files.set("/system/tools/missing.js", new Uint8Array());
  assertEquals((await sw.request("fs/tools/missing.js").response!).status, 500);
  for (const saved of ["{", '{"version":"test","files":[null]}', '{"version":"test","files":[]}']) {
    sw.files.set("/system/.manifest.json", new TextEncoder().encode(saved));
    assertEquals((await sw.request("fs/tools/missing.js").response!).status, 500);
  }
  sw.files.delete("/system/.manifest.json");
  assertEquals((await sw.request("fs/tools/asc.js").response!).status, 500);
  sw.failDatabase = true;
  assertEquals((await sw.request("fs/tools/asc.js").response!).status, 500);
  assertEquals(sw.requests, []);
});

Deno.test("SW は曖昧な fs パスと層の迂回を拒否し、URL の復号と MIME を扱う", async () => {
  const sw = setup();
  for (const path of ["apps//a", "apps/%2fsecret", "apps/%5csecret", "apps/%252e%252e/file", "apps/%00", "apps/%7f", "apps/%zz", "apps/", ""]) {
    assertEquals((await sw.request(`fs/${path}`).response!).status, 400, path);
  }
  for (const path of ["user/apps/settings/app.wasm", "system/.manifest.json"]) {
    assertEquals((await sw.request(`fs/${path}`).response!).status, 404);
  }
  for (const [path, type] of [
    ["apps/日本語/a.js", "text/javascript; charset=utf-8"], ["apps/a/style.css", "text/css; charset=utf-8"],
    ["apps/a/app.json", "application/json; charset=utf-8"], ["apps/a/index.html", "text/html; charset=utf-8"],
    ["apps/a/file.bin", "application/octet-stream"],
  ]) {
    sw.files.set(`/user/${path}`, new Uint8Array());
    const response = await sw.request(`fs/${path}`).response!;
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("Content-Type"), type);
    assertEquals((await response.arrayBuffer()).byteLength, 0);
  }
  assertEquals(sw.requests, []);
});
