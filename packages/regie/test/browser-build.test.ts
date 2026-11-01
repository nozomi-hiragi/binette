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
  "src/main.ts": source, "src/value.ts": 'export const value: string = "Worker でビルド";',
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
    ["/system/libraries/replique.ts", await Deno.readFile(new URL("../../replique/src/index.ts", import.meta.url))],
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

Deno.test("検証した ESM を独立 Worker で読み、ソースを保存した場所へ成果物を残し AppStore から起動する", async () => {
  const { tree, distribution } = await fixture();
  const installed = await buildStoredApp(tree, distribution, manifest.id, "local", { workerUrl });
  const stored = await createAppStore(tree).get(installed.key);
  assert(stored);
  assertEquals(stored.manifest, manifest);
  assertEquals(stored.wasm, await tree.read("/apps/source-app/build/app.wasm"));
  assertEquals(decoder.decode(await tree.read("/apps/source-app/build/index.html")), sources["page.html"]);
  assertEquals(decoder.decode(await tree.read("/apps/source-app/src/main.ts")), source);
  const texts: string[] = [];
  const app = await launchApp(stored.wasm, { onDom(ops) { for (const op of ops) if (op.op === "text") texts.push(op.value); } });
  try { await app.call("hello"); assertEquals(texts, ["Worker でビルド"]); }
  finally { app.stop(); }
});

Deno.test("startSystem の read 経路も browserBuild の Worker でビルドして起動する", async () => {
  const { tree, distribution } = await fixture();
  const presented: string[] = [];
  const errors: unknown[] = [];
  const system = await startSystem({
    apps: [{ source: "local", read: path => Promise.resolve(sources[path]!) }],
    browserBuild: { distribution, workerUrl }, store: createAppStore(tree),
    ui: { update() {}, report(error) { errors.push(error); }, present({ app }) { presented.push(app.manifest.id); return { remove() {} }; } },
  });
  try { await system.open('["local","source-app"]'); assertEquals(presented, [manifest.id]); }
  finally { system.stop(); }
  assertEquals(errors.map(String), ["Error: ホームのシステムアプリがありません。"]);
});

Deno.test("asc と Réplique の欠損・改ざん・目録外は Worker の生成前に拒否する", async () => {
  for (const path of ["/system/tools/asc.js", "/system/libraries/replique.ts"]) {
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
      assertEquals(await tree.read("/apps/source-app/build/app.wasm"), undefined);
    }
  }
});

Deno.test("コンパイラの不正な ESM と AS エラーは保存せず次のビルドでやり直せる", async () => {
  const invalid = await fixture(encoder.encode("export const main = 1;"));
  await assertRejects(() => buildStoredApp(invalid.tree, invalid.distribution, manifest.id, "local", { workerUrl }), Error, "ESM が不正");
  const { tree, distribution } = await fixture();
  await tree.write("/apps/source-app/src/main.ts", encoder.encode('export const bad: i32 = "文字";'));
  await assertRejects(() => buildStoredApp(tree, distribution, manifest.id, "local", { workerUrl }), Error, "TS2322");
  assertEquals((await createAppStore(tree).list()).length, 0);
  assertEquals(await tree.read("/apps/source-app/build/app.wasm"), undefined);
  await tree.write("/apps/source-app/src/main.ts", encoder.encode(source));
  assert(WebAssembly.validate(new Uint8Array((await buildStoredApp(tree, distribution, manifest.id, "local", { workerUrl })).wasm)));
});

Deno.test("保存先と異なる ID やフォルダ外の入口は成果物を保存しない", async () => {
  for (const change of [{ id: "different" }, { entry: { as: "../outside.ts" } }]) {
    const { tree, distribution } = await fixture();
    await tree.write("/apps/source-app/app.json", encoder.encode(JSON.stringify({ ...manifest, ...change })));
    await assertRejects(() => buildStoredApp(tree, distribution, manifest.id, "local", { workerUrl }));
    assertEquals((await createAppStore(tree).list()).length, 0);
    assertEquals(await tree.read("/apps/source-app/build/app.wasm"), undefined);
  }
});

Deno.test("保存トランザクションの失敗では以前の成果物と記録を残す", async () => {
  const { tree, distribution } = await fixture();
  const before = await buildStoredApp(tree, distribution, manifest.id, "local", { workerUrl });
  const previous = await tree.read("/apps/source-app/build/app.wasm");
  const failing: FileTree = { ...tree, writeFiles() { return Promise.reject(new Error("保存失敗")); } };
  await tree.write("/apps/source-app/src/value.ts", encoder.encode('export const value: string = "変更";'));
  await assertRejects(() => buildStoredApp(failing, distribution, manifest.id, "local", { workerUrl }), Error, "保存失敗");
  assertEquals(await createAppStore(tree).get(before.key), before);
  assertEquals(await tree.read("/apps/source-app/build/app.wasm"), previous);
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
