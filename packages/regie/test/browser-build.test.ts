import { BinetteError, type AppManifest } from "@binette/core";
import { repliqueFiles } from "./replique.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { buildAppInWorker, buildStoredApp, createAppStore, createMemoryFileTree, createSystemDistribution, launchApp, startSystem, SYSTEM_MANIFEST_PATH } from "../src/index.ts";
import type { FileTree, SystemManifest, RegieWorker } from "../src/index.ts";
import { buildCompiler } from "../../../scripts/build-system.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const workerUrl = new URL("./fixtures/browser-build-worker.ts", import.meta.url);
const manifest = { id: "source-app", name: "ソースのアプリ", version: "1", entry: { html: "page.html", as: "src/main.ts" } };
const source = `import { document } from "jsr:@binette/replique";
import { value } from "./value";
export function hello(): void { document.getElementById("value").textContent = value; }`;
const sources: Record<string, string> = {
  "app.json": JSON.stringify(manifest), "page.html": '<p id="value"></p>',
  "unused.txt": "also stored", "src/main.ts": source, "src/value.ts": 'export const value: string = "Worker でビルド";',
};
let bundled: Promise<Uint8Array> | undefined;

/** 配布物と同じブラウザ向け単一 ESM を、リポジトリへ書かずに用意する。 */
function compilerBytes(): Promise<Uint8Array> {
  return bundled ??= (async () => {
    const directory = await Deno.makeTempDir({ prefix: "binette-worker-test-" });
    try {
      const output = `${directory}/asc.js`;
      await buildCompiler(output);
      return await Deno.readFile(output);
    } finally { await Deno.remove(directory, { recursive: true }); }
  })();
}

async function fixture(compiler?: Uint8Array) {
  const tree = createMemoryFileTree();
  const files = new Map([
    ["/system/tools/asc.js", compiler ?? await compilerBytes()],
    ...await repliqueFiles(),
  ]);
  const filesManifest: SystemManifest = { version: "test", files: [] };
  for (const [path, data] of files) {
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data.slice()));
    filesManifest.files.push({ path: path.slice(1), size: data.length, sha256: [...hash].map(byte => byte.toString(16).padStart(2, "0")).join("") });
  }
  files.set(SYSTEM_MANIFEST_PATH, encoder.encode(JSON.stringify(filesManifest)));
  await tree.replaceSystem(files);
  await tree.writeFiles(new Map(Object.entries(sources).map(([path, value]) => [`/apps/source-app/${path}`, encoder.encode(value)])));
  const distribution = createSystemDistribution(tree, { manifestUrl: "https://binette.test/manifest.json", origin: "https://binette.test" });
  return { tree, files, distribution };
}

async function owned(tree: FileTree) {
  const owner = await tree.storage!.appOwner("https://example.test/local/#source-app", "https://example.test/local/");
  return tree.storage!.forOwner(owner);
}

Deno.test("検証した ESM を独立 Worker で読み、ソースを保存した場所へ成果物を残し AppStore から起動する", async () => {
  const { tree, distribution } = await fixture();
  tree.storage!.listApps = () => { throw new Error("単一アプリのビルドで名簿全体を列挙しました。"); };
  const installed = await buildStoredApp(tree, distribution, manifest.id, "https://example.test/local/", { workerUrl });
  const stored = await createAppStore(tree).get(installed.key);
  assert(stored);
  assertEquals(stored.manifest, manifest);
  assertEquals(stored.wasm, await (await owned(tree)).read("/build/app.wasm"));
  assertEquals(decoder.decode(await (await owned(tree)).read("/build/index.html")), sources["page.html"]);
  assertEquals(decoder.decode(await (await owned(tree)).read("/source/src/main.ts")), source);
  assertEquals(await tree.read("/apps/source-app/build/app.wasm"), undefined);
  assertEquals(decoder.decode(await (await owned(tree)).read("/source/unused.txt")), "also stored");
  const texts: string[] = [];
  const app = await launchApp(stored.wasm, { onDom(ops) { for (const op of ops) if (op.op === "text") texts.push(op.value); } });
  try { await app.call("hello"); assertEquals(texts, ["Worker でビルド"]); }
  finally { app.stop(); }
  await (await owned(tree)).write("/source/page.html", encoder.encode("<p>owner source</p>"));
  const rebuilt = await buildStoredApp(tree, distribution, manifest.id, "https://example.test/local/", { workerUrl });
  assertEquals(rebuilt.html, "<p>owner source</p>");
  assertEquals(decoder.decode(await (await owned(tree)).read("/build/index.html")), rebuilt.html);
});

Deno.test("startSystem の read 経路も browserBuild の Worker でビルドして起動する", async () => {
  const { tree, distribution } = await fixture();
  const presented: string[] = [];
  const errors: unknown[] = [];
  const system = await startSystem({
    apps: [{ source: "https://example.test/local/", read: path => Promise.resolve(sources[path]!) }],
    browserBuild: { distribution, workerUrl }, store: createAppStore(tree),
    ui: { update() {}, report(error) { errors.push(error); }, present({ app }) { presented.push(app.manifest.id); return { remove() {} }; } },
  });
  try { await system.open("https://example.test/local/#source-app"); assertEquals(presented, [manifest.id]); }
  finally { system.stop(); }
  assertEquals(errors.map(String), ["Error: ホームのシステムアプリがありません。"]);
});

Deno.test("asc と Réplique の欠損・改ざん・目録外は Worker の生成前に拒否する", async () => {
  for (const path of ["/system/tools/asc.js", "/system/libraries/replique/index.json", "/system/libraries/replique/index.ts", "/system/libraries/replique/ui.ts", "/system/libraries/replique/app.ts"]) {
    for (const alteration of ["missing", "hash", "size", "unlisted"]) {
      const { tree, files, distribution } = await fixture();
      if (alteration === "missing") files.delete(path);
      else if (alteration === "unlisted") {
        const inventory = JSON.parse(decoder.decode(files.get(SYSTEM_MANIFEST_PATH)));
        inventory.files = inventory.files.filter((file: { path: string }) => file.path !== path.slice(1));
        files.set(SYSTEM_MANIFEST_PATH, encoder.encode(JSON.stringify(inventory)));
      } else {
        const changed = files.get(path)!.slice();
        changed[0] ^= 1;
        files.set(path, alteration === "hash" ? changed : changed.slice(1));
      }
      await tree.replaceSystem(files);
      let created = false;
      await assertRejects(() => buildAppInWorker(path => Promise.resolve(sources[path]!), { distribution, createWorker() { created = true; throw new Error("実行してはいけない"); } }));
      assertEquals(created, false);
      assertEquals(await (await owned(tree)).read("/build/app.wasm"), undefined);
    }
  }
});

Deno.test("Invalid SDK feature inventories fail before creating a Worker", async () => {
  for (const inventory of [{}, [], ["app"], { app: "0.1.0" }, { app: "^0.1" }, { "../app": "0.1.0" }, { index: "0.1.0" }, { app: 1 }, null]) {
    let created = false;
    await assertRejects(() => buildAppInWorker(path => Promise.resolve(sources[path]!), {
      distribution: { readSystem: path => Promise.resolve(encoder.encode(path.endsWith("index.json") ? JSON.stringify(inventory) : "unused")) },
      createWorker() { created = true; throw new Error("Unexpected Worker creation"); },
    }), Error, "Invalid Réplique feature index");
    assertEquals(created, false);
  }
});

Deno.test("コンパイラの不正な ESM と AS エラーは保存せず次のビルドでやり直せる", async () => {
  const invalid = await fixture(encoder.encode("export const main = 1;"));
  await assertRejects(() => buildStoredApp(invalid.tree, invalid.distribution, manifest.id, "https://example.test/local/", { workerUrl }), Error, "ESM が不正");
  const { tree, distribution } = await fixture();
  await tree.write("/apps/source-app/src/main.ts", encoder.encode('export const bad: i32 = "文字";'));
  await assertRejects(() => buildStoredApp(tree, distribution, manifest.id, "https://example.test/local/", { workerUrl }), Error, "TS2322");
  assertEquals((await createAppStore(tree).list()).length, 0);
  assertEquals(await (await owned(tree)).read("/build/app.wasm"), undefined);
  await tree.write("/apps/source-app/src/main.ts", encoder.encode(source));
  assert(WebAssembly.validate(new Uint8Array((await buildStoredApp(tree, distribution, manifest.id, "https://example.test/local/", { workerUrl })).wasm)));
});

Deno.test("保存先と異なる ID やフォルダ外の入口は成果物を保存しない", async () => {
  for (const change of [{ id: "different" }, { entry: { as: "../outside.ts" } }]) {
    const { tree, distribution } = await fixture();
    await tree.write("/apps/source-app/app.json", encoder.encode(JSON.stringify({ ...manifest, ...change })));
    await assertRejects(() => buildStoredApp(tree, distribution, manifest.id, "https://example.test/local/", { workerUrl }));
    assertEquals((await createAppStore(tree).list()).length, 0);
    assertEquals(await (await owned(tree)).read("/build/app.wasm"), undefined);
  }
});

Deno.test("保存トランザクションの失敗では以前の成果物と記録を残す", async () => {
  const { tree, distribution } = await fixture();
  const before = await buildStoredApp(tree, distribution, manifest.id, "https://example.test/local/", { workerUrl });
  const previous = await (await owned(tree)).read("/build/app.wasm");
  const failing: FileTree = { ...tree, storage: {
    ...tree.storage!,
    forOwner(id) {
      return { ...tree.storage!.forOwner(id), writeFiles() { return Promise.reject(new Error("保存失敗")); } };
    },
  } };
  await (await owned(tree)).write("/source/src/value.ts", encoder.encode('export const value: string = "変更";'));
  await assertRejects(() => buildStoredApp(failing, distribution, manifest.id, "https://example.test/local/", { workerUrl }), Error, "保存失敗");
  assertEquals(await createAppStore(tree).get(before.key), before);
  assertEquals(await (await owned(tree)).read("/build/app.wasm"), previous);
});

Deno.test("時間切れ・中止・送信失敗・Worker 異常でも Worker を破棄する", async () => {
  const { distribution } = await fixture(encoder.encode("export const main = 1;"));
  for (const mode of ["timeout", "abort", "post", "error", "messageerror"]) {
    let terminated = 0;
    const controller = new AbortController();
    const listeners: Record<string, (event: never) => void> = {};
    const worker: RegieWorker = {
      addEventListener(type, listener) { listeners[type] = listener; },
      terminate() { terminated++; },
      postMessage() {
        if (mode === "post") throw new Error("送信失敗");
        if (mode === "abort") controller.abort();
        if (mode === "error" || mode === "messageerror") listeners[mode]!({ message: "Worker 異常" } as never);
      },
    };
    await assertRejects(() => buildAppInWorker(path => Promise.resolve(sources[path]!), {
      distribution, timeout: 10, signal: controller.signal, createWorker: () => worker,
    }));
    assertEquals(terminated, 1);
  }
});

Deno.test("保存したビルド結果はサブアプリの SVG も完全 ID の記録へ残す", async () => {
  const { tree, distribution } = await fixture();
  await tree.write("/apps/source-app/app.json", encoder.encode(JSON.stringify({ ...manifest, sub: { child: { name: "子", icon: "child.svg" } } })));
  await tree.write("/apps/source-app/child.svg", encoder.encode("<svg>子</svg>"));
  const installed = await buildStoredApp(tree, distribution, manifest.id, "https://example.test/local/", { workerUrl });
  assertEquals(installed.key, "https://example.test/local/#source-app");
  assertEquals((await createAppStore(tree).get(installed.key))!.subIcons, { child: "<svg>子</svg>" });
});

Deno.test("storage のない FileTree は従来の成果物と起動記録を一括保存する", async () => {
  const { tree, distribution } = await fixture();
  const legacy: FileTree = { ...tree, storage: undefined };
  const installed = await buildStoredApp(legacy, distribution, manifest.id, "https://example.test/local/", { workerUrl });
  assertEquals(await createAppStore(legacy).get(installed.key), installed);
  assertEquals(await legacy.read("/apps/source-app/build/app.wasm"), installed.wasm);
  assertEquals(decoder.decode(await legacy.read("/apps/source-app/build/index.html")), installed.html);
  const failing: FileTree = { ...legacy, writeFiles() { return Promise.reject(new Error("保存失敗")); } };
  await assertRejects(() => buildStoredApp(failing, distribution, manifest.id, "https://example.test/local/", { workerUrl }), Error, "保存失敗");
  assertEquals(await createAppStore(legacy).get(installed.key), installed);
  assertEquals(await legacy.read("/apps/source-app/build/app.wasm"), installed.wasm);
});

Deno.test("保存ソースの再ビルドも未対応 ABI を保存せず、対応 SDK で復旧できる", async () => {
  const { tree, distribution } = await fixture();
  const sourceUrl = "https://example.test/local/";
  const previous = await buildStoredApp(tree, distribution, manifest.id, sourceUrl, { workerUrl });
  const store = createAppStore(tree);
  await store.data.write(previous.key, "記録", "残す");
  const entry = await tree.storage!.findApp(previous.key);
  const owner = tree.storage!.forOwner(entry!.owner);
  const legacy = "binette";
  await owner.write("/source/src/main.ts", encoder.encode(`@external("${legacy}", "dom.text") declare function text(handle: i32, value: string): void; export function hello(): void { text(1, "古い"); }`));
  const error = await assertRejects(() => buildStoredApp(tree, distribution, manifest.id, sourceUrl, { workerUrl }), BinetteError);
  assertEquals(error.message, "この OS では動きません（binette）。アプリの管理から入れ直すと直ります");
  assertEquals(error.code, "unsupported_abi");
  assertEquals(await store.get(previous.key), previous);
  await owner.write("/source/src/main.ts", encoder.encode(source));
  const restored = await buildStoredApp(tree, distribution, manifest.id, sourceUrl, { workerUrl });
  assert(WebAssembly.Module.imports(await WebAssembly.compile(new Uint8Array(restored.wasm))).some(entry => entry.module === "binette:dom@0.1"));
  assertEquals((await store.data.read(previous.key)).get("記録"), "残す");
});

Deno.test("ブラウザ Worker でも exact・^・~ を解決し、unsupported_sdk を保存せず返す", async () => {
  const { tree, distribution } = await fixture();
  for (const range of ["0.1.0", "^0.1", "~0.1.0"]) {
    const code = `import { document } from "jsr:@binette/replique-dom@${range}"; export function hello(): void { document.getElementById("value").textContent = "版範囲"; }`;
    const built = await buildAppInWorker(path => Promise.resolve(path === "src/main.ts" ? code : sources[path]), { distribution, workerUrl });
    assert(WebAssembly.validate(new Uint8Array(built.wasm)));
  }
  for (const specifier of ["jsr:@binette/replique-ui@^0.2", "jsr:@binette/replique-unknown@^0.1", "jsr:@binette/replique-ui@*"]) {
    await tree.write("/apps/source-app/src/main.ts", encoder.encode(`export * from "${specifier}";`));
    const error = await assertRejects(() => buildStoredApp(tree, distribution, manifest.id, "https://example.test/local/", { workerUrl }), BinetteError);
    assertEquals(error.code, "unsupported_sdk");
    assertEquals((await createAppStore(tree).list()).length, 0);
    assertEquals(await (await owned(tree)).read("/build/app.wasm"), undefined);
  }
});

Deno.test("ブラウザの検証済み SDK でも版なし・旧指定子・版付きは同じ状態を共有する", async () => {
  const { distribution } = await fixture();
  const code = `import { App, launch, application } from "jsr:@binette/replique/app";
import { App as NewApp, application as newApplication } from "jsr:@binette/replique-app@^0.1";
import { App as Unversioned, application as current } from "jsr:@binette/replique-app";
launch(new App());
export function verify(): void { assert(idof<App>() == idof<NewApp>() && idof<App>() == idof<Unversioned>() && application !== null && application === newApplication && application === current); }`;
  const built = await buildAppInWorker(path => Promise.resolve(path === "src/main.ts" ? code : sources[path]), { distribution, workerUrl });
  const app = await launchApp(built.wasm);
  try { await app.call("verify"); } finally { app.stop(); }
});

const listSource = "https://example.test/local/";
const oldSource = '@external("binette", "dom.text") declare function text(handle: i32, value: string): void; export function hello(): void { text(1, "古い"); }';
let oldWasm: Promise<Uint8Array> | undefined;
async function oldInstalled(extra: Partial<AppManifest> = {}) {
  const f = await fixture();
  const store = createAppStore(f.tree);
  const appManifest = { ...manifest, ...extra };
  oldWasm ??= buildAppInWorker(path => Promise.resolve(path === "src/main.ts" ? oldSource : sources[path]), { distribution: f.distribution, workerUrl }).then(built => built.wasm);
  const app = { key: `${listSource}#source-app`, source: listSource, manifest: appManifest, html: sources["page.html"], wasm: await oldWasm, icon: undefined, installedAt: 123, listVersion: "original" };
  const files = new Map(Object.entries({ ...sources, "app.json": JSON.stringify(appManifest) }).map(([path, text]) => [path, encoder.encode(text)]));
  await store.put(app, files);
  const owner = await owned(f.tree);
  return { ...f, store, app, owner, files };
}

Deno.test("起動時の旧 ABI を保存ソースから復旧し、データ・権限・役割・版・日時を保つ", async () => {
  const f = await oldInstalled({ roles: ["files"], permissions: { schedule: { reason: "予定" } } });
  const { computeIntegrity } = await import("@binette/core");
  const sourceIntegrity = { "/": await computeIntegrity([...f.files].map(([path, bytes]) => ({ path, bytes })), "/") };
  await f.store.put({ ...f.app, sourceIntegrity });
  await f.store.data.write(f.app.key, "記録", "残す");
  await f.store.system.putPermissions(f.app.key, ["schedule"]);
  await f.store.system.putSettings({ roles: { files: f.app.key } });
  const presented: string[] = [], errors: unknown[] = [];
  const system = await startSystem({ apps: [], store: f.store, browserBuild: { distribution: f.distribution, workerUrl },
    ui: { update() {}, report(error) { errors.push(error); }, present({ app }) { presented.push(app.key); return { remove() {} }; } },
  });
  try {
    await system.open(f.app.key);
    assertEquals(presented, [f.app.key]);
    const rebuilt = (await f.store.get(f.app.key))!;
    assert(rebuilt.wasm.toString() !== f.app.wasm.toString());
    assertEquals(rebuilt.manifest, f.app.manifest);
    assertEquals(rebuilt.installedAt, 123);
    assertEquals(rebuilt.listVersion, "original");
    assertEquals(rebuilt.sourceIntegrity, sourceIntegrity);
    assertEquals(await f.store.data.read(f.app.key), new Map([["記録", "残す"]]));
    assertEquals(await f.store.system.getPermissions(f.app.key), ["schedule"]);
    assertEquals((await f.store.system.getSettings())!.roles, { files: f.app.key });
    assertEquals(await f.owner.readFiles([...f.files.keys()].map(path => `/source/${path}`)), [...f.files.values()]);
    assertEquals(errors.map(String), ["Error: ホームのシステムアプリがありません。"]);
  } finally { system.stop(); }
});

for (const mode of ["no-source", "no-compiler", "unsupported-sdk", "unsupported-abi", "build-error", "save-error", "manifest-change", "tamper-root", "tamper-file", "missing-file", "invalid-wasm", "stop"]) {
  Deno.test(`自動復旧の ${mode} は元の保存記録を壊さず起動エラーを保つ`, async () => {
    const f = await oldInstalled();
    if (mode === "no-source") await f.owner.writeFiles(new Map(), await f.owner.list("/source"));
    if (mode === "unsupported-sdk") await f.owner.write("/source/src/main.ts", encoder.encode('export * from "jsr:@binette/replique-dom@^9.0";'));
    if (mode === "unsupported-abi") await f.owner.write("/source/src/main.ts", encoder.encode(oldSource));
    if (mode === "build-error") await f.owner.write("/source/src/main.ts", encoder.encode('export const bad: i32 = "文字";'));
    if (mode === "manifest-change") await f.owner.write("/source/app.json", encoder.encode(JSON.stringify({ ...manifest, permissions: { schedule: "変更" } })));
    if (["tamper-root", "tamper-file", "missing-file"].includes(mode)) {
      const { computeIntegrity } = await import("@binette/core");
      const key = mode === "tamper-root" ? "/" : "src/main.ts";
      await f.store.put({ ...f.app, sourceIntegrity: { [key]: await computeIntegrity([...f.files].map(([path, bytes]) => ({ path, bytes })), key) } });
      if (mode === "missing-file") await f.owner.delete("/source/src/main.ts");
      else await f.owner.write("/source/src/main.ts", encoder.encode(source + "\n"));
    }
    if (mode === "invalid-wasm") await f.store.put({ ...f.app, wasm: new Uint8Array([0]) });
    const previous = await f.store.get(f.app.key);
    const savedRecord = await f.owner.readFiles(["/build/record.json", "/build/app.wasm", "/build/index.html"]);
    let builds = 0;
    const distribution = { async readSystem(path: string) { builds += Number(path === "/system/tools/asc.js"); if (mode === "stop") system.stop(); return await f.distribution.readSystem(path); } };
    const store = mode === "save-error" ? { ...f.store, replace() { return Promise.reject(new Error("保存失敗")); } } : f.store;
    const errors: unknown[] = [], presented: string[] = [];
    const rebuilding: boolean[] = [];
    const system = await startSystem({ apps: [], store, ...(mode === "no-compiler" ? {} : { browserBuild: { distribution, workerUrl } }),
      ui: { update(view) { rebuilding.push(view.rebuilding ?? false); }, report(error) { errors.push(error); }, present({ app }) { presented.push(app.key); return { remove() {} }; } },
    });
    try {
      await system.open(f.app.key);
      assertEquals(presented, []);
      assertEquals(rebuilding.at(-1), false);
      assertEquals(await f.store.get(f.app.key), previous);
      assertEquals(await f.owner.readFiles(["/build/record.json", "/build/app.wasm", "/build/index.html"]), savedRecord);
      if (["no-source", "no-compiler", "tamper-root", "tamper-file", "missing-file", "invalid-wasm"].includes(mode)) assertEquals(builds, 0);
      else assertEquals(builds, 1);
      if (mode !== "stop") {
        assertEquals(errors.length, 2);
        if (mode !== "invalid-wasm") {
          assert(errors[1] instanceof BinetteError);
          assertEquals(errors[1].code, "unsupported_abi");
          assertEquals(errors[1].message, "この OS では動きません（binette）。アプリの管理から入れ直すと直ります");
        }
      }
    } finally { system.stop(); }
  });
}

Deno.test("同時に親・サブ・同じアプリを開いてもビルドを共有し、Scene の進捗を表示して消す", async () => {
  const f = await oldInstalled({ sub: { child: { name: "子" } } });
  const { Window } = await import("happy-dom");
  const { createShellUi } = await import("../../scene/src/index.ts");
  const window = new Window();
  const element = window.document.createElement("main") as unknown as HTMLElement;
  window.document.body.append(element as never);
  const ui = createShellUi(element, { installed: true });
  let builds = 0, release = () => {}, begun = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { begun = resolve; });
  const distribution = { async readSystem(path: string) {
    if (path === "/system/tools/asc.js") { builds++; begun(); await gate; }
    return await f.distribution.readSystem(path);
  } };
  const system = await startSystem({ apps: [], store: f.store, ui, browserBuild: { distribution, workerUrl } });
  ui.bind(system);
  try {
    const parent = system.open(f.app.key);
    await started;
    const duplicate = system.open(f.app.key);
    const child = system.open(f.app.key + ".child");
    const progress = element.querySelector<HTMLElement>(".bina-shell-progress")!;
    assertEquals(progress.textContent, "今の OS 向けに作り直しています");
    assertEquals(progress.hidden, false);
    assertEquals(progress.getAttribute("role"), "status");
    release();
    await Promise.all([parent, child, duplicate]);
    assertEquals(builds, 1);
    assertEquals(progress.hidden, true);
    assert(element.querySelector("#value"));
    await system.open(f.app.key);
    assertEquals(builds, 1);
  } finally { release(); system.stop(); ui.stop(); await window.happyDOM.close(); }
});

Deno.test("対応済み ABI では保存ソースを再ビルドしない", async () => {
  const f = await oldInstalled();
  const good = await buildStoredApp(f.tree, f.distribution, manifest.id, listSource, { workerUrl });
  let builds = 0;
  const shown: string[] = [];
  const system = await startSystem({ apps: [], store: f.store,
    browserBuild: { distribution: { readSystem() { builds++; throw new Error("不要なビルド"); } }, workerUrl },
    ui: { update() {}, report() {}, present({ app }) { shown.push(app.key); return { remove() {} }; } },
  });
  try { await system.open(good.key); assertEquals(shown, [good.key]); assertEquals(builds, 0); }
  finally { system.stop(); }
});

Deno.test("Cadre に割り当てた旧 ABI の保存アプリも起動前に復旧する", async () => {
  const f = await oldInstalled({ roles: ["cadre"] });
  await f.store.system.putSettings({ roles: { cadre: f.app.key } });
  const presented: string[] = [];
  const system = await startSystem({ apps: [], store: f.store, browserBuild: { distribution: f.distribution, workerUrl },
    ui: { update() {}, report() {}, present({ app, cadre }) { if (cadre) presented.push(app.key); return { remove() {} }; } },
  });
  try {
    assertEquals(presented, [f.app.key]);
    assertEquals((await f.store.system.getSettings())!.roles, { cadre: f.app.key });
    assert((await f.store.get(f.app.key))!.wasm.toString() !== f.app.wasm.toString());
  } finally { system.stop(); }
});

Deno.test("画面なしの予定起動でも旧 ABI を復旧し、履歴に数えずデータへ書ける", async () => {
  const f = await oldInstalled({ permissions: { schedule: { reason: "予定" } } });
  await f.owner.write("/source/src/main.ts", encoder.encode(`import { App, Api, StorageApi, launch } from "jsr:@binette/replique";
class Scheduled extends App {
  onSchedule(slot: i32, api: Api): void { StorageApi.from(api)!.write("ran", slot.toString()); }
}
launch(new Scheduled());`));
  await f.store.system.putSchedules!({ [`${f.app.key}/0`]: { owner: f.app.key, rule: { every: 900 }, enabled: true, registered: Date.now() } });
  let shown = 0;
  const system = await startSystem({ apps: [], store: f.store, browserBuild: { distribution: f.distribution, workerUrl },
    ui: { update() {}, report() {}, present() { shown++; return { remove() {} }; } },
  });
  try {
    await system.scheduler.runNow(`${f.app.key}/0`);
    const deadline = performance.now() + 5000;
    while ((await f.store.data.read(f.app.key)).get("ran") === undefined && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assertEquals((await f.store.data.read(f.app.key)).get("ran"), "0");
    assertEquals(await f.store.system.listLaunches(), []);
    assertEquals(shown, 0);
  } finally { system.stop(); }
});

Deno.test("自動復旧の成功を開いているアプリ管理にも届け、古い ABI の警告を消す", async () => {
  const f = await oldInstalled();
  const manager = await buildAppInWorker(path => Promise.resolve(path === "app.json"
    ? JSON.stringify({ ...manifest, id: "recovery-manager", roles: ["apps-manager"] }) : sources[path]), { distribution: f.distribution, workerUrl });
  const snapshots: string[] = [];
  const system = await startSystem({ apps: [{ source: "binette:system", prebuilt: manager }], store: f.store,
    browserBuild: { distribution: f.distribution, workerUrl },
    ui: { update() {}, report() {}, present({ app }, process) {
      if (app.key === "recovery-manager") process.syncManager = snapshot => {
        snapshots.push(snapshot.apps.find(app => app.key === f.app.key)?.installedError ?? "");
      };
      return { remove() {} };
    } },
  });
  const waitFor = async (condition: () => boolean) => {
    const deadline = performance.now() + 5000;
    while (!condition() && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert(condition());
  };
  try {
    await system.open("recovery-manager");
    await waitFor(() => snapshots.length > 0);
    assertEquals(snapshots.at(-1), "この OS では動きません。入れ直してください");
    await system.open(f.app.key);
    await waitFor(() => snapshots.at(-1) === "");
  } finally { system.stop(); }
});

for (const action of ["body-delete", "data-delete", "update", "reinstall"]) {
  Deno.test(`再ビルド待機中の手動 ${action} を遅い成果物で上書き・復活させない`, async () => {
    const f = await oldInstalled();
    const { Window } = await import("happy-dom");
    const window = new Window();
    const sourceUrl = "https://example.test/manual-source/";
    const manualSources = { ...sources, "app.json": JSON.stringify({ ...manifest, version: "manual" }), "page.html": "<p>手動の更新</p>" };
    const list = `<script type="application/json" id="binette-apps">${JSON.stringify({ name: "提供者", apps: [{ id: manifest.id, source: sourceUrl, version: "manual" }] })}</script>`;
    let release = () => {}, entered = () => {}, first = true;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const pending = new Promise<void>(resolve => { entered = resolve; });
    const distribution = { async readSystem(path: string) {
      if (first && path === "/system/tools/asc.js") { first = false; entered(); await gate; }
      return await f.distribution.readSystem(path);
    } };
    const shown: string[] = [];
    await f.store.data.write(f.app.key, "note", "保持");
    const system = await startSystem({ apps: [], lists: [listSource], store: f.store, browserBuild: { distribution, workerUrl },
      providerLists: {
        fetch(input) {
          const url = String(input);
          const value = url === listSource ? list : manualSources[url.slice(sourceUrl.length) as keyof typeof manualSources];
          return Promise.resolve(new Response(value ?? "無し", { status: value === undefined ? 404 : 200 }));
        },
        parseHtml: html => new window.DOMParser().parseFromString(html, "text/html") as unknown as Document,
      },
      ui: { update() {}, report() {}, present({ app }) { shown.push(app.html); return { remove() {} }; } },
    });
    try {
      const opening = system.open(f.app.key);
      await pending;
      if (action === "body-delete" || action === "data-delete" || action === "reinstall") await system.lists.uninstall(f.app.key, action === "data-delete");
      if (action === "update" || action === "reinstall") await system.lists.install(listSource, manifest.id);
      const winner = await f.store.get(f.app.key);
      const owner = await f.tree.storage!.findApp(f.app.key);
      const saved = owner && await f.tree.storage!.forOwner(owner.owner).readFiles(["/build/record.json", "/build/app.wasm"]);
      release();
      await opening;
      assertEquals(await f.store.get(f.app.key), winner);
      assertEquals(owner && await f.tree.storage!.forOwner(owner.owner).readFiles(["/build/record.json", "/build/app.wasm"]), saved);
      assertEquals(shown, []);
      if (action === "update" || action === "reinstall") {
        assertEquals(winner!.manifest.version, "manual");
        await system.open(f.app.key);
        assertEquals(shown, ["<p>手動の更新</p>"]);
      } else assertEquals(winner, undefined);
      if (action !== "data-delete") assertEquals((await f.store.data.read(f.app.key)).get("note"), "保持");
      else assertEquals(await f.tree.storage!.findApp(f.app.key), undefined);
    } finally { release(); system.stop(); await window.happyDOM.close(); }
  });
}

Deno.test("条件付き置換のない独自 AppStore では保存ソースがあっても自動復旧を保存しない", async () => {
  const f = await oldInstalled();
  let builds = 0, shown = 0;
  const errors: unknown[] = [];
  const system = await startSystem({ apps: [], store: { ...f.store, replace: undefined },
    browserBuild: { distribution: { readSystem() { builds++; throw new Error("条件付き保存がありません"); } }, workerUrl },
    ui: { update() {}, report(error) { errors.push(error); }, present() { shown++; return { remove() {} }; } },
  });
  try {
    await system.open(f.app.key);
    assertEquals(builds, 0);
    assertEquals(shown, 0);
    assertEquals(await f.store.get(f.app.key), f.app);
    assert(errors.at(-1) instanceof BinetteError);
    assertEquals((errors.at(-1) as BinetteError).code, "unsupported_abi");
  } finally { system.stop(); }
});
