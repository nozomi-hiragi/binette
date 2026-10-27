import { assertEquals, assertNotEquals } from "@std/assert";
import { createMemoryAppStore, type InstalledApp, installedAppKey } from "../src/index.ts";

const app = (source: string, id: string): InstalledApp => ({
  key: installedAppKey(source, id), source,
  manifest: { id, name: "アプリ", version: "0.1.0", entry: { html: "index.html", as: "main.ts" } },
  icon: "<svg/>", html: "<p>アプリ</p>", wasm: new Uint8Array([1, 2, 3]), installedAt: 123,
});

Deno.test("入手元と ID の区切りは衝突しない", () => {
  assertEquals(installedAppKey("a", "b"), '["a","b"]');
  assertNotEquals(installedAppKey("a:b", "c"), installedAppKey("a", "b:c"));
});

Deno.test("メモリ版は一覧・取得・上書きができ、入手元ごとに分かれる", async () => {
  const store = createMemoryAppStore();
  assertEquals(await store.list(), []);
  assertEquals(await store.get("missing"), undefined);
  const first = app("first", "x");
  const second = app("second", "x");
  await store.put(first);
  await store.put(second);
  assertEquals(await store.get(first.key), first);
  const update = { ...first, html: "更新", installedAt: 456, icon: undefined };
  await store.put(update);
  assertEquals(await store.get(first.key), update);
  assertEquals(await store.list(), [update, second]);
});

Deno.test("メモリ版の読み書きで保存した値を共有しない", async () => {
  const store = createMemoryAppStore();
  const original = app("source", "x");
  const expected = structuredClone(original);
  await store.put(original);
  original.manifest.name = "変更";
  original.wasm[0] = 9;
  const saved = (await store.get(original.key))!;
  assertEquals(saved, expected);
  saved.manifest.name = "また変更";
  saved.wasm[0] = 8;
  const listed = await store.list();
  listed[0]!.manifest.name = "一覧を変更";
  assertEquals(await store.get(original.key), expected);
  assertEquals(await createMemoryAppStore().list(), []);
});

Deno.test("OS の記録はアプリごとに分かれ、設定と履歴も写して保存する", async () => {
  const store = createMemoryAppStore().system;
  assertEquals(await store.getLast("a"), undefined); assertEquals(await store.getSettings(), undefined);
  const record = { state: 6, done: false, page: "ページ", reason: { kind: 1, cause: 2 } };
  await store.putLast("a", record); record.reason.kind = 0;
  assertEquals((await store.getLast("a"))!.reason.kind, 1); assertEquals(await store.getLast("b"), undefined);
  const last = (await store.getLast("a"))!; last.page = "変更";
  assertEquals((await store.getLast("a"))!.page, "ページ");
  const settings = { home: "home", stackSize: 2, callTimeout: 99 };
  await store.putSettings(settings); settings.stackSize = 8;
  const saved = (await store.getSettings())!; saved.home = "変更";
  assertEquals(await store.getSettings(), { home: "home", stackSize: 2, callTimeout: 99 });
  await store.putSettings({}); assertEquals(await store.getSettings(), {});
  for (let i = 0; i < 105; i++) await store.recordLaunch({ time: i, app: `app${i}` });
  const history = await store.listLaunches(); assertEquals(history.length, 100); assertEquals(history[0]!.time, 5);
  assertEquals(history[99]!.time, 104); history[0]!.app = "変更";
  assertEquals((await store.listLaunches())[0]!.app, "app5");
  await Promise.all([store.recordLaunch({ time: 105, app: "a" }, 2), store.recordLaunch({ time: 106, app: "b" }, 2)]);
  assertEquals(await store.listLaunches(), [{ time: 105, app: "a" }, { time: 106, app: "b" }]);
  await store.recordLaunch({ time: 107, app: "c" }, 0); assertEquals(await store.listLaunches(), []);
});
