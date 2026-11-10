import { mockImports } from "./imports.ts";
import { readRepliqueLibraries } from "../../regie/src/cli.ts";
import { assertEquals } from "@std/assert";
import { buildApp } from "../../regie/src/build.ts";

Deno.test("PigeonApi は手紙の ABI と onPigeon 後の再描画をつなぐ", async () => {
  const libraries = { ...await readRepliqueLibraries(new URL("../src/", import.meta.url)) };
  const files: Record<string, string> = {
    "app.json": JSON.stringify({ id: "pigeon-test", name: "手紙", entry: { as: "main.ts" } }),
    "main.ts": `import { Api, App, PigeonApi, StorageApi, View, text, launch } from "jsr:@binette/replique";
export { __bina_pigeon } from "jsr:@binette/replique";
let received = 0;
class Page extends App {
  onPigeon(): void { received++; }
  build(): View { return text(received.toString()); }
}
launch(new Page());
export function access(): bool { return PigeonApi.from(new Api()) !== null; }
export function storageAccess(): bool { return StorageApi.from(new Api()) !== null; }
export function send(): bool { return new PigeonApi().send("user", "chat.message", "題", "本文"); }
export function sendActions(): bool { return new PigeonApi().send("app", "open", "", "{}", true, "[]"); }
export function read(): string {
  const p = new PigeonApi();
  return p.count().toString() + p.from(2) + p.to(2) + p.kind(2) + p.title(2) + p.body(2) + p.urgent(2).toString() + p.actions(2);
}
export function done(): void { new PigeonApi().done(2); }`,
  };
  const built = await buildApp(path => Promise.resolve(files[path]!), { libraries });
  const module = new WebAssembly.Module(new Uint8Array(built.wasm));
  const read = (ptr: number): string => {
    const memory = instance.exports.memory as WebAssembly.Memory;
    return new TextDecoder("utf-16le").decode(new Uint8Array(memory.buffer, ptr, new DataView(memory.buffer).getUint32(ptr - 4, true)));
  };
  const write = (value: string): number => {
    const ptr = (instance.exports.__new as CallableFunction)(value.length * 2, 2) as number;
    const view = new DataView((instance.exports.memory as WebAssembly.Memory).buffer);
    for (let i = 0; i < value.length; i++) view.setUint16(ptr + i * 2, value.charCodeAt(i), true);
    return ptr;
  };
  const sent: unknown[][] = [];
  const rendered: string[] = [];
  let allowed = true;
  let completed = -1;
  const binette: Record<string, CallableFunction> = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    if (entry.module.startsWith("binette:")) binette[`${entry.module}/${entry.name}`] = () => { throw new Error(`予期しない import: ${entry.name}`); };
  }
  binette["binette:app@0.1/why"] = (key: number) => { const name = read(key); assertEquals(["pigeon", "storage"].includes(name), true); return name == "pigeon" && allowed ? 0 : 1; };
  binette["binette:pigeon@0.1/send"] = (...args: number[]) => { sent.push([...args.slice(0, 4).map(read), args[4], read(args[5]!)]); return 1; };
  binette["binette:pigeon@0.1/count"] = () => 3;
  for (const field of ["from", "to", "kind", "title", "body", "actions"]) {
    binette[`binette:pigeon@0.1/${field}`] = (i: number) => { assertEquals(i, 2); return write(field); };
  }
  binette["binette:pigeon@0.1/urgent"] = (i: number) => { assertEquals(i, 2); return 1; };
  binette["binette:pigeon@0.1/done"] = (i: number) => { completed = i; };
  binette["binette:ui@0.1/render"] = (value: number) => { rendered.push(JSON.parse(read(value)).root.text); };
  const instance = new WebAssembly.Instance(module, { ...mockImports(binette), env: { abort: () => { throw new Error("AS が終了しました。"); } } });
  const call = (name: string): number => (instance.exports[name] as CallableFunction)() as number;
  call("_start");
  assertEquals(call("access"), 1);
  assertEquals(call("storageAccess"), 0);
  allowed = false;
  assertEquals(call("access"), 0);
  assertEquals(call("send"), 1);
  assertEquals(call("sendActions"), 1);
  assertEquals(sent, [["user", "chat.message", "題", "本文", 0, "[]"], ["app", "open", "", "{}", 1, "[]"]]);
  assertEquals(read(call("read")), "3fromtokindtitlebodytrueactions");
  call("done");
  assertEquals(completed, 2);
  call("__bina_pigeon");
  call("__bina_pigeon");
  assertEquals(rendered, ["1", "2"]);
});
