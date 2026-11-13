import { assertEquals } from "@std/assert";
import { allowsNetUrl, matchesNetUrl } from "../src/net.ts";

Deno.test("net の URL は正規化してパスの境目を守る", () => {
  assertEquals(matchesNetUrl("https://EXAMPLE.com/repo/a", "https://example.COM/repo/"), true);
  assertEquals(matchesNetUrl("https://example.com/repository/a", "https://example.com/repo/"), false);
  assertEquals(matchesNetUrl("https://example.com/any", "https://example.com"), true);
  assertEquals(matchesNetUrl("https://other.example.com/repo/a", "https://example.com/repo/"), false);
});

Deno.test("net の deny は要求と allow より優先する", () => {
  const lists = { request: ["https://example.com/"], appAllow: [], appDeny: ["https://example.com/private/"], commonAllow: [], commonDeny: [] };
  assertEquals(allowsNetUrl("https://example.com/public/a", lists), true);
  assertEquals(allowsNetUrl("https://example.com/private/a", lists), false);
  assertEquals(allowsNetUrl("https://another.example/", lists), false);
});

Deno.test("通信のヘッダーと fetch の設定を制限する", async () => {
  const { createNetService } = await import("../src/net.ts");
  let init: RequestInit | undefined;
  const service = createNetService((_input, options) => {
    init = options;
    return Promise.resolve(new Response("hello", { headers: { etag: "tag", "x-secret": "hidden" } }));
  });
  const lists = { request: ["https://example.com/"], appAllow: [], appDeny: [], commonAllow: [], commonDeny: [] };
  const result = await service("app", { url: "https://example.com/a", headers: [["Accept", "text/plain"]] }, lists, new AbortController().signal);
  assertEquals(result.body, new TextEncoder().encode("hello"));
  assertEquals(result.headers, [["content-type", "text/plain;charset=UTF-8"], ["etag", "tag"]]);
  assertEquals([init?.credentials, init?.referrerPolicy, init?.cache, init?.redirect], ["omit", "no-referrer", "no-store", "manual"]);
  assertEquals((await service("app", { url: "https://example.com/", headers: [["Authorization", "secret"]] }, lists, new AbortController().signal)).reason, "invalid");
});

Deno.test("通信の大きさ・転送・制限時間を検査する", async () => {
  const { createNetService } = await import("../src/net.ts");
  const lists = { request: ["https://example.com/"], appAllow: [], appDeny: [], commonAllow: [], commonDeny: [] };
  const signal = new AbortController().signal;
  const large = createNetService(() => Promise.resolve(new Response(new Uint8Array(4 * 1024 * 1024 + 1))));
  assertEquals((await large("app", { url: "https://example.com/" }, lists, signal)).reason, "too_large");
  const redirect = createNetService(() => Promise.resolve(new Response(null, { status: 302 })));
  assertEquals((await redirect("app", { url: "https://example.com/" }, lists, signal)).type, "opaqueredirect");
  assertEquals((await redirect("app", { url: "https://example.com/", redirect: "error" }, lists, signal)).reason, "redirect");
  const slow = createNetService((_input, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("abort")))), 5);
  assertEquals((await slow("app", { url: "https://example.com/" }, lists, signal)).reason, "timeout");
  let cancelled = false;
  const slowBody = createNetService(() => Promise.resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } }))), 5);
  assertEquals((await slowBody("app", { url: "https://example.com/" }, lists, signal)).reason, "timeout");
  assertEquals(cancelled, true);
});

Deno.test("同一アプリの 5 本目は空きを待ち、待機中も中断できる", async () => {
  const { createNetService } = await import("../src/net.ts");
  const lists = { request: ["https://example.com/"], appAllow: [], appDeny: [], commonAllow: [], commonDeny: [] };
  const releases: (() => void)[] = [];
  const service = createNetService(() => new Promise(resolve => releases.push(() => resolve(new Response()))));
  const request = { url: "https://example.com/" };
  const controller = new AbortController();
  const first = Array.from({ length: 4 }, () => service("app", request, lists, controller.signal));
  const cancelled = new AbortController();
  const fifth = service("app", request, lists, cancelled.signal);
  assertEquals(releases.length, 4);
  cancelled.abort();
  assertEquals((await fifth).reason, "aborted");
  const sixth = service("app", request, lists, controller.signal);
  releases.shift()!();
  await first[0];
  await Promise.resolve();
  assertEquals(releases.length, 4);
  for (const release of releases) release();
  await Promise.all([...first, sixth]);
});

Deno.test("オフラインでは通信せず offline を返す", async () => {
  const { createNetService } = await import("../src/net.ts");
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
  try {
    const service = createNetService(() => { throw new Error("fetch してはいけません"); });
    const lists = { request: ["https://example.com/"], appAllow: [], appDeny: [], commonAllow: [], commonDeny: [] };
    assertEquals((await service("app", { url: "https://example.com/" }, lists, new AbortController().signal)).reason, "offline");
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});

Deno.test("通信の既定の制限時間は 30 秒", async () => {
  const { createNetService } = await import("../src/net.ts");
  const original = globalThis.setTimeout;
  let duration = 0;
  globalThis.setTimeout = ((handler: TimerHandler, delay?: number) => { duration = delay ?? 0; return original(handler, delay); }) as typeof setTimeout;
  try {
    const service = createNetService(() => Promise.resolve(new Response("ok")));
    const lists = { request: ["https://example.com/"], appAllow: [], appDeny: [], commonAllow: [], commonDeny: [] };
    await service("app", { url: "https://example.com/" }, lists, new AbortController().signal);
    assertEquals(duration, 30_000);
  } finally { globalThis.setTimeout = original; }
});

Deno.test("アプリが足した通信先も許し、アプリ別・共通の deny が優先する", () => {
  const url = "https://example.com/docs/a";
  const lists = { request: [], appAllow: [], appAdded: ["https://example.com/docs/"], appDeny: [] as string[], commonAllow: [], commonDeny: [] as string[] };
  assertEquals(allowsNetUrl(url, lists), true);
  lists.appDeny.push("https://example.com/");
  assertEquals(allowsNetUrl(url, lists), false);
  lists.appDeny = [];
  lists.commonDeny.push("https://example.com/");
  assertEquals(allowsNetUrl(url, lists), false);
  lists.commonDeny = []; lists.appAdded = [];
  assertEquals(allowsNetUrl(url, lists), false);
});

Deno.test("通信の確認を待つ時間はタイムアウトに数えず、不正な要求では確認しない", async () => {
  const { createNetService } = await import("../src/net.ts");
  const lists = { request: ["https://example.com/"], appAllow: [], appDeny: [], commonAllow: [], commonDeny: [] };
  let calls = 0; let confirmed = 0;
  const service = createNetService(() => { calls++; return Promise.resolve(new Response("ok")); }, 5);
  const authorize = async () => { confirmed++; await new Promise(resolve => setTimeout(resolve, 30)); return lists; };
  assertEquals((await service("app", { url: "https://example.com/" }, lists, new AbortController().signal, authorize)).status, 200);
  assertEquals([calls, confirmed], [1, 1]);
  assertEquals((await service("app", { url: "https://example.com/", method: "POST" }, lists, new AbortController().signal, authorize)).reason, "invalid");
  assertEquals(confirmed, 1);
});
