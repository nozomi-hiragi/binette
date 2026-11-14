import { mockImports } from "./imports.ts";
import { assertEquals } from "@std/assert";
import { readRepliqueLibraries } from "../../regie/src/cli.ts";
import { buildApp } from "../../regie/src/build.ts";

Deno.test("集約入口だけを import するアプリがライフサイクルと UI イベントで描画される", async () => {
  const files: Record<string, string> = {
    "app.json": JSON.stringify({ id: "aggregate-ui", name: "集約 UI", entry: { as: "main.ts" } }),
    "main.ts": `import { App, View, column, text, button, launch } from "jsr:@binette/replique";
let count: i32 = 0;
function increment(): void { count++; }
class Page extends App {
  build(): View { return column([text(count.toString()), button("増やす", increment)]); }
}
launch(new Page());`,
  };
  const libraries = await readRepliqueLibraries(new URL("../", import.meta.url));
  const built = await buildApp(path => Promise.resolve(files[path]!), { libraries });
  const module = new WebAssembly.Module(new Uint8Array(built.wasm));
  const frames: { build: number; root: { kind: string; children: { kind: string; text: string; handler: number }[] } }[] = [];
  const binette: Record<string, (...args: number[]) => number | void> = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    if (entry.module.startsWith("binette:")) binette[`${entry.module}/${entry.name}`] = () => { throw new Error(`予期しない import: ${entry.name}`); };
  }
  binette["binette:app@0.1/lastPage"] = () => (instance.exports.__new as CallableFunction)(0, 2) as number;
  binette["binette:app@0.1/lastKind"] = () => 0;
  binette["binette:app@0.1/lastCause"] = () => 0;
  binette["binette:ui@0.1/render"] = (ptr: number) => {
    const memory = instance.exports.memory as WebAssembly.Memory;
    const length = new DataView(memory.buffer).getUint32(ptr - 4, true);
    frames.push(JSON.parse(new TextDecoder("utf-16le").decode(new Uint8Array(memory.buffer, ptr, length))));
  };
  const instance = new WebAssembly.Instance(module, {
    ...mockImports(binette),
    env: { abort() { throw new Error("AS が終了しました。"); } },
  });
  const call = (name: string, ...args: number[]) => (instance.exports[name] as CallableFunction)(...args);
  call("_start");
  assertEquals(frames.length, 0);
  call("__bina_lifecycle", 1, 0, 1);
  assertEquals(frames.length, 1);
  assertEquals(frames[0].root.kind, "column");
  assertEquals(frames[0].root.children.map(child => [child.kind, child.text]), [["text", "0"], ["button", "増やす"]]);
  call("__bina_ui_event", frames[0].build, frames[0].root.children[1].handler);
  assertEquals(frames.length, 2);
  assertEquals(frames[1].build, frames[0].build + 1);
  assertEquals(frames[1].root.children[0].text, "1");
  call("__bina_lifecycle", 3, 0, 0);
  assertEquals(frames.length, 3);
  assertEquals(frames[2].build, frames[1].build + 1);
  assertEquals(frames[2].root.children[0].text, "1");
});

Deno.test("Feature imports retain class identity with the aggregate SDK and feature factories", async () => {
  const classes: Record<string, string> = {
    apps: "AppsApi", os: "OsApi", storage: "StorageApi", shares: "SharesApi", pigeon: "PigeonApi",
    fs: "FsApi", cadre: "CadreApi", manager: "AppManagerApi", scheduler: "SchedulerApi", schedule: "ScheduleApi",
  };
  const code = [
    'import { Api, App, launch } from "jsr:@binette/replique-app@^0.1";',
    'import { Element, Event, document } from "jsr:@binette/replique-dom@^0.1";',
    'import { View, text } from "jsr:@binette/replique-ui@^0.1";',
    'import { App as AggregateApp, Element as AggregateElement, Event as AggregateEvent, View as AggregateView } from "jsr:@binette/replique";',
    ...Object.entries(classes).flatMap(([feature, name]) => [
      `import { ${name} } from "jsr:@binette/replique-${feature}@^0.1";`,
      `import { ${name} as Aggregate${name} } from "jsr:@binette/replique";`,
    ]),
    'class Page extends App { build(): View { return text("features"); } }',
    'launch(new Page());',
    'export function verify(): bool {',
    'const api = new Api();',
    ...Object.values(classes).map(name => `if (idof<${name}>() != idof<Aggregate${name}>() || ${name}.from(api) === null) return false;`),
    'return idof<App>() == idof<AggregateApp>() && idof<Element>() == idof<AggregateElement>() && idof<Event>() == idof<AggregateEvent>() && idof<View>() == idof<AggregateView>();',
    '}',
    ...Object.values(classes).map(name => `export function access${name}(): bool { return ${name}.from(new Api()) !== null; }`),
  ].join("\n");
  const files: Record<string, string> = {
    "app.json": JSON.stringify({ id: "features", name: "Features", entry: { as: "main.ts" } }),
    "main.ts": code,
  };
  const libraries = await readRepliqueLibraries(new URL("../", import.meta.url));
  const built = await buildApp(path => Promise.resolve(files[path]!), { libraries });
  const module = new WebAssembly.Module(new Uint8Array(built.wasm));
  const binette: Record<string, (...args: number[]) => number> = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    if (entry.module.startsWith("binette:")) binette[`${entry.module}/${entry.name}`] = () => 0;
  }
  let reason = 0;
  const keys: string[] = [];
  binette["binette:app@0.1/why"] = (ptr: number) => {
    const memory = instance.exports.memory as WebAssembly.Memory;
    const length = new DataView(memory.buffer).getUint32(ptr - 4, true);
    keys.push(new TextDecoder("utf-16le").decode(new Uint8Array(memory.buffer, ptr, length)));
    return reason;
  };
  const instance = new WebAssembly.Instance(module, { ...mockImports(binette), env: { abort() { throw new Error("Unexpected AS abort"); } } });
  (instance.exports._start as CallableFunction)();
  assertEquals((instance.exports.verify as CallableFunction)(), 1);
  assertEquals(keys.splice(0), Object.keys(classes));
  for (reason of [0, 1, 2]) {
    for (const [key, name] of Object.entries(classes)) {
      assertEquals((instance.exports[`access${name}`] as CallableFunction)(), reason === 0 ? 1 : 0, `${name}: Why=${reason}`);
      assertEquals(keys.splice(0), [key]);
    }
  }
  assertEquals(WebAssembly.Module.exports(module).filter(entry => entry.name.startsWith("__bina_")).map(entry => entry.name).sort(), [
    "__bina_cadre_sync", "__bina_event", "__bina_lifecycle", "__bina_net", "__bina_pigeon", "__bina_safe_area", "__bina_schedule", "__bina_share", "__bina_ui_event", "__bina_ui_text", "__bina_ui_value",
  ]);
});

Deno.test("全14機能の版なし・旧サブパスは版付きと同じ ABI 版へ解決し、互換入口も持つ", async () => {
  const root = new URL("../", import.meta.url);
  const libraries = await readRepliqueLibraries(root);
  const config = JSON.parse(await Deno.readTextFile(new URL("deno.json", root)));
  const features = Object.keys(libraries).filter(key => key.startsWith("jsr:@binette/replique-")).map(key => key.slice("jsr:@binette/replique-".length).split("@")[0]);
  assertEquals(features.length, 14);
  for (const feature of features) {
    const target = config.exports[`./${feature}`];
    assertEquals(target, `./src/${feature}.ts`);
    const wrapper = await Deno.readTextFile(new URL(target, root));
    assertEquals(wrapper.includes(`export * from "jsr:@binette/replique-${feature}@^0.1";`), true);
  }
  const imports = features.flatMap((feature, i) => [
    `import { ABI_VERSION as old${i} } from "jsr:@binette/replique/${feature}";`,
    `import { ABI_VERSION as next${i} } from "jsr:@binette/replique-${feature}@^0.1";`,
    `import { ABI_VERSION as current${i} } from "jsr:@binette/replique-${feature}";`,
  ]).join("\n");
  const code = imports + `\nexport function verify(): bool { return ${features.map((_, i) => `old${i} == next${i} && current${i} == next${i}`).join(" && ")}; }`;
  const files: Record<string, string> = {
    "app.json": JSON.stringify({ id: "legacy", name: "互換", entry: { as: "main.ts" } }),
    "main.ts": code,
  };
  const built = await buildApp(path => Promise.resolve(files[path]), { libraries });
  const module = new WebAssembly.Module(new Uint8Array(built.wasm));
  const importsObject: WebAssembly.Imports = {};
  for (const entry of WebAssembly.Module.imports(module)) { importsObject[entry.module] ??= {}; importsObject[entry.module][entry.name] = () => 0; }
  const instance = new WebAssembly.Instance(module, importsObject);
  (instance.exports._start as CallableFunction)();
  assertEquals((instance.exports.verify as CallableFunction)(), 1);
});
