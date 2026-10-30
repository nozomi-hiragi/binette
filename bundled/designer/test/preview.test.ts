import { assert, assertEquals } from "@std/assert";
import asc from "assemblyscript/asc";

interface PreviewNode {
  kind: string;
  text: string;
  label: string;
  handler: number;
  children: PreviewNode[];
}

Deno.test("通常アプリの appIcon は説明をプレビューし、木とコードを保持する", async () => {
  const sources: Record<string, string> = {
    "main.ts": await Deno.readTextFile(new URL("../src/main.ts", import.meta.url)) + '\nexport { __bina_lifecycle, __bina_ui_event, __bina_ui_text } from "jsr:@binette/replique";',
    "model.ts": await Deno.readTextFile(new URL("../src/model.ts", import.meta.url)),
    "node_modules/jsr:@binette/replique.ts": await Deno.readTextFile(new URL("../../../packages/replique/src/index.ts", import.meta.url)),
    "node_modules/jsr:@binette/replique/ui.ts": await Deno.readTextFile(new URL("../../../packages/replique/src/ui.ts", import.meta.url)),
    "node_modules/jsr:@binette/decor/as.ts": await Deno.readTextFile(new URL("../../../packages/decor/src/as.ts", import.meta.url)),
    "node_modules/jsr:@binette/decor/parts.ts": await Deno.readTextFile(new URL("../../../packages/decor/src/parts.ts", import.meta.url)),
  };
  const stderr = asc.createMemoryStream();
  let wasm: Uint8Array | undefined;
  const result = await asc.main(["main.ts", "--outFile", "main.wasm", "--exportStart", "_start", "--exportRuntime"], {
    readFile: (name) => sources[name] ?? null,
    writeFile(name, value) { if (name === "main.wasm" && typeof value !== "string") wasm = value; },
    listFiles: () => [], stderr,
  });
  assertEquals(result.error, null, stderr.toString());
  const module = await WebAssembly.compile(new Uint8Array(wasm!));
  let frame!: { build: number; root: PreviewNode };
  function string(pointer: number): string {
    const length = new DataView(exports.memory.buffer).getUint32(pointer - 4, true) / 2;
    return String.fromCharCode(...new Uint16Array(exports.memory.buffer, pointer, length));
  }
  const imports: WebAssembly.Imports = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    imports[entry.module] ??= {};
    imports[entry.module][entry.name] = entry.name === "ui.render"
      ? (pointer: number) => { frame = JSON.parse(string(pointer)); }
      : () => { throw new Error("予期しない呼び出し: " + entry.module + "." + entry.name); };
  }
  const instance = await WebAssembly.instantiate(module, imports);
  const exports = instance.exports as {
    memory: WebAssembly.Memory;
    _start(): void;
    __bina_lifecycle(state: number, arg: number, time: number): void;
    __bina_ui_event(build: number, handler: number): void;
    __bina_ui_text(build: number, handler: number, pointer: number): void;
    __new(size: number, id: number): number;
  };
  exports._start();
  exports.__bina_lifecycle(2, 0, 0);
  function flatten(node: PreviewNode): PreviewNode[] { return [node, ...node.children.flatMap(flatten)]; }
  function find(predicate: (node: PreviewNode) => boolean): PreviewNode {
    const node = flatten(frame.root).find(predicate);
    assert(node, "対象の部品がありません");
    return node;
  }
  function click(text: string) {
    exports.__bina_ui_event(frame.build, find((node) => node.kind === "button" && node.text === text).handler);
  }
  function checkIcon(value: string) {
    const nodes = flatten(frame.root);
    assertEquals(nodes.some((node) => node.kind === "appIcon"), false);
    assert(nodes.some((node) => node.kind === "text" && node.text.includes("appIcon(" + value + ")") && node.text.includes("ホーム専用")));
    assert(find((node) => node.label === "Décor のコード").text.includes("appIcon(" + value + ")"));
    assert(nodes.some((node) => node.label === "部品を選択 appIcon" && node.text.includes(value)));
  }
  click("＋ appIcon");
  checkIcon("0");

  // 入れ子と根の appIcon を読み込んでも、ホーム専用 View を送らない。
  for (const code of ['buttonOf([appIcon(7).label("見本")], () => {})', 'appIcon(2)']) {
    const field = find((node) => node.label === "Décor のコード");
    const pointer = exports.__new(code.length * 2, 2);
    new Uint16Array(exports.memory.buffer, pointer, code.length).set(Array.from(code, (c) => c.charCodeAt(0)));
    exports.__bina_ui_text(frame.build, field.handler, pointer);
    click("コードを読み込む");
    checkIcon(code.includes("7") ? "7" : "2");
  }
  click("見本に戻す");
  assertEquals(flatten(frame.root).some((node) => node.label === "部品を選択 appIcon"), false);
});
