import { assert, assertEquals, assertRejects } from "@std/assert";
import { Window } from "happy-dom";
import { computeIntegrity } from "@binette/core";
import { createAppStore, createMemoryFileTree, createProviderLists, startSystem } from "../src/index.ts";
import type { InstalledApp, ProviderListsOptions } from "../src/index.ts";
import { buildCompiler } from "../../../scripts/build-system.ts";

const encoder = new TextEncoder();
const listUrl = "https://provider.test/apps/";
const sourceUrl = "https://sources.test/memo/";
const manifest = { id: "memo", name: "メモ", version: "manifest-version", entry: { as: "src/main.ts", css: "main.css" }, icon: "icon.svg", sub: { widget: { name: "ウィジェット", icon: "sub.svg" } } };
const sources = {
  "app.json": JSON.stringify(manifest), "src/main.ts": 'import { value } from "./value"; export function answer(): i32 { return value; }',
  "src/value.ts": "export const value: i32 = 42;", "main.css": "body { color: red; }", "icon.svg": "<svg/>", "sub.svg": "<svg/>",
};
let compiler: Promise<Uint8Array> | undefined;
function compilerBytes() {
  return compiler ??= (async () => {
    const directory = await Deno.makeTempDir({ prefix: "binette-list-test-" });
    try { await buildCompiler(`${directory}/asc.js`); return await Deno.readFile(`${directory}/asc.js`); }
    finally { await Deno.remove(directory, { recursive: true }); }
  })();
}
const entry = (version = "list-version", integrity?: Record<string, string>) => ({ id: "memo", source: sourceUrl, version, ...(integrity ? { integrity } : {}) });
const html = (apps = [entry()]) => `<script type="application/json" id="binette-apps">${JSON.stringify({ name: "提供者", apps })}</script>`;
const moved = (url: string) => `<script type="application/json" id="binette-apps">${JSON.stringify({ name: "移転", movedTo: url })}</script>`;
async function fixture(extra: Partial<ProviderListsOptions> = {}, browser = false) {
  const tree = createMemoryFileTree();
  const store = createAppStore(tree);
  const requests: string[] = [];
  const responses = new Map<string, string>([[listUrl, html()], ...Object.entries(sources).map(([path, text]): [string, string] => [sourceUrl + path, text])]);
  const window = new Window();
  const errors: unknown[] = [];
  const options: ProviderListsOptions = {
    store,
    fetch: (input, init) => {
      assertEquals(init?.mode, "cors");
      const url = String(input); requests.push(url);
      const text = responses.get(url);
      return Promise.resolve(new Response(text ?? "無し", { status: text === undefined ? 404 : 200 }));
    },
    parseHtml: html => new window.DOMParser().parseFromString(html, "text/html"),
    report(error) { errors.push(error); },
    ...extra,
  };
  if (browser) {
    const bytes = await compilerBytes();
    const replique = await Deno.readFile(new URL("../../replique/src/index.ts", import.meta.url));
    options.browserBuild = { distribution: { readSystem: path => Promise.resolve(path.endsWith("asc.js") ? bytes : replique) }, workerUrl: new URL("./fixtures/browser-build-worker.ts", import.meta.url) };
  }
  const lists = await createProviderLists(options);
  return { tree, store, lists, responses, requests, errors, options, async stop() { lists.stop(); await window.happyDOM.close(); } };
}

Deno.test("提供リストは link を優先し、JSON と埋め込みの相対 URL を各文書から解決する", async () => {
  const f = await fixture();
  try {
    f.responses.set(listUrl, `<link rel="alternate binette-apps" href="json/apps.json">${html()}`);
    f.responses.set(listUrl + "json/apps.json", JSON.stringify({ name: "リンク", apps: [{ id: "memo", source: "../source/", version: "1" }] }));
    assertEquals((await f.lists.add(listUrl)).apps[0].source, listUrl + "source/");
    assertEquals(f.requests, [listUrl, listUrl + "json/apps.json"]);
    f.responses.set(listUrl, `<script type="application/json" id="binette-apps">${JSON.stringify({ name: "埋込", apps: [{ id: "memo", source: "source/", version: "1" }] })}</script>`);
    assertEquals((await f.lists.fetch(listUrl)).apps[0].source, listUrl + "source/");
    for (const response of [undefined, "JSON ではない"]) {
      f.responses.set(listUrl, `<link rel="binette-apps" href="bad.json">${html()}`);
      if (response !== undefined) f.responses.set(listUrl + "bad.json", response);
      await assertRejects(() => f.lists.fetch(listUrl));
    }
    f.responses.set(listUrl, "<p>リストではない</p>");
    await assertRejects(() => f.lists.fetch(listUrl), Error, "Binette の提供リストではありません");
  } finally { await f.stop(); }
});

Deno.test("http はデバッグ設定時だけ許可し、既定リストは移転後と再起動後も消せない", async () => {
  const f = await fixture({ lists: [listUrl] });
  const next = "https://next.test/apps/";
  try {
    const http = "http://localhost/apps/";
    f.responses.set(http, html());
    await assertRejects(() => f.lists.add(http), Error, "https:");
    await f.store.system.putSettings({ allowHttpLists: true });
    await f.lists.add(http);
    await f.store.system.putSettings({ allowHttpLists: false });
    await assertRejects(() => f.lists.fetch(http), Error, "https:");
    await f.lists.remove(http);
    await assertRejects(() => f.lists.remove(listUrl), Error, "既定");
    f.responses.set(listUrl, moved(next)); f.responses.set(next, html());
    await f.lists.check();
    assertEquals(await f.lists.list(), [{ url: next, boot: listUrl }]);
    await assertRejects(() => f.lists.remove(next), Error, "既定");
    const restarted = await createProviderLists({ ...f.options, lists: [listUrl] });
    try { assertEquals(await restarted.list(), [{ url: next, boot: listUrl }]); await assertRejects(() => restarted.remove(next), Error, "既定"); }
    finally { restarted.stop(); }
    const removedBoot = await createProviderLists({ ...f.options, lists: [] });
    try {
      assertEquals(await removedBoot.list(), []);
      await removedBoot.add(next);
      await removedBoot.remove(next);
      assertEquals(await removedBoot.list(), []);
    } finally { removedBoot.stop(); }
  } finally { await f.stop(); }
});

Deno.test("ブラウザ Worker で親とサブのアイコン・import・CSS を取得し、ファイルとフォルダのハッシュを確認する", async () => {
  const f = await fixture({}, true);
  try {
    const files = Object.entries(sources).map(([path, text]) => ({ path, bytes: encoder.encode(text) }));
    const integrity = { "app.json": await computeIntegrity(files, "app.json"), "src/": await computeIntegrity(files, "src/"), "sub.svg": await computeIntegrity(files, "sub.svg") };
    f.responses.set(listUrl, html([entry("1+meta", integrity)]));
    await f.lists.add(listUrl);
    const installed = await f.lists.install(listUrl, "memo");
    assert(WebAssembly.validate(new Uint8Array(installed.wasm)));
    assertEquals(installed.key, listUrl + "#memo"); assertEquals(installed.source, listUrl);
    assertEquals(installed.listVersion, "1+meta"); assertEquals(installed.manifest.version, "manifest-version");
    assertEquals(installed.subIcons, { widget: "<svg/>" }); assertEquals(installed.css, sources["main.css"]);
    assert(f.requests.includes(sourceUrl + "src/value.ts"));
    const requests = f.requests.length;
    await f.lists.check();
    assertEquals(f.requests.slice(requests), [listUrl]);
    f.responses.set(listUrl, html([entry("1+other", integrity)]));
    await f.lists.check();
    assertEquals((await f.store.get(installed.key))?.listVersion, "1+other");
    assertEquals(f.errors, []);
    const before = await f.store.get(installed.key);
    f.responses.set(listUrl, html([entry("bad", { "src/": "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" })]));
    await f.lists.check();
    assertEquals(await f.store.get(installed.key), before); assertEquals(f.errors.length, 1);
  } finally { await f.stop(); }
});

Deno.test("ID の不一致・ハッシュ不一致はインストールを保存せず、日本語で拒否する", async () => {
  const f = await fixture({}, true);
  try {
    await f.lists.add(listUrl);
    f.responses.set(sourceUrl + "app.json", JSON.stringify({ ...manifest, id: "different" }));
    await assertRejects(() => f.lists.install(listUrl, "memo"), Error, "ID と提供リストの ID が一致しません");
    f.responses.set(sourceUrl + "app.json", sources["app.json"]);
    for (const key of ["src/", "app.json", "/", "missing/"]) {
      f.responses.set(listUrl, html([entry("1", { [key]: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" })]));
      await assertRejects(() => f.lists.install(listUrl, "memo"), Error, key === "missing/" ? "ファイルがありません" : "ハッシュが合いません");
      assertEquals(await f.store.list(), []);
    }
  } finally { await f.stop(); }
});

Deno.test("CLI の / とフォルダキーは install の取得ファイルと一致し、未読ファイルを除外し、不一致なら更新を保存しない", async () => {
  const f = await fixture({}, true);
  const dir = await Deno.makeTempDir({ prefix: "binette-root-integrity-" });
  try {
    await Deno.mkdir(`${dir}/src`);
    for (const [path, text] of Object.entries(sources)) await Deno.writeTextFile(`${dir}/${path}`, text);
    await Deno.writeTextFile(`${dir}/unused.txt`, "未読");
    await Deno.writeTextFile(`${dir}/src/unread.ts`, "ビルドでは読まない");
    const run = async (keys: string[] = []) => {
      const output = await new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", new URL("../src/cli.ts", import.meta.url).pathname, "integrity", dir, ...keys,
          "--replique", new URL("../../replique/src/index.ts", import.meta.url).pathname], stdout: "piped", stderr: "piped",
      }).output();
      assert(output.success, new TextDecoder().decode(output.stderr));
      return JSON.parse(new TextDecoder().decode(output.stdout)) as Record<string, string>;
    };
    const integrity = await run();
    const files = Object.entries(sources).map(([path, text]) => ({ path, bytes: encoder.encode(text) }));
    assertEquals(integrity, { "/": await computeIntegrity(files, "/") });
    await Deno.writeTextFile(`${dir}/unused.txt`, "変更しても未読");
    assertEquals(await run(), integrity);
    // 明示ファイルキーを併記した場合だけ、そのファイルも / の対象になる。
    const extra = await run(["/", "unused.txt"]);
    assert(extra["/"] !== integrity["/"]);
    f.responses.set(sourceUrl + "unused.txt", "変更しても未読");
    f.responses.set(listUrl, html([entry("root", extra)]));
    await f.lists.add(listUrl);
    const installed = await f.lists.install(listUrl, "memo");
    assertEquals(installed.listVersion, "root");
    assert(f.requests.includes(sourceUrl + "unused.txt"));
    f.responses.set(listUrl, html([entry("root-only", integrity)]));
    await f.lists.check();
    assertEquals((await f.store.get(installed.key))?.listVersion, "root-only");
    assertEquals(f.errors, []);
    const folder = await run(["src/"]);
    assertEquals(folder, { "src/": await computeIntegrity(files, "src/") });
    await Deno.writeTextFile(`${dir}/src/unread.ts`, "変更しても未読");
    assertEquals(await run(["src/"]), folder);
    f.responses.set(listUrl, html([entry("folder", folder)]));
    assertEquals((await f.lists.install(listUrl, "memo")).listVersion, "folder");
    assert(!f.requests.includes(sourceUrl + "src/unread.ts"));
    // 同じフォルダの明示ファイルキーは、フォルダのハッシュにも含める。
    const folderExtra = await run(["src/", "src/unread.ts"]);
    assert(folderExtra["src/"] !== folder["src/"]);
    f.responses.set(sourceUrl + "src/unread.ts", "変更しても未読");
    f.responses.set(listUrl, html([entry("folder-extra", folderExtra)]));
    assertEquals((await f.lists.install(listUrl, "memo")).listVersion, "folder-extra");
    const before = await f.store.get(installed.key);
    f.responses.set(sourceUrl + "src/value.ts", "export const value: i32 = 43;");
    f.responses.set(listUrl, html([entry("changed", integrity)]));
    await f.lists.check();
    assertEquals(await f.store.get(installed.key), before);
    assertEquals(f.errors.length, 1);
    assert(String(f.errors[0]).includes("ハッシュが合いません: /"));
  } finally { await Deno.remove(dir, { recursive: true }); await f.stop(); }
});

const fakeApp = (source = listUrl): InstalledApp => ({ key: source + "#memo", source, manifest, icon: undefined, html: "", wasm: new Uint8Array(), installedAt: 1, listVersion: "list-version" });
Deno.test("movedTo は親とサブのデータ・権限・役割・起動履歴・ライフサイクルを引き継ぎ、元の記録を消す", async () => {
  const f = await fixture(); const next = "https://next.test/apps/";
  try {
    const app = fakeApp(); const key = app.key; const sub = key + ".widget";
    await f.store.put(app); await f.lists.add(listUrl);
    await f.store.data.write(key, "保存", "内容");
    await f.store.system.putPermissions(key, ["fs"]);
    await f.store.system.putSettings({ roles: { home: sub }, allowHttpLists: false });
    const record = { state: 3, done: true, page: "page", reason: { kind: 1, cause: 2 } };
    for (const app of [key, sub]) { await f.store.system.putLast(app, record); await f.store.system.recordLaunch({ app, time: 12 }); }
    f.responses.set(listUrl, moved(next)); f.responses.set(next, html());
    await f.lists.check();
    assertEquals(await f.lists.list(), [{ url: next }]);
    assertEquals(await f.store.get(key), undefined);
    assertEquals((await f.store.get(next + "#memo"))?.installedAt, 1);
    assertEquals(await f.store.data.read(next + "#memo"), new Map([["保存", "内容"]]));
    assertEquals(await f.store.data.read(key), new Map());
    assertEquals(await f.store.system.getPermissions(next + "#memo"), ["fs"]);
    assertEquals(await f.store.system.getPermissions(key), []);
    assertEquals((await f.store.system.getSettings())?.roles, { home: next + "#memo.widget" });
    for (const id of ["memo", "memo.widget"]) assertEquals(await f.store.system.getLast(next + "#" + id), record);
    assertEquals(await f.store.system.listLaunches(), [{ app: next + "#memo", time: 12 }, { app: next + "#memo.widget", time: 12 }]);
    assertEquals(f.errors, []);
  } finally { await f.stop(); }
});

Deno.test("移転先の取得失敗・ID 衝突・循環は元の登録と保存データを残す", async () => {
  const f = await fixture(); const next = "https://next.test/apps/";
  try {
    await f.store.put(fakeApp()); await f.lists.add(listUrl);
    f.responses.set(listUrl, moved(next));
    await f.lists.check(); assertEquals(await f.lists.list(), [{ url: listUrl }]);
    f.responses.set(next, html()); await f.store.put(fakeApp(next));
    await f.lists.check(); assertEquals(await f.lists.list(), [{ url: listUrl }]);
    f.responses.set(next, moved(listUrl));
    await assertRejects(() => f.lists.fetch(next), Error, "循環");
    assert(await f.store.get(listUrl + "#memo"));
  } finally { await f.stop(); }
});

Deno.test("startSystem は保存済みアプリを一覧に含め、起動時の更新と実行中のインストールを反映する", async () => {
  const f = await fixture({}, true);
  const views: string[][] = [];
  try {
    await f.store.put({ ...fakeApp(), listVersion: "old" });
    await f.lists.add(listUrl);
    const system = await startSystem({ apps: [], store: f.store, browserBuild: f.options.browserBuild, providerLists: { fetch: f.options.fetch, parseHtml: f.options.parseHtml }, ui: { present() { return { remove() {} }; }, update(view) { views.push(view.apps.map(app => app.key)); }, report() {} } });
    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      await system.lists.list();
      assertEquals((await f.store.get(listUrl + "#memo"))?.listVersion, "list-version");
      assertEquals(views.at(-1)?.toSorted(), [listUrl + "#memo", listUrl + "#memo.widget"]);
      const next = "https://next.test/apps/"; f.responses.set(next, html());
      await system.lists.add(next); await system.lists.install(next, "memo");
      assert(views.at(-1)?.includes(next + "#memo.widget"));
    } finally { system.stop(); }
  } finally { await f.stop(); }
});

Deno.test("http のインストール・保存後の再読込・移転はデバッグ許可時に動く", async () => {
  const f = await fixture({}, true); const http = "http://localhost/apps/"; const next = "http://127.0.0.1/apps/";
  try {
    await f.store.system.putSettings({ allowHttpLists: true });
    f.responses.set(http, html()); f.responses.set(next, html());
    await f.lists.add(http); await f.lists.install(http, "memo");
    assertEquals((await createAppStore(f.tree).get(http + "#memo"))?.source, http);
    await f.store.data.write(http + "#memo", "値", "保存");
    f.responses.set(http, moved(next)); await f.lists.check();
    assertEquals(await f.store.get(http + "#memo"), undefined);
    assertEquals((await createAppStore(f.tree).get(next + "#memo"))?.source, next);
    assertEquals(await f.store.data.read(next + "#memo"), new Map([["値", "保存"]]));
    assertEquals(f.errors, []);
  } finally { await f.stop(); }
});

Deno.test("30 分の自動確認で版が変われば更新し、stop 後は確認しない", async () => {
  const original = globalThis.setInterval;
  let tick: (() => void) | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  globalThis.setInterval = ((callback: TimerHandler, delay?: number) => {
    assertEquals(delay, 30 * 60_000);
    tick = callback as () => void;
    return interval = original(() => {}, delay);
  }) as unknown as typeof setInterval;
  let f: Awaited<ReturnType<typeof fixture>>;
  try { f = await fixture({}, true); } finally { globalThis.setInterval = original; }
  try {
    await f.lists.add(listUrl); await f.lists.install(listUrl, "memo");
    f.responses.set(listUrl, html([entry("new-version")]));
    tick!(); await f.lists.list();
    assertEquals((await f.store.get(listUrl + "#memo"))?.listVersion, "new-version");
    f.lists.stop(); const requests = f.requests.length;
    tick!(); await Promise.resolve(); await Promise.resolve();
    assertEquals(f.requests.length, requests);
    assert(interval !== undefined);
  } finally { await f.stop(); }
});

Deno.test("起動時に提供リストを取得できなくても、保存済みアプリと OS の起動を続ける", async () => {
  const f = await fixture();
  try {
    await f.store.put(fakeApp()); await f.lists.add(listUrl); f.responses.delete(listUrl);
    const reports: unknown[] = []; let booting = true;
    const system = await startSystem({ apps: [], store: f.store, providerLists: { fetch: f.options.fetch, parseHtml: f.options.parseHtml }, ui: { present() { return { remove() {} }; }, update() {}, report(error) { reports.push({ error: String(error), booting }); } } });
    booting = false;
    try {
      assertEquals(reports, [{ error: "Error: ホームのシステムアプリがありません。", booting: true }]);
      await new Promise(resolve => setTimeout(resolve, 0));
      await system.lists.list();
      assertEquals(reports.length, 2);
      assertEquals(reports[1], { error: `Error: 提供リストのファイルを取得できません: ${listUrl} (404)`, booting: false });
      assertEquals((await f.store.list()).length, 1);
    } finally { system.stop(); }
  } finally { await f.stop(); }
});

Deno.test("稼働中のホームを移転する前に保存を終え、新 ID で再起動し、保存失敗時も役割を復帰する", async () => {
  const f = await fixture({}, true); const next = "https://next.test/apps/";
  try {
    const homeManifest = { ...manifest, roles: ["home"] };
    f.responses.set(sourceUrl + "app.json", JSON.stringify(homeManifest));
    f.responses.set(sourceUrl + "src/main.ts", `import { Api, App, DestroyReason, Last, StorageApi, launch } from "jsr:@binette/replique";
class Home extends App {
  storage: StorageApi | null = null;
  onCreate(last: Last, api: Api): void { this.storage = api.get<StorageApi>("storage"); }
  onDestroy(reason: DestroyReason): void { this.storage!.write("終了時", "保存済み"); }
}
launch(new Home());`);
    await f.lists.add(listUrl); await f.lists.install(listUrl, "memo");
    await f.store.system.putSettings({ roles: { home: listUrl + "#memo" } });
    const shown: string[] = []; const reports: unknown[] = []; let fail = false;
    const system = await startSystem({ apps: [], store: { ...f.store, put(app) { return fail ? Promise.reject(new Error("保存失敗")) : f.store.put(app); } },
      browserBuild: f.options.browserBuild, providerLists: { fetch: f.options.fetch, parseHtml: f.options.parseHtml },
      createWorker: () => new Worker(new URL("../src/worker-entry.ts", import.meta.url), { type: "module" }),
      ui: { present({ app }) { shown.push(app.key); return { remove() {} }; }, update() {}, report(error) { reports.push(error); } },
    });
    try {
      f.responses.set(listUrl, moved(next)); f.responses.set(next, html());
      await system.lists.check();
      assertEquals(await f.store.data.read(listUrl + "#memo"), new Map());
      assertEquals(await f.store.data.read(next + "#memo"), new Map([["終了時", "保存済み"]]));
      assertEquals(shown, [listUrl + "#memo", next + "#memo"]);
      assert((await f.store.system.listLaunches()).every(record => record.app === next + "#memo"));
      fail = true;
      await assertRejects(() => system.lists.install(next, "memo"), Error, "保存失敗");
      assertEquals(shown.at(-1), next + "#memo"); assertEquals(shown.length, 3);
      assertEquals(reports, []);
    } finally { system.stop(); }
  } finally { await f.stop(); }
});


Deno.test("取得と本文の停滞を中断し、signal を無視する fetch でも次のリストを確認できる", async () => {
  for (const bodyPending of [false, true]) {
    const next = "https://next.test/apps/";
    const signals: AbortSignal[] = [];
    const f = await fixture({ lists: [listUrl, next], fetchTimeout: 10, fetch: (input, init) => {
      if (String(input) === next) return Promise.resolve(new Response(html()));
      signals.push(init!.signal!);
      return bodyPending ? Promise.resolve({ ok: true, url: listUrl, arrayBuffer: () => new Promise<ArrayBuffer>(() => {}) } as Response) : new Promise<Response>(() => {});
    } });
    try {
      await f.lists.check();
      assertEquals(f.errors.length, 1);
      assert(String(f.errors[0]).includes("タイムアウト"));
      assert(signals[0].aborted);
      assertEquals((await f.lists.list()).length, 2);
      assertEquals((await f.lists.fetch(next)).apps[0].id, "memo");
    } finally { await f.stop(); }
  }
});

Deno.test("stop は signal を無視する取得を待たずに中断する", async () => {
  const started = Promise.withResolvers<void>();
  const f = await fixture({ lists: [listUrl], fetch: () => { started.resolve(); return new Promise<Response>(() => {}); } });
  try {
    const checking = f.lists.check();
    await started.promise;
    f.lists.stop();
    await checking;
    assertEquals(f.errors, []);
  } finally { await f.stop(); }
});

Deno.test("保存済みの boot 移転先でホームを開き、保留中の初回取得を待たず、後からの移転と更新で再起動する", async () => {
  const f = await fixture({}, true);
  const storedUrl = "https://stored.test/apps/";
  const next = "https://next.test/apps/";
  const homeManifest = { ...manifest, roles: ["home"] };
  const started = Promise.withResolvers<void>();
  const pending = Promise.withResolvers<Response>();
  try {
    f.responses.set(sourceUrl + "app.json", JSON.stringify(homeManifest));
    f.responses.set(sourceUrl + "src/main.ts", 'import { App, launch } from "jsr:@binette/replique"; launch(new App());');
    f.responses.set(storedUrl, html());
    await f.lists.add(storedUrl); await f.lists.install(storedUrl, "memo");
    await f.store.system.putLists([{ url: storedUrl, boot: listUrl }]);
    f.responses.set(next, html([entry("updated")]));
    const shown: { key: string; version: string | undefined }[] = [];
    const reports: unknown[] = [];
    let pendingFetch = true;
    const starting = startSystem({ apps: [], lists: [listUrl], roles: { home: listUrl + "#memo" }, store: f.store,
      browserBuild: f.options.browserBuild,
      providerLists: { parseHtml: f.options.parseHtml, fetch: (input, init) => {
        if (String(input) === storedUrl && pendingFetch) { pendingFetch = false; started.resolve(); return pending.promise; }
        return f.options.fetch!(input, init);
      } },
      createWorker: () => new Worker(new URL("../src/worker-entry.ts", import.meta.url), { type: "module" }),
      ui: { present({ app }) { shown.push({ key: app.key, version: app.listVersion }); return { remove() {} }; }, update() {}, report(error) { reports.push(error); } },
    });
    const system = await starting;
    try {
      assertEquals(shown, [{ key: storedUrl + "#memo", version: "list-version" }]);
      await started.promise;
      assertEquals(shown.length, 1);
      pending.resolve(new Response(moved(next)));
      await system.lists.list();
      assertEquals(shown, [
        { key: storedUrl + "#memo", version: "list-version" },
        { key: next + "#memo", version: "list-version" },
        { key: next + "#memo", version: "updated" },
      ]);
      assertEquals(await f.store.get(storedUrl + "#memo"), undefined);
      assertEquals((await f.store.get(next + "#memo"))?.listVersion, "updated");
      assertEquals(await system.lists.list(), [{ url: next, boot: listUrl }]);
      assertEquals(reports, []);
    } finally { system.stop(); }
  } finally { pending.resolve(new Response(html())); await f.stop(); }
});
