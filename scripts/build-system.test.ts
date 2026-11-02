import { assert, assertEquals, assertRejects } from "@std/assert";
import { appNames, buildApps, buildFolder, type SystemManifest, systemManifest } from "./build-system.ts";
import { systemLabel } from "./system-metadata.ts";

const replique = new URL("../packages/replique/src/index.ts", import.meta.url).pathname;
async function app(root: string, name: string): Promise<void> {
  await Deno.mkdir(`${root}/${name}`, { recursive: true });
  await Deno.writeTextFile(`${root}/${name}/app.json`, JSON.stringify({ id: name, name, icon: "assets/picture.svg", entry: { html: "view.html", css: "assets/style.css", as: "main.ts" } }));
  await Deno.mkdir(`${root}/${name}/assets`);
  await Deno.writeTextFile(`${root}/${name}/assets/picture.svg`, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await Deno.writeTextFile(`${root}/${name}/assets/style.css`, "p { color: red }");
  await Deno.writeTextFile(`${root}/${name}/view.html`, "<p>例</p>");
  await Deno.writeTextFile(`${root}/${name}/main.ts`, 'import { App, launch } from "jsr:@binette/replique"; launch(new App());');
}
Deno.test("アプリをフォルダ名順で固定名のファイルへ書き出し、古い生成物を消す", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await app(dir, "a-b");
    await app(dir, "a");
    await Deno.mkdir(`${dir}/ignored`);
    await Deno.mkdir(`${dir}/out/removed`, { recursive: true });
    await Deno.writeTextFile(`${dir}/out/old.binapp`, "古い");
    assertEquals(await buildFolder(dir, `${dir}/out`, replique), ["a", "a-b"]);
    assertEquals(Array.from(Deno.readDirSync(`${dir}/out`), (entry) => entry.name).sort(), ["a", "a-b"]);
    for (const name of ["a", "a-b"]) {
      const output = `${dir}/out/${name}`;
      assertEquals(Array.from(Deno.readDirSync(output), (entry) => entry.name).sort(), ["app.json", "app.wasm", "icon.svg", "index.html", "style.css"]);
      const manifest = JSON.parse(await Deno.readTextFile(`${output}/app.json`));
      assertEquals(manifest.id, name);
      assertEquals(await Deno.readTextFile(`${output}/style.css`), "p { color: red }");
      assertEquals(manifest.icon, "icon.svg");
      assertEquals(await Deno.readTextFile(`${output}/index.html`), "<p>例</p>");
      assertEquals(await Deno.readTextFile(`${output}/icon.svg`), '<svg xmlns="http://www.w3.org/2000/svg"/>');
      assert(WebAssembly.validate(await Deno.readFile(`${output}/app.wasm`)));
    }
  } finally { await Deno.remove(dir, { recursive: true }); }
});
Deno.test("システムアプリの失敗はフォルダ名を示す", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await app(dir, "broken");
    await Deno.writeTextFile(`${dir}/broken/app.json`, "{");
    assertEquals(await appNames(dir), ["broken"]);
    await assertRejects(() => buildFolder(dir, `${dir}/out`, replique), Error, "システムアプリ「broken」");
    const result = await new Deno.Command(Deno.execPath(), { args: ["run", "-A", new URL("./build-system.ts", import.meta.url).pathname, "--invalid"] }).output();
    assertEquals(result.code, 1);
  } finally { await Deno.remove(dir, { recursive: true }); }
});
Deno.test("実際のシステムアプリは HTML なしで宣言 UI をビルドする", async () => {
  const dir = await Deno.makeTempDir();
  try {
    assertEquals(await buildFolder(new URL("../apps", import.meta.url).pathname, dir, replique), ["home", "settings", "shell"]);
    for (const name of ["home", "settings", "shell"]) {
      const manifest = JSON.parse(await Deno.readTextFile(`${dir}/${name}/app.json`));
      assertEquals(manifest.entry.html, undefined);
      assertEquals(await Deno.readTextFile(`${dir}/${name}/index.html`), "");
    }
  } finally { await Deno.remove(dir, { recursive: true }); }
});
Deno.test("目録は全ファイルのバイト数と SHA-256 を持ち、版は内容とパスだけで変わる", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/nested`);
    await Deno.writeTextFile(`${dir}/z`, "例");
    await Deno.writeFile(`${dir}/nested/a`, new Uint8Array([0, 255]));
    const manifest = await systemManifest(dir);
    assertEquals(manifest.files.map((file) => file.path), ["system/nested/a", "system/z"]);
    assertEquals(manifest.files.map((file) => file.size), [2, 3]);
    for (const file of manifest.files) {
      const bytes = await Deno.readFile(`${dir}/${file.path.slice(7)}`);
      const expected = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
      assertEquals(file.sha256, expected);
    }
    assert(/^[0-9a-f]{64}$/.test(manifest.version));
    await Deno.utime(`${dir}/z`, new Date(), new Date());
    assertEquals(await systemManifest(dir), manifest);
    await Deno.rename(`${dir}/z`, `${dir}/b`);
    const renamed = await systemManifest(dir);
    assert(renamed.version !== manifest.version);
    await Deno.writeTextFile(`${dir}/b`, "別");
    assert((await systemManifest(dir)).version !== renamed.version);
  } finally { await Deno.remove(dir, { recursive: true }); }
});
Deno.test("配布物は無視済みの場所にまとめ、既定の役割・同梱アプリ・古い生成物を扱う", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/packages/replique/src`, { recursive: true });
    await Deno.symlink(replique, `${dir}/packages/replique/src/index.ts`);
    await Deno.mkdir(`${dir}/packages/regie`);
    await Deno.writeTextFile(`${dir}/packages/regie/deno.json`, JSON.stringify({ version: "0.2.0" }));
    await Deno.mkdir(`${dir}/public`);
    await Deno.writeTextFile(`${dir}/public/sw.js`, 'const CACHE = "binette-v0.2.0-test";');
    await app(`${dir}/apps`, "home");
    await app(`${dir}/apps`, "settings");
    await app(`${dir}/apps`, "shell");
    await app(`${dir}/bundled`, "home");
    await Deno.mkdir(`${dir}/.binapp/bundled`, { recursive: true });
    await Deno.writeTextFile(`${dir}/.binapp/old.binapp`, "古い");
    await Deno.writeTextFile(`${dir}/.binapp/bundled/removed.binapp`, "古い");
    await Deno.writeTextFile(`${dir}/.binapp/keep.txt`, "残す");
    await buildApps(dir);
    const out = `${dir}/.binapp/public`;
    const first: SystemManifest = JSON.parse(await Deno.readTextFile(`${out}/manifest.json`));
    const contents = await systemManifest(`${out}/system`);
    assertEquals(first, { ...contents, kernel: "binette-v0.2.0-test", label: await systemLabel("0.2.0", contents.version, "binette-v0.2.0-test") });
    assertEquals(JSON.parse(await Deno.readTextFile(`${out}/system/boot.json`)), { roles: { home: "home", settings: "settings", shell: "shell" } });
    assertEquals(await Deno.readTextFile(`${out}/sw.js`), 'const CACHE = "binette-v0.2.0-test";');
    assertEquals(Array.from(Deno.readDirSync(`${dir}/public`), (entry) => entry.name), ["sw.js"]);
    assertEquals(Array.from(Deno.readDirSync(`${dir}/.binapp`), (entry) => entry.name).sort(), ["bundled", "keep.txt", "public"]);
    assertEquals(Array.from(Deno.readDirSync(`${dir}/.binapp/bundled`)), []);
    assert(first.files.some((file) => file.path === "system/apps/home/app.wasm"));
    assert(first.files.some((file) => file.path === "system/bundled/home/app.wasm"));
    assert(first.files.some((file) => file.path === "system/libraries/replique.ts"));
    assertEquals(await Deno.readTextFile(`${out}/system/libraries/replique.ts`), await Deno.readTextFile(replique));
    const compiler = first.files.find((file) => file.path === "system/tools/asc.js");
    assert(compiler);
    assertEquals(compiler.size, (await Deno.stat(`${out}/system/tools/asc.js`)).size);
    assert(compiler.size > 0);
    assertEquals(Array.from(Deno.readDirSync(`${out}/system/tools`), (entry) => entry.name), ["asc.js"]);
    // 配布した単一 ESM を Worker から読み、標準ライブラリと Binaryen の最適化まで使う。
    const workerUrl = URL.createObjectURL(new Blob([`
      import * as asc from ${JSON.stringify(new URL(`file://${out}/system/tools/asc.js`).href)};
      const files = {};
      const stderr = asc.createMemoryStream();
      const { error } = await asc.main(["main.ts", "--outFile", "main.wasm", "--optimize"], {
        stderr,
        readFile: (path) => path === "main.ts" ? "export function size(): i32 { return new Int32Array(3).length; }" : null,
        writeFile: (path, data) => { files[path] = data; },
        listFiles: () => [],
      });
      if (error) throw new Error(stderr.toString());
      const { instance } = await WebAssembly.instantiate(files["main.wasm"], { env: { abort() { throw new Error("abort"); } } });
      postMessage({ version: asc.version, size: instance.exports.size() });
    `], { type: "text/javascript" }));
    const worker = new Worker(workerUrl, { type: "module" });
    try {
      const result = await new Promise((resolve, reject) => {
        worker.onmessage = (event) => resolve(event.data);
        worker.onerror = (event) => { event.preventDefault(); reject(new Error(event.message)); };
      });
      assertEquals(result, { version: "0.28.20", size: 3 });
    } finally {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
    }
    await buildApps(dir);
    assertEquals(JSON.parse(await Deno.readTextFile(`${out}/manifest.json`)), first);
    await Deno.remove(`${dir}/bundled/home`, { recursive: true });
    await Deno.writeTextFile(`${out}/obsolete.txt`, "古い");
    await buildApps(dir);
    assertEquals(Array.from(Deno.readDirSync(`${out}/system/bundled`)), []);
    assertEquals(Array.from(Deno.readDirSync(out), (entry) => entry.name).sort(), ["manifest.json", "sw.js", "system"]);
    const latest = await Deno.readTextFile(`${out}/manifest.json`);
    assert(JSON.parse(latest).version !== first.version);
    await Deno.writeTextFile(`${dir}/apps/home/app.json`, "{");
    await assertRejects(() => buildApps(dir), Error, "システムアプリ「home」");
    assertEquals(await Deno.readTextFile(`${out}/manifest.json`), latest);
  } finally { await Deno.remove(dir, { recursive: true }); }
});
