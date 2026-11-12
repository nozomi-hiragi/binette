import { assertEquals, assertNotEquals, assertRejects, assertThrows } from "@std/assert";
import { createAppStore, createMemoryAppStore, createMemoryFileTree, type InstalledApp, appId, validateSystemSettings, type SystemSettings } from "../src/index.ts";

const app = (source: string, id: string): InstalledApp => ({
  key: appId(source, id), source,
  manifest: { id, name: "アプリ", version: "0.1.0", entry: { html: "index.html", as: "main.ts" } },
  icon: "<svg/>", html: "<p>アプリ</p>", wasm: new Uint8Array([1, 2, 3]), installedAt: 123,
});

Deno.test("完全な ID は URL を正規化し、埋め込みは生の ID を使う", () => {
  assertEquals(appId("https://EXAMPLE.test:443/apps/", "メモ"), "https://example.test/apps/#%E3%83%A1%E3%83%A2");
  assertEquals(appId("binette:system", "cadre"), "cadre");
  assertEquals(appId("binette:bundled", "designer"), "designer");
  for (const source of ["binette:system", "binette:bundled"]) {
    assertThrows(() => appId(source, "io.github.nozomi-hiragi.binette.home"));
    assertThrows(() => appId(source, "https://example.test/#memo"));
  }
  assertThrows(() => appId("binette:system", "other.invalid"));
  assertNotEquals(appId("https://one.test/", "memo"), appId("https://two.test/", "memo"));
});

Deno.test("メモリ版は一覧・取得・上書きができ、入手元ごとに分かれる", async () => {
  const store = createMemoryAppStore();
  assertEquals(await store.list(), []);
  assertEquals(await store.get("missing"), undefined);
  const first = app("https://first.test/", "x");
  const second = app("https://second.test/", "x");
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
  const original = app("https://source.test/", "x");
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
  const settings = { roles: { home: "home" }, stackSize: 2, callTimeout: 99 };
  await store.putSettings(settings); settings.stackSize = 8;
  const saved = (await store.getSettings())!; saved.roles!.home = "変更";
  assertEquals(await store.getSettings(), { roles: { home: "home" }, stackSize: 2, callTimeout: 99 });
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
    { stopDelay: -1 }, { callTimeout: NaN }, { destroyTimeout: Infinity }, { homeRetryWindow: -1 }, { theme: 3 }, { accent: 1.5 }, { wallpaper: 256 }, { home: "旧名" }, { roles: "home" }, { roles: { home: 1 } }, { roles: ["home"] }, { roles: null }]) {
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
  const apps = [app("https://z.test/source", "x/y"), app("https://a.test/source", "x/y"), app("binette:system", "raw")];
  await Promise.all(apps.map((value, index) => (index % 2 ? first : second).put(value)));
  assertEquals((await first.list()).map(value => value.key).sort(), apps.map(value => value.key).sort());
  for (const value of apps) assertEquals(await second.get(value.key), value);
  const paths = await tree.list("/apps");
  assertEquals(paths.length, 0);
  assertEquals((await tree.storage!.listApps()).length, 3);
  assertEquals(paths.every(path => path.endsWith("/record.json") || path.endsWith("/app.wasm")), true);
  await Promise.all(Array.from({ length: 20 }, (_, time) =>
    (time % 2 ? first : second).system.recordLaunch({ time, app: apps[0]!.key })));
  assertEquals((await second.system.listLaunches()).map(record => record.time), Array.from({ length: 20 }, (_, i) => i));
  await first.system.putSettings({ roles: { home: "shared" } });
  assertEquals(await second.system.getSettings(), { roles: { home: "shared" } });
  await tree.write("/data/system/settings.json", new TextEncoder().encode('{"stackSize":4}'));
  assertEquals(await first.system.getSettings(), { stackSize: 4 });
});

Deno.test("Apps store metadata and binaries in their owner and list by full ID", async () => {
  const { createMemoryFileTree } = await import("../src/fs.ts");
  const { createAppStore } = await import("../src/store.ts");
  const { encodeAppPathSegment, decodeAppPathSegment } = await import("../src/app-files.ts");
  const tree = createMemoryFileTree();
  const store = createAppStore(tree);
  const values = [app("https://z.test/", "id"), app("https://a.test/", "id"), ...["%", "a/b", "日本語"].map(value => app("https://example.test/", value))];
  for (const value of values) {
    assertEquals(decodeAppPathSegment(encodeAppPathSegment(value.source)), value.source);
    await store.put(value);
    const owner = tree.storage!.forOwner(await tree.storage!.appOwner(value.key, value.source));
    assertEquals(await owner.read("/build/app.wasm"), value.wasm);
    const record = JSON.parse(new TextDecoder().decode(await owner.read("/build/record.json")));
    assertEquals("wasm" in record, false);
    assertEquals(await store.get(value.key), value);
  }
  assertEquals(await tree.list("/data/apps"), []);
  await tree.write("/apps/unrelated.txt", new Uint8Array([1]));
  await tree.write("/apps/other/source/record.json", new TextEncoder().encode("{}"));
  const expected = [...values].sort((a, b) => {
    const left = a.key;
    const right = b.key;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  assertEquals(await store.list(), expected);
  const updated = { ...values[0]!, html: "更新", wasm: new Uint8Array([9, 8]), icon: undefined };
  await store.put(updated);
  assertEquals(await store.get(updated.key), updated);
  assertEquals(await tree.storage!.forOwner(await tree.storage!.appOwner(updated.key, updated.source)).read("/build/app.wasm"), updated.wasm);
  assertEquals((await store.list()).length, values.length);
  for (const key of ["missing", "null", "{}", '["one"]', '[1,2]', '[ "z", "id" ]']) assertEquals(await store.get(key), undefined);
});

Deno.test("App data is stored below each owner /data and rejects the reserved system ID", async () => {
  const { createMemoryFileTree } = await import("../src/fs.ts");
  const { createAppStore } = await import("../src/store.ts");
  const tree = createMemoryFileTree();
  const store = createAppStore(tree).data;
  assertEquals(await store.read("memo"), new Map());
  await store.write("memo", "メモ/1", "中身🏠");
  await store.write("memo", "b", "2");
  await store.write("other", "b", "別");
  assertEquals(await store.read("memo"), new Map([["メモ/1", "中身🏠"], ["b", "2"]]));
  assertEquals(await tree.storage!.forOwner(await tree.storage!.appOwner("memo")).list("/data"), ["/data/%E3%83%A1%E3%83%A2%2F1", "/data/b"]);
  await store.write("memo", "b", null);
  await store.write("memo", "無い", null);
  assertEquals([...(await store.read("memo")).keys()], ["メモ/1"]);
  assertEquals(await store.read("other"), new Map([["b", "別"]]));
  await assertRejects(() => store.read("system"), Error, "system");
  await assertRejects(() => store.write("system", "settings.json", "x"), Error, "system");
});

Deno.test("保存済みの旧い home を roles.home に読み替える", async () => {
  const tree = createMemoryFileTree();
  await tree.write("/data/system/settings.json", new TextEncoder().encode(JSON.stringify({ home: "a", stackSize: 2 })));
  assertEquals(await createAppStore(tree).system.getSettings(), { stackSize: 2, roles: { home: "a" } });
});

Deno.test("owned app files and data keep their owner when a provider moves", async () => {
  const tree = createMemoryFileTree();
  const store = createAppStore(tree);
  const original = app("https://old.test/", "memo");
  await store.put(original, new Map([["app.json", new TextEncoder().encode("{}")], ["record.json", new Uint8Array([7])]]));
  const owner = await tree.storage!.appOwner(original.key, original.source);
  const files = tree.storage!.forOwner(owner);
  assertEquals(await files.read("/source/record.json"), new Uint8Array([7]));
  assertEquals(await files.read("/build/app.wasm"), original.wasm);
  await store.data.write(original.key, "note", "saved");
  assertEquals(await store.data.read(`${original.key}.child`), new Map([["note", "saved"]]));
  await store.system.putPermissions(original.key, ["fs"]);
  await store.system.putSettings({ roles: { home: `${original.key}.child` } });
  await store.system.recordLaunch({ time: 1, app: original.key });
  await store.moveSource(original.source, "https://new.test/");
  const next = appId("https://new.test/", "memo");
  assertEquals(await tree.storage!.appOwner(next, "https://new.test/"), owner);
  assertEquals((await store.get(next))?.source, "https://new.test/");
  assertEquals(await store.get(original.key), undefined);
  assertEquals(await store.data.read(next), new Map([["note", "saved"]]));
  assertEquals(await store.system.getPermissions(next), ["fs"]);
  assertEquals((await store.system.getSettings())?.roles, { home: `${next}.child` });
  assertEquals(await store.system.listLaunches(), [{ time: 1, app: next }]);
  await store.put({ ...original, key: next, source: "https://new.test/", html: "updated" });
  assertEquals((await store.system.getSettings())?.roles, { home: `${next}.child` });
  assertEquals(await store.system.listLaunches(), [{ time: 1, app: next }]);
});

Deno.test("provider registrations preserve boot metadata and resolve moved URLs without rewriting files", async () => {
  const tree = createMemoryFileTree();
  const store = createAppStore(tree);
  const from = "https://registered.test/";
  const to = "https://moved.test/";
  await store.system.putLists([{ url: from, boot: from }]);
  const provider = await tree.storage!.provider(from);
  assertEquals(typeof provider?.number, "number");
  const owner = tree.storage!.forOwner("_0/-0");
  const before = await owner.metadata("/data/system/lists.json");
  await store.moveSource(from, to, [{ url: to, boot: from }]);
  assertEquals(await store.system.getLists(), [{ url: to, boot: from }]);
  assertEquals(await owner.metadata("/data/system/lists.json"), before);
  assertEquals((await tree.storage!.provider(to))?.number, provider!.number);
  assertEquals(await tree.storage!.provider(from), undefined);
  const reopened = createAppStore(tree);
  assertEquals(await reopened.system.getLists(), [{ url: to, boot: from }]);
  await tree.write("/data/system/lists.json", new TextEncoder().encode(JSON.stringify([{ url: to, boot: from, provider: 999 }])));
  assertEquals(await reopened.system.getLists(), [{ url: to, boot: from }]);
  await reopened.system.putLists(await reopened.system.getLists());
  assertEquals(await reopened.system.getLists(), [{ url: to, boot: from }]);
});

Deno.test("settings and launch history preserve unknown and noncanonical app strings", async () => {
  const tree = createMemoryFileTree();
  const store = createAppStore(tree);
  const values = ["後続で使う設定", "missing", "https://EXAMPLE.test:443/apps/#memo", "io.example.app"];
  for (const value of values) {
    await store.system.putSettings({ roles: { home: value } });
    assertEquals((await store.system.getSettings())?.roles, { home: value });
    await store.system.recordLaunch({ time: 1, app: value });
  }
  assertEquals(await store.system.listLaunches(), values.map(app => ({ time: 1, app })));
  assertEquals((await tree.storage!.listApps()).map(entry => entry.id), ["missing"]);
});

Deno.test("canonical roles saved before installation follow later provider moves", async () => {
  const tree = createMemoryFileTree();
  const store = createAppStore(tree);
  const original = app("https://pending.test/", "memo");
  await store.system.putSettings({ roles: { home: `${original.key}.child` } });
  await store.system.recordLaunch({ time: 1, app: original.key });
  assertEquals((await store.system.getSettings())?.roles, { home: `${original.key}.child` });
  assertEquals(await store.get(original.key), undefined);
  await store.put(original);
  await store.moveSource(original.source, "https://installed.test/");
  const next = appId("https://installed.test/", "memo");
  assertEquals((await store.system.getSettings())?.roles, { home: `${next}.child` });
  assertEquals(await store.system.listLaunches(), [{ time: 1, app: next }]);
});

Deno.test("単一アプリと保存済み owner の検索は名簿全体を列挙しない", async () => {
  const tree = createMemoryFileTree();
  const store = createAppStore(tree);
  const original = app("https://lookup.test/", "memo");
  await store.put(original);
  await store.system.putSettings({ roles: { home: `${original.key}.child` } });
  await store.system.recordLaunch({ time: 1, app: original.key });
  tree.storage!.listApps = () => { throw new Error("名簿全体を列挙しました。"); };
  assertEquals(await store.get(original.key), original);
  assertEquals(await store.get("missing"), undefined);
  assertEquals(await store.get(`${original.key}.child`), undefined);
  await store.moveSource(original.source, "https://moved.test/");
  const next = appId("https://moved.test/", "memo");
  assertEquals((await store.get(next))?.key, next);
  assertEquals((await store.system.getSettings())?.roles, { home: `${next}.child` });
  assertEquals(await store.system.listLaunches(), [{ time: 1, app: next }]);
  let ownerLookups = 0;
  const findAppByOwner = tree.storage!.findAppByOwner.bind(tree.storage);
  tree.storage!.findAppByOwner = owner => { ownerLookups++; return findAppByOwner(owner); };
  await tree.write("/data/system/settings.json", new TextEncoder().encode(JSON.stringify({ roles: { home: "unknown value" } })));
  assertEquals((await store.system.getSettings())?.roles, { home: "unknown value" });
  assertEquals(ownerLookups, 0);
});

Deno.test("本体だけを消すとデータと印が残り、入れ直すと引き継ぐ。データごと消すと全部消える", async () => {
  const store = createMemoryAppStore();
  const memo = { ...app("https://list.test/", "memo"), listVersion: "1.0" };
  await store.put(memo, new Map([["app.json", new Uint8Array([1])]]));
  await store.data.write(memo.key, "note", "こんにちは");
  await store.system.putPermissions(memo.key, ["notify"]);
  await store.uninstall(memo.key, false);
  assertEquals(await store.get(memo.key), undefined);
  assertEquals((await store.list()).length, 0);
  const [removed] = await store.listRemoved();
  assertEquals({ ...removed, removedAt: 0 }, { key: memo.key, source: memo.source, name: "アプリ", version: "1.0", icon: "<svg/>", removedAt: 0 });
  assertEquals(await store.data.read(memo.key), new Map([["note", "こんにちは"]]));
  await store.put(memo);
  assertEquals(await store.get(memo.key), memo);
  assertEquals(await store.listRemoved(), []);
  assertEquals((await store.data.read(memo.key)).get("note"), "こんにちは");
  await store.uninstall(memo.key, false);
  await store.uninstall(memo.key, true);
  assertEquals(await store.listRemoved(), []);
  assertEquals(await store.system.getPermissions(memo.key), []);
  await store.put(memo);
  assertEquals(await store.data.read(memo.key), new Map());
});

for (const mutation of ["update", "body-delete", "data-delete"]) {
  Deno.test(`条件付き成果物置換は比較後・保存直前の ${mutation} を上書きしない`, async () => {
    const tree = createMemoryFileTree();
    const manual = createAppStore(tree);
    const original = app("https://source.test/", "race");
    const next = { ...original, html: "手動更新", wasm: new Uint8Array([9]), listVersion: "manual" };
    await manual.put(original, new Map([["main.ts", new Uint8Array([7])]]));
    await manual.data.write(original.key, "note", "保持");
    let release = () => {}, entered = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const pending = new Promise<void>(resolve => { entered = resolve; });
    const racing = createAppStore({ ...tree, storage: { ...tree.storage!, forOwner(id) {
      const owner = tree.storage!.forOwner(id);
      return { ...owner, async writeFilesIfUnchanged(expected, files, remove) { entered(); await gate; return await owner.writeFilesIfUnchanged!(expected, files, remove); } };
    } } });
    const replace = racing.replace!(original, { ...original, html: "遅い再ビルド", wasm: new Uint8Array([8]) });
    await pending;
    if (mutation === "update") await manual.put(next);
    else await manual.uninstall(original.key, mutation === "data-delete");
    release();
    assertEquals(await replace, false);
    assertEquals(await manual.get(original.key), mutation === "update" ? next : undefined);
    assertEquals((await manual.list()).length, mutation === "update" ? 1 : 0);
    if (mutation !== "data-delete") assertEquals(await manual.data.read(original.key), new Map([["note", "保持"]]));
    else assertEquals(await tree.storage!.findApp(original.key), undefined);
  });
}

Deno.test("条件付き成果物置換は同じ記録なら保存し、許可・役割・ソースを保つ", async () => {
  const tree = createMemoryFileTree();
  const store = createAppStore(tree);
  const original = app("https://source.test/", "same");
  const files = new Map([["main.ts", new Uint8Array([7])]]);
  await store.put(original, files);
  await store.system.putPermissions(original.key, ["schedule"]);
  await store.system.putSettings({ roles: { files: original.key } });
  const next = { ...original, wasm: new Uint8Array([8]), html: "復旧" };
  assertEquals(await store.replace!(original, next), true);
  assertEquals(await store.get(original.key), next);
  const owner = tree.storage!.forOwner((await tree.storage!.findApp(original.key))!.owner);
  assertEquals(await owner.read("/source/main.ts"), files.get("main.ts"));
  assertEquals(await store.system.getPermissions(original.key), ["schedule"]);
  assertEquals((await store.system.getSettings())!.roles, { files: original.key });
});
