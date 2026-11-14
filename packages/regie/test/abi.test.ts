import { BinetteError } from "@binette/core";
import { assert, assertEquals, assertRejects } from "@std/assert";
import asc from "assemblyscript/asc";
import { appCompatibility, appRequirements, HOST_ABI, validateAppAbi, validateAppRequirements } from "../src/abi.ts";
import { launchApp, serveApp, type RegieWorker } from "../src/index.ts";

async function compile(source: string): Promise<Uint8Array> {
  let wasm: Uint8Array | undefined;
  const result = await asc.main(["main.ts", "--outFile", "app.wasm", "--exportStart", "_start"], {
    readFile: path => path === "main.ts" ? source : null,
    writeFile: (path, value) => { if (path === "app.wasm") wasm = value as Uint8Array; },
  });
  assert(!result.error, result.stderr.toString());
  assert(wasm);
  return wasm;
}

function createWorker(): RegieWorker {
  const { port1, port2 } = new MessageChannel();
  port1.start(); port2.start();
  serveApp(port1 as never);
  return {
    postMessage: (message, transfer) => port2.postMessage(message, transfer as never),
    addEventListener: (type, listener) => port2.addEventListener(type, listener as never),
    terminate: () => { port1.close(); port2.close(); },
  };
}

Deno.test("各機能の版・全 external・OS の提供一覧が一致し、全関数を Worker にリンクできる", async () => {
  const directory = new URL("../../replique/", import.meta.url);
  const imports: { module: string; name: string; kind: string }[] = [];
  const wrappers: string[] = [];
  const found: string[] = [];
  for await (const file of Deno.readDir(directory)) {
    if (!file.isDirectory || ["src", "scripts", "test"].includes(file.name)) continue;
    const source = await Deno.readTextFile(new URL(`${file.name}/src/index.ts`, directory));
    const config = JSON.parse(await Deno.readTextFile(new URL(`${file.name}/deno.json`, directory)));
    const declarations = [...source.matchAll(/@external\("([^"]+)", "([^"]+)"\)\s+(?:export )?declare function \w+\(([^)]*)\): ([^;]+);/g)];
    assertEquals(declarations.length, [...source.matchAll(/@external\(/g)].length, file.name);
    const feature = file.name;
    assertEquals(config.name, `@binette/replique-${feature}`);
    assertEquals(config.exports, "./src/index.ts");
    const [major, minor] = config.version.split(".");
    found.push(feature);
    const versions = [...source.matchAll(/^export const ABI_VERSION = "([^"]+)";/gm)];
    assertEquals(versions.length, 1, file.name);
    assert(/^0\.\d+$|^[1-9]\d*$/.test(versions[0][1]), file.name);
    assertEquals(versions[0][1], major === "0" ? `${major}.${minor}` : major, feature);
    if (feature === "fs") {
      assertEquals(declarations.length, 0);
      assertEquals(Object.hasOwn(HOST_ABI, feature), false);
      continue;
    }
    const abi = HOST_ABI[feature as keyof typeof HOST_ABI];
    assert(abi, feature);
    assertEquals(abi.module, `binette:${feature}@${versions[0][1]}`);
    const appSource = feature === "net" ? await Deno.readTextFile(new URL("app/src/index.ts", directory)) : "";
    const appNetDeclarations = [...appSource.matchAll(/@external\("binette:net@0.1", "([^"]+)"\)\s+(?:export )?declare function \w+\(([^)]*)\): ([^;]+);/g)];
    assertEquals([...declarations.filter(match => match[1] === abi.module).map(match => match[2]), ...appNetDeclarations.map(match => match[1])].sort(), [...abi.functions].sort(), feature);
    for (const [, module, name, params, result] of declarations) {
      assert(module === abi.module || (feature === "app" && module === HOST_ABI.net.module), `${feature}/${name}`);
      const id = wrappers.length;
      const type = result.replace(/DestroyKind|DestroyCause/g, "i32");
      const args = params ? params.split(",").map(param => param.split(":")[0].trim()).join(", ") : "";
      wrappers.push(`@external("${module}", "${name}") declare function host${id}(${params}): ${type};\nexport function call${id}(${params}): ${type} { ${type === "void" ? "" : "return "}host${id}(${args}); }`);
      imports.push({ module, name, kind: "function" });
    }
  }
  assertEquals(found.sort(), [...Object.keys(HOST_ABI).filter(feature => feature !== "env"), "fs"].sort());
  const wasm = await compile(wrappers.join("\n"));
  const module = await validateAppAbi(wasm);
  const order = (entry: { module: string; name: string }) => `${entry.module}/${entry.name}`;
  assertEquals(WebAssembly.Module.imports(module).filter(entry => entry.module !== "env").sort((a, b) => order(a).localeCompare(order(b))), imports.sort((a, b) => order(a).localeCompare(order(b))));
  const app = await launchApp(wasm, { createWorker });
  app.stop();
});

for (const [module, label] of [
  ["binette", "binette"], ["binette:storage@0.9", "storage 0.9"], ["binette:ui@0.2", "ui 0.2"],
  ["binette:unknown@0.1", "unknown 0.1"], ["binette:storage@2", "storage 2"], ["other", "other"],
  ["binette:storage@1.2", "binette:storage@1.2"], ["binette:@0.9", "binette:@0.9"],
  ["binette:storage@0.9suffix", "binette:storage@0.9suffix"],
  ["binette:storage@0.9\n", "binette:storage@0.9\n"],
]) {
  Deno.test(`未対応 module ${module} は初期化前に日本語で拒む`, async () => {
    const wasm = await compile(`@external(${JSON.stringify(module)}, "text") declare function unknown(): void;\n@external("binette:dom@0.1", "text") declare function text(handle: i32, value: string): void;\ntext(1, "実行しない");\nexport function call(): void { unknown(); }`);
    const ops: unknown[] = [];
    const validation = await assertRejects(() => validateAppAbi(wasm), BinetteError);
    assertEquals(validation.code, "unsupported_abi");
    assertEquals(validation.message, `この OS では動きません（${label}）。アプリの管理から入れ直すと直ります`);
    const error = await assertRejects(() => launchApp(wasm, { createWorker, onDom: values => ops.push(values) }), BinetteError);
    assertEquals(error.message, `この OS では動きません（${label}）。アプリの管理から入れ直すと直ります`);
    assertEquals(error.code, "unsupported_abi");
    assertEquals(ops, []);
  });
}

Deno.test("env.abort と対応する版は受け入れ、未提供の関数名は拒む", async () => {
  const wasm = await compile('export function call(): void { throw new Error("中断"); }');
  const module = await validateAppAbi(wasm);
  assert(WebAssembly.Module.imports(module).some(entry => entry.module === "env" && entry.name === "abort"));
  const bad = await compile('@external("binette:storage@0.1", "read2") declare function unknown(): void; export function call(): void { unknown(); }');
  const error = await assertRejects(() => validateAppAbi(bad), BinetteError);
  assertEquals(error.message, "この OS では動きません（storage 0.1 の read2）。アプリの管理から入れ直すと直ります");
  assertEquals(error.code, "unsupported_abi");
  const launchError = await assertRejects(() => launchApp(bad, { createWorker }), BinetteError);
  assertEquals(launchError.code, "unsupported_abi");
  assertEquals(launchError.message, error.message);
  const padding = new Uint8Array(wasm.length + 4);
  padding.set(wasm, 2);
  await validateAppAbi(padding.subarray(2, wasm.length + 2));
});

Deno.test("実際の Worker 越しでも未対応 ABI のコードを保ち、不正な WASM は区別する", async () => {
  const wasm = await compile('@external("binette:dom@0.2", "text") declare function text(): void; export function call(): void { text(); }');
  const error = await assertRejects(() => launchApp(wasm), BinetteError);
  assertEquals(error.message, "この OS では動きません（dom 0.2）。アプリの管理から入れ直すと直ります");
  assertEquals(error.code, "unsupported_abi");
  const malformed = await assertRejects(() => launchApp(new Uint8Array([1, 2, 3]), { createWorker }), Error, "起動できません");
  assertEquals(malformed instanceof BinetteError, false);
});

Deno.test("複数の未対応 module は重複を除き機能と版を読点で並べる", async () => {
  const wasm = await compile(`@external("binette:ui@0.2", "render") declare function first(): void;
@external("binette:storage@0.9", "read") declare function second(): void;
@external("binette:storage@0.9", "has") declare function third(): void;
export function call(): void { first(); second(); third(); }`);
  const error = await assertRejects(() => validateAppAbi(wasm), BinetteError);
  assertEquals(error.message, "この OS では動きません（storage 0.9、ui 0.2）。アプリの管理から入れ直すと直ります");
  assertEquals(error.code, "unsupported_abi");
  const launchError = await assertRejects(() => launchApp(wasm, { createWorker }), BinetteError);
  assertEquals(launchError.message, error.message);
});

Deno.test("提供 module の関数以外の import も機能・版・名前を表示する", async () => {
  const name = (value: string) => { const bytes = new TextEncoder().encode(value); return [bytes.length, ...bytes]; };
  const imports = [1, ...name("binette:storage@0.1"), ...name("read"), 3, 0x7f, 0];
  const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 2, imports.length, ...imports]);
  const error = await assertRejects(() => validateAppAbi(wasm), BinetteError);
  assertEquals(error.message, "この OS では動きません（storage 0.1 の read）。アプリの管理から入れ直すと直ります");
  assertEquals(error.code, "unsupported_abi");
  const launchError = await assertRejects(() => launchApp(wasm, { createWorker }), BinetteError);
  assertEquals(launchError.message, error.message);
});

Deno.test("カタログの要求は HOST_ABI の機能と版の完全一致で判定する", () => {
  assertEquals(appCompatibility(), "");
  assertEquals(appCompatibility({}), "");
  assertEquals(appCompatibility({ app: "0.1", storage: "0.1" }), "");
  assertEquals(appCompatibility({ storage: "0.3" }), "この OS では使えません（storage 0.3）");
  assertEquals(appCompatibility({ unknown: "1", app: "0.2" }), "この OS では使えません（app 0.2、unknown 1）");
  try { validateAppRequirements({ storage: "0.3" }); throw new Error("拒否されませんでした"); }
  catch (error) { assert(error instanceof BinetteError); assertEquals(error.code, "unsupported_abi"); }
});

Deno.test("requires は使われる WASM import だけを重複なし・機能順で返す", async () => {
  const wasm = await compile(`@external("binette:storage@0.3", "read") declare function first(): void;
@external("binette:app@1", "why") declare function second(): void;
@external("binette:storage@0.3", "has") declare function third(): void;
@external("binette:ui@0.2", "render") declare function unused(): void;
export function call(): void { first(); second(); third(); }`);
  assertEquals(JSON.stringify(await appRequirements(wasm)), '{"app":"1","storage":"0.3"}');
  assertEquals(await appRequirements(await compile("export function answer(): i32 { return 42; }")), {});
  const conflict = await compile(`@external("binette:ui@0.1", "render") declare function first(): void;
@external("binette:ui@0.2", "render") declare function second(): void;
export function call(): void { first(); second(); }`);
  await assertRejects(() => appRequirements(conflict), Error, "複数の ABI");
});
