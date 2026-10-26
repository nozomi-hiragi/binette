// npm の配布物を作り、ワークスペースを使わない別の利用者として入れて試す。
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLISHED } from "./check-version.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function run(file: string, args: string[], cwd: string, env = process.env): void {
  execFileSync(file, args, { cwd, env, stdio: "inherit" });
}
function output(file: string, args: string[], cwd: string): string {
  return execFileSync(file, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

const temp = mkdtempSync(join(tmpdir(), "binette-check-pack-"));
try {
  run("npm", ["run", "build"], ROOT);
  const dependencies: Record<string, string> = {};
  for (const [dir, name] of Object.entries(PUBLISHED)) {
    const packed = JSON.parse(output("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", temp], join(ROOT, dir))) as { filename: string }[];
    if (packed.length !== 1 || !packed[0]?.filename) throw new Error(`${name}: expected one tarball`);
    const tarball = resolve(temp, packed[0].filename);
    const files = output("tar", ["-tzf", tarball], temp).trim().split("\n");
    // replique は AS のソースをそのまま配るので、dist が無く src がある
    const source = name === "@binette/replique";
    for (const required of [...source ? ["src/index.ts"] : ["dist/index.js", "dist/index.d.ts"], "README.md", "LICENSE", "package.json"]) {
      if (!files.includes(`package/${required}`)) throw new Error(`${name}: missing ${required}`);
    }
    for (const file of files) {
      if ((!source && /(^|\/)src\//.test(file)) || /(^|\/)(demo|tests?)\//.test(file) || /\.(test|spec)\./.test(file)) throw new Error(`${name}: forbidden path ${file}`);
    }
    console.log(`${name}: tarball verified (${files.length} files)`);
    dependencies[name] = `file:${tarball}`;
  }

  const consumer = join(temp, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module", dependencies }));
  const consumerEnv = { ...process.env };
  // npm のライフサイクルが渡す allow-scripts の設定だけを外す。--ignore-scripts でスクリプトは動かさない
  for (const key of Object.keys(consumerEnv)) {
    if (/^npm_config_allow[_-]scripts$/i.test(key)) delete consumerEnv[key];
  }
  run("npm", ["install", "--ignore-scripts", "--no-package-lock", "--no-audit", "--no-fund"], consumer, consumerEnv);
  // Node 22 で TypeScript の型除去に頼らないよう、実行の確認は JavaScript で書く
  writeFileSync(join(consumer, "consumer.js"), `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BINETTE_VERSION, BinetteError, parseAppManifest, parseBinette } from "@binette/core";
import { launchApp, serveApp } from "@binette/regie";
import { buildApp } from "@binette/scene";
import { createCoulisses, createPanoplie } from "@binette/coulisses";
assert.equal(parseBinette(JSON.stringify({ binette: BINETTE_VERSION, redirect: "/home" })).redirect, "/home");
assert.throws(() => parseBinette("{"), BinetteError);
assert.throws(() => parseAppManifest("{"), BinetteError);

// 入れた tarball だけで、AS をビルドして Worker 相当（MessageChannel）で動かす
const files = {
  "app.json": JSON.stringify({ id: "example.counter", name: "カウンター", entry: { html: "src/index.html", as: "src/main.ts" } }),
  "src/index.html": '<p data-text="count">0</p>',
  "src/main.ts": 'import { ui } from "jsr:@binette/replique";\\nexport function start(): void { ui.text("count", "0"); }\\n',
};
const replique = readFileSync(new URL(import.meta.resolve("@binette/replique")), "utf8");
const built = await buildApp(async (path) => files[path], { libraries: { "jsr:@binette/replique": replique } });
assert.equal(built.manifest.id, "example.counter");
const { port1, port2 } = new MessageChannel();
serveApp(port1);
const texts = [];
const app = await launchApp(built.wasm, {
  onText: (name, value) => texts.push([name, value]),
  createWorker: () => ({
    postMessage: (message, transfer) => port2.postMessage(message, transfer),
    addEventListener: (type, listener) => port2.addEventListener(type, listener),
    terminate: () => { port1.close(); port2.close(); },
  }),
});
assert.deepEqual(app.exports, ["start"]);
await app.call("start");
assert.deepEqual(texts, [["count", "0"]]);
app.stop();

const coulisses = createCoulisses({ panoplie: createPanoplie({ index: { binette: BINETTE_VERSION, redirect: "/home" } }) });
const response = await coulisses.fetch(new Request("http://localhost/index.bina"));
assert.equal(response.status, 200);
assert.equal(parseBinette(await response.text()).redirect, "/home");
console.log("Plain Node consumer passed (core, regie, scene, coulisses, replique)");
`);
  run(process.execPath, ["consumer.js"], consumer);
  writeFileSync(join(consumer, "consumer.ts"), `
import { BINETTE_VERSION, parseAppManifest, parseBinette, type AppManifest, type Binette } from "@binette/core";
import { launchApp, serveApp, type LaunchOptions, type RegieApp } from "@binette/regie";
import { buildApp, mountApp, type BuiltApp, type MountedApp } from "@binette/scene";
import { createCoulisses, type Coulisses } from "@binette/coulisses";
const binette: Binette = parseBinette(JSON.stringify({ binette: BINETTE_VERSION, redirect: "/home" }));
const manifest: AppManifest = parseAppManifest("{}");
const options: LaunchOptions = { onText: (name: string, value: string) => void [name, value] };
const launch: (wasm: Uint8Array) => Promise<RegieApp> = (wasm) => launchApp(wasm, options);
const build: (read: (path: string) => Promise<string>) => Promise<BuiltApp> = (read) => buildApp(read);
const mount: (element: HTMLElement, built: BuiltApp) => Promise<MountedApp> = mountApp;
const coulisses: Coulisses = createCoulisses();
void [binette, manifest, launch, build, mount, serveApp, coulisses];
`);
  writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, lib: ["ES2022", "DOM"],
    noEmit: true, skipLibCheck: false, types: [], noUncheckedSideEffectImports: true,
  }, include: ["consumer.ts"] }));
  // 別の版を取りに行かず、ロックしたコンパイラを使う
  run(process.execPath, [join(ROOT, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"], consumer);
  console.log("Strict TypeScript consumer passed (declarations checked)");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
