import { assert, assertEquals } from "@std/assert";
import { buildApp } from "../../../packages/regie/src/build.ts";

type Node = { kind: string; text: string; label: string; handler: number; children: Node[] };

async function start(saved?: string) {
  const root = new URL("../", import.meta.url);
  const built = await buildApp(path => Deno.readTextFile(new URL(path, root)), { libraries: {
    "jsr:@binette/replique": await Deno.readTextFile(new URL("../../../packages/replique/src/index.ts", import.meta.url)),
  } });
  const module = new WebAssembly.Module(new Uint8Array(built.wasm));
  let frame!: { build: number; root: Node };
  const read = (ptr: number): string => {
    const memory = instance.exports.memory as WebAssembly.Memory;
    return new TextDecoder("utf-16le").decode(new Uint8Array(memory.buffer, ptr, new DataView(memory.buffer).getUint32(ptr - 4, true)));
  };
  const write = (value: string): number => {
    const ptr = (instance.exports.__new as CallableFunction)(value.length * 2, 2) as number;
    const memory = new Uint16Array((instance.exports.memory as WebAssembly.Memory).buffer, ptr, value.length);
    for (let i = 0; i < value.length; i++) memory[i] = value.charCodeAt(i);
    return ptr;
  };
  const storage = new Map<string, string>();
  if (saved !== undefined) storage.set("page", saved);
  const host: Record<string, CallableFunction> = {};
  for (const entry of WebAssembly.Module.imports(module)) if (entry.module === "binette") host[entry.name] = () => 0;
  host["api.why"] = () => 0;
  host["storage.has"] = (key: number) => storage.has(read(key));
  host["storage.read"] = (key: number) => { const value = storage.get(read(key)); return value === undefined ? 0 : write(value); };
  host["storage.write"] = (key: number, value: number) => { storage.set(read(key), read(value)); return 1; };
  host["ui.render"] = (ptr: number) => { frame = JSON.parse(read(ptr)); };
  const instance = new WebAssembly.Instance(module, { binette: host, env: { abort: () => { throw new Error("AS abort"); } } });
  const call = (name: string, ...args: number[]) => (instance.exports[name] as CallableFunction)(...args);
  call("_start"); call("__bina_lifecycle", 1, 0, 0);
  const flatten = (node: Node): Node[] => [node, ...node.children.flatMap(flatten)];
  const nodes = () => flatten(frame.root);
  const click = (name: string) => {
    const node = nodes().find(n => n.kind === "button" && (n.text === name || n.label === name));
    assert(node, name);
    call("__bina_ui_event", frame.build, node.handler);
  };
  return { nodes, click, storage, wasm: built.wasm };
}

Deno.test("ドキュメントは目次からページを開き、リンクで別のページの見出しへ移る", async () => {
  const app = await start();
  assert(app.nodes().some(n => n.text === "Binette ドキュメント"));
  app.click("目次");
  assert(app.nodes().some(n => n.label === "目次"));
  app.click("アプリの識別子と提供リスト");
  assert(!app.nodes().some(n => n.label === "目次"), "ページを選ぶと目次を閉じる");
  assertEquals(app.storage.get("page"), "spec/app-id#");
  assert(app.nodes().some(n => n.kind === "text" && n.text === "方針"));
  // A table and a code block are drawn.
  assert(app.nodes().some(n => n.kind === "text" && n.text === "https://nozomi-hiragi.github.io/apps/#memo"));
  app.click("今のコードとの差 を開く");
  assertEquals(app.storage.get("page"), "spec/app-id#今のコードとの差");
  assertEquals(app.nodes().find(n => n.kind === "text" && n.text !== "" && n.text !== "目次")?.text, "アプリの識別子と提供リスト");
  assert(app.nodes().some(n => n.text === "↑ ページの先頭から読む"));
  assert(!app.nodes().some(n => n.kind === "text" && n.text === "方針"), "見出しより前は出さない");
  app.click("↑ ページの先頭から読む");
  assert(app.nodes().some(n => n.kind === "text" && n.text === "方針"));
});

Deno.test("ドキュメントは前に開いていたページから始める", async () => {
  const app = await start("spec/lifecycle#");
  assert(app.nodes().some(n => n.kind === "text" && n.text === "ライフサイクル"));
  const unknown = await start("spec/missing#");
  assert(unknown.nodes().some(n => n.text === "Binette ドキュメント"));
});
