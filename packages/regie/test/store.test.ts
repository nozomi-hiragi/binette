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
