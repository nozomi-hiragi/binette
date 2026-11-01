import { assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import { createMemoryAppStore, type InstalledApp, installedAppKey, validateSystemSettings, type SystemSettings } from "../src/index.ts";

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

Deno.test("OS の設定は知らない名前と範囲外を拒み、保存済みの値を変えない", async () => {
  const store = createMemoryAppStore().system;
  await store.putSettings({ stackSize: 2 });
  for (const value of [{ unknown: 1 }, { stackSize: 0 }, { stackSize: 1.5 }, { historyLimit: -1 }, { historyLimit: 0.5 },
    { stopDelay: -1 }, { callTimeout: NaN }, { destroyTimeout: Infinity }, { homeRetryWindow: -1 }, { home: 1 }]) {
    const settings = value as Partial<SystemSettings>;
    assertThrows(() => validateSystemSettings(settings));
    assertThrows(() => store.putSettings(settings));
    assertEquals(await store.getSettings(), { stackSize: 2 });
  }
});

Deno.test("ファイルの木を共有してアプリと OS の記録を読み書きする", async () => {
  const { createMemoryFileTree } = await import("../src/fs.ts");
  const { createAppStore } = await import("../src/store.ts");
  const tree = createMemoryFileTree();
  const first = createAppStore(tree);
  const second = createAppStore(tree);
  const apps = [app("z/source", "../x"), app("a/source", "../x"), app("", "")];
  await Promise.all(apps.map((value, index) => (index % 2 ? first : second).put(value)));
  assertEquals((await first.list()).map(value => value.key).sort(), apps.map(value => value.key).sort());
  for (const value of apps) assertEquals(await second.get(value.key), value);
  const paths = await tree.list("/apps");
  assertEquals(paths.length, 6);
  assertEquals(paths.every(path => path.endsWith("/record.json") || path.endsWith("/app.wasm")), true);
  await Promise.all(Array.from({ length: 20 }, (_, time) =>
    (time % 2 ? first : second).system.recordLaunch({ time, app: apps[0]!.key })));
  assertEquals((await second.system.listLaunches()).map(record => record.time), Array.from({ length: 20 }, (_, i) => i));
  await first.system.putSettings({ home: "shared" });
  assertEquals(await second.system.getSettings(), { home: "shared" });
  await tree.write("/data/system/settings.json", new TextEncoder().encode('{"stackSize":4}'));
  assertEquals(await first.system.getSettings(), { stackSize: 4 });
});

Deno.test("アプリは索引なしで記録とバイナリを保存し、一覧をパス順に返す", async () => {
  const { createMemoryFileTree } = await import("../src/fs.ts");
  const { createAppStore } = await import("../src/store.ts");
  const { appFilePaths, encodeAppPathSegment, decodeAppPathSegment } = await import("../src/app-files.ts");
  const tree = createMemoryFileTree();
  const store = createAppStore(tree);
  const values = [app("z", "id"), app("a", "id"), ...["", ".", "..", "%", "a/b", "日本語"].map(value => app(value, value))];
  for (const value of values) {
    assertEquals(decodeAppPathSegment(encodeAppPathSegment(value.source)), value.source);
    await store.put(value);
    const paths = appFilePaths(value.manifest.id, value.source);
    assertEquals(await tree.read(paths.wasm), value.wasm);
    const record = JSON.parse(new TextDecoder().decode(await tree.read(paths.record)));
    assertEquals("wasm" in record, false);
    assertEquals(await store.get(value.key), value);
  }
  assertEquals(await tree.list("/data/apps"), []);
  await tree.write("/apps/unrelated.txt", new Uint8Array([1]));
  await tree.write("/apps/other/source/record.json", new TextEncoder().encode("{}"));
  const expected = [...values].sort((a, b) => {
    const left = appFilePaths(a.manifest.id, a.source).record;
    const right = appFilePaths(b.manifest.id, b.source).record;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  assertEquals(await store.list(), expected);
  const updated = { ...values[0]!, html: "更新", wasm: new Uint8Array([9, 8]), icon: undefined };
  await store.put(updated);
  assertEquals(await store.get(updated.key), updated);
  assertEquals(await tree.read(appFilePaths(updated.manifest.id, updated.source).wasm), updated.wasm);
  assertEquals((await store.list()).length, values.length);
  for (const key of ["missing", "null", "{}", '["one"]', '[1,2]', '[ "z", "id" ]']) assertEquals(await store.get(key), undefined);
});
