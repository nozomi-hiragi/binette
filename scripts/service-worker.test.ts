import { assertEquals, assertRejects } from "@std/assert";

const source = await Deno.readTextFile(new URL("../public/sw.js", import.meta.url));
const BASE = "https://example.test/binette/";
const CACHE = "binette-v0.2.0-1";
type Fetcher = (request: Request) => Promise<Response>;
type TestEvent = { request?: Request; waitUntil(promise: Promise<unknown>): void; respondWith(promise: Promise<Response>): void };

function setup() {
  const handlers = new Map<string, (event: TestEvent) => void>();
  const stored = new Map<string, Map<string, Response>>();
  let skipped = 0;
  let claimed = 0;
  let network: Fetcher = () => Promise.resolve(new Response("ネット"));
  const requests: string[] = [];
  const key = (request: Request | URL | string) => new URL(request instanceof Request ? request.url : String(request), BASE).href;
  const open = (name: string) => {
    if (!stored.has(name)) stored.set(name, new Map());
    const entries = stored.get(name)!;
    return {
      match(request: Request | URL | string) { return Promise.resolve(entries.get(key(request))?.clone()); },
      put(request: Request | URL | string, response: Response) { entries.set(key(request), response.clone()); return Promise.resolve(); },
      addAll(paths: string[]) { for (const path of paths) entries.set(key(path), new Response(`シェル:${path}`)); return Promise.resolve(); },
    };
  };
  const worker = {
    location: new URL("sw.js", BASE),
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
  new Function("self", "caches", "fetch", source)(worker, caches, (request: Request) => {
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
    const request = new Request(new URL(path, BASE), { method });
    if (navigate) Object.defineProperty(request, "mode", { value: "navigate" });
    return dispatch("fetch", request);
  }
  return {
    stored, requests, open, dispatch, request,
    set network(fetcher: Fetcher) { network = fetcher; },
    get skipped() { return skipped; }, get claimed() { return claimed; },
  };
}

Deno.test("SW はサブパスのシェルを入れて待機を飛ばし、古い binette キャッシュだけを消す", async () => {
  const sw = setup();
  await sw.dispatch("install").done();
  assertEquals(sw.skipped, 1);
  assertEquals([...sw.stored.get(CACHE)!.keys()], ["", "index.html", "manifest.webmanifest", "icon.svg"].map(path => BASE + path));
  sw.open("binette-old"); sw.open("another-app");
  await sw.dispatch("activate").done();
  assertEquals([...sw.stored.keys()], [CACHE, "another-app"]);
  assertEquals(sw.claimed, 1);
});

Deno.test("SW の navigate はネットを先に使って更新し、オフラインなら同じページかシェルに戻る", async () => {
  const sw = setup();
  await sw.dispatch("install").done();
  const online = await sw.request("screen", true).response!;
  assertEquals(await online.text(), "ネット");
  sw.network = () => Promise.reject(new Error("オフライン"));
  assertEquals(await (await sw.request("screen", true).response!).text(), "ネット");
  assertEquals(await (await sw.request("unknown", true).response!).text(), "シェル:./");
  sw.stored.get(CACHE)!.delete(BASE);
  assertEquals(await (await sw.request("unknown", true).response!).text(), "シェル:./index.html");
  sw.stored.get(CACHE)!.clear();
  await assertRejects(() => sw.request("unknown", true).response!, Error, "オフラインのページがありません");
});

Deno.test("SW は HTTP の失敗をキャッシュせず、navigate では保存済みのシェルを使う", async () => {
  const sw = setup();
  await sw.dispatch("install").done();
  sw.network = () => Promise.resolve(new Response("失敗", { status: 503 }));
  assertEquals(await (await sw.request("screen", true).response!).text(), "シェル:./");
  assertEquals(await sw.open(CACHE).match("screen"), undefined);
  sw.stored.get(CACHE)!.clear();
  assertEquals((await sw.request("screen", true).response!).status, 503);
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
