import { mockImports } from "./imports.ts";
import { readRepliqueLibraries } from "../../regie/src/cli.ts";
import { assertEquals } from "@std/assert";
import { buildApp } from "../../regie/src/build.ts";

const libraries = { ...await readRepliqueLibraries(new URL("../", import.meta.url)) };
const files: Record<string, string> = {
  "app.json": JSON.stringify({ id: "sub-test", name: "サブアプリ", entry: { as: "main.ts" } }),
  "main.ts": `import { Api, App, Last, launch } from "jsr:@binette/replique";
const initial = new Api().sub();
let created = "";
class Page extends App {
  onCreate(_last: Last, api: Api): void { created = api.sub(); }
}
launch(new Page());
export function initialSub(): string { return initial; }
export function createdSub(): string { return created; }
export function freshSub(): string { return new Api().sub(); }`,
};
const built = await buildApp(path => Promise.resolve(files[path]!), { libraries });
const module = new WebAssembly.Module(new Uint8Array(built.wasm));

for (const sub of ["", "home", "%E8%A8%AD%E5%AE%9A"]) {
  Deno.test(`Api.sub は ${sub || "親（空文字列）"} を初期化時と onCreate で返す`, () => {
    const writeString = (value: string): number => {
      const ptr = (instance.exports.__new as CallableFunction)(value.length * 2, 2) as number;
      const memory = instance.exports.memory as WebAssembly.Memory;
      const view = new DataView(memory.buffer);
      for (let i = 0; i < value.length; i++) view.setUint16(ptr + i * 2, value.charCodeAt(i), true);
      return ptr;
    };
    const readString = (ptr: number): string => {
      const memory = instance.exports.memory as WebAssembly.Memory;
      const length = new DataView(memory.buffer).getUint32(ptr - 4, true);
      return new TextDecoder("utf-16le").decode(new Uint8Array(memory.buffer, ptr, length));
    };
    const binette: Record<string, () => number | void> = {};
    for (const entry of WebAssembly.Module.imports(module)) {
      if (entry.module.startsWith("binette:")) binette[`${entry.module}/${entry.name}`] = () => { throw new Error(`予期しない import: ${entry.name}`); };
    }
    binette["binette:app@0.1/sub"] = () => writeString(sub);
    binette["binette:app@0.1/lastPage"] = () => writeString("");
    binette["binette:app@0.1/lastKind"] = () => 0;
    binette["binette:app@0.1/lastCause"] = () => 0;
    const instance = new WebAssembly.Instance(module, {
      ...mockImports(binette),
      env: { abort: () => { throw new Error("AS が終了しました。"); } },
    });
    const call = (name: string, ...args: number[]): number => (instance.exports[name] as CallableFunction)(...args) as number;
    call("_start");
    assertEquals(readString(call("initialSub")), sub);
    call("__bina_lifecycle", 1, 0, 1);
    assertEquals(readString(call("createdSub")), sub);
    assertEquals(readString(call("freshSub")), sub);
  });
}
