import { readRepliqueLibraries } from "../src/cli.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { buildApp } from "../src/build.ts";

const libraries = { ...await readRepliqueLibraries(new URL("../../replique/", import.meta.url)) };
const files: Record<string, string> = {
  "app.json": JSON.stringify({ id: "click-state", name: "クリックの状態", entry: { html: "index.html", as: "main.ts" } }),
  "index.html": "<p></p>",
};

Deno.test("ビルドに失敗する AS は Error になる", async () => {
  const error = await assertRejects(() => buildApp(path => Promise.resolve({ ...files, "main.ts": 'export function initialize(): void { const n: i32 = "文字"; }' }[path]!), { libraries }), Error, "アプリをビルドできません。");
  assert(error.message.includes("TS2322"));
});

for (const entry of ["jsr:@binette/decor/as", "jsr:@binette/replique-ui@^0.1", "jsr:@binette/replique"]) {
  Deno.test(`宣言 UI の AS 入口 ${entry} を libraries の Réplique だけで解決する`, async () => {
    const source = `import { App, launch } from "jsr:@binette/replique";
import { View, column, text, button, input } from "${entry}";
function click(): void {}
function edit(value: string): void {}
class Page extends App {
  build(): View { return column([text("値"), button("押す", click), input("入力", edit)]); }
}
launch(new Page());`;
    const built = await buildApp(path => Promise.resolve({ ...files, "main.ts": source }[path]!), { libraries });
    assert(WebAssembly.validate(new Uint8Array(built.wasm)));
  });
}

Deno.test("entry.css をフォルダ内から読み、ビルド結果へ渡す", async () => {
  const css = ":scope { color: red }";
  const sources = { ...files, "app.json": JSON.stringify({ id: "css", name: "CSS", entry: { as: "main.ts", css: "./src/style.css" } }), "main.ts": "export function initialize(): void {}", "src/style.css": css };
  const built = await buildApp(path => Promise.resolve(sources[path as keyof typeof sources]!), { libraries });
  assertEquals(built.css, css);
  assertEquals(built.html, "");
  for (const path of ["../secret.css", "/secret.css", "https://example.com/style.css"]) {
    await assertRejects(() => buildApp(file => Promise.resolve(file === "app.json" ? JSON.stringify({ id: "css", name: "CSS", entry: { as: "main.ts", css: path } }) : "")), Error, "相対パス");
  }
});

Deno.test("版なし・旧機能指定子・exact・^・~ と集約入口は同じクラスと状態を使い、相対 import も解決する", async () => {
  const source = `import { App as Exact, launch } from "jsr:@binette/replique-app@0.1.0";
import { App as Caret } from "jsr:@binette/replique-app@^0.1";
import { App as Tilde } from "jsr:@binette/replique-app@~0.1.0";
import { App as Aggregate } from "jsr:@binette/replique";
import { App as Legacy } from "jsr:@binette/replique/app";
import { App as Unversioned } from "jsr:@binette/replique-app";
import { value } from "./folder";
launch(new Exact());
export function verify(): bool { return idof<Exact>() == idof<Caret>() && idof<Caret>() == idof<Tilde>() && idof<Tilde>() == idof<Aggregate>() && idof<Legacy>() == idof<Aggregate>() && idof<Unversioned>() == idof<Aggregate>() && value(); }`;
  const sources: Record<string, string> = { ...files, "main.ts": source,
    "folder/index.ts": 'import { application } from "jsr:@binette/replique/app"; import { application as current } from "jsr:@binette/replique-app"; export function value(): bool { return application !== null && application === current; }',
  };
  const built = await buildApp(path => Promise.resolve(sources[path]), { libraries });
  const module = await WebAssembly.compile(new Uint8Array(built.wasm));
  const imports: WebAssembly.Imports = {};
  for (const entry of WebAssembly.Module.imports(module)) { imports[entry.module] ??= {}; imports[entry.module][entry.name] = () => 0; }
  const instance = await WebAssembly.instantiate(module, imports);
  (instance.exports._start as CallableFunction)();
  assertEquals((instance.exports.verify as CallableFunction)(), 1);
});
