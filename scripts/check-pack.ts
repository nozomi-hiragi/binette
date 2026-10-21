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
    for (const required of ["dist/index.js", "dist/index.d.ts", "README.md", "LICENSE", "package.json"]) {
      if (!files.includes(`package/${required}`)) throw new Error(`${name}: missing ${required}`);
    }
    for (const file of files) {
      if (/(^|\/)(src|demo|tests?)\//.test(file) || /\.(test|spec)\./.test(file)) throw new Error(`${name}: forbidden path ${file}`);
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
import { BINETTE_VERSION, BinetteError, parseBinette } from "@binette/core";
import { Scene, joueur } from "@binette/scene";
import { createCoulisses, createPanoplie } from "@binette/coulisses";
assert.equal(parseBinette(JSON.stringify({ binette: BINETTE_VERSION, redirect: "/home" })).redirect, "/home");
assert.throws(() => parseBinette("{"), BinetteError);
assert.equal(typeof Scene, "function");
assert.equal(typeof joueur, "function");
const coulisses = createCoulisses({ panoplie: createPanoplie({ index: { binette: BINETTE_VERSION, redirect: "/home" } }) });
const response = await coulisses.fetch(new Request("http://localhost/index.bina"));
assert.equal(response.status, 200);
assert.equal(parseBinette(await response.text()).redirect, "/home");
console.log("Plain Node consumer passed (3 packages)");
`);
  run(process.execPath, ["consumer.js"], consumer);
  writeFileSync(join(consumer, "consumer.ts"), `
import { BINETTE_VERSION, parseBinette, type Binette } from "@binette/core";
import { Scene, type SceneComponent, type SceneMount } from "@binette/scene";
import { createCoulisses, type Coulisses } from "@binette/coulisses";
const binette: Binette = parseBinette(JSON.stringify({ binette: BINETTE_VERSION, redirect: "/home" }));
const scene: Scene = new Scene({ serverURL: "https://example.com/" });
const component: SceneComponent = (element, sh) => { element.textContent = sh.version; };
const mount: SceneMount = async (element, sh) => { element.textContent = await (await sh.asset("main")).text(); return () => {}; };
const coulisses: Coulisses = createCoulisses();
void [binette, scene, component, mount, coulisses];
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
