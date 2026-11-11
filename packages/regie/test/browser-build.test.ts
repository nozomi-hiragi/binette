import { BinetteError } from "@binette/core";
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
