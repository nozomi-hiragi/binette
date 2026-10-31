import { assert, assertEquals } from "@std/assert";
import asc from "assemblyscript/asc";

interface PreviewNode {
  kind: string;
  text: string;
  label: string;
  handler: number;
  enabled: boolean;
  children: PreviewNode[];
}

/** デザイナーを実際の asc でコンパイルし、描いた部品の木を読み書きできるようにする。 */
async function start() {
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
  const ui = {
    nodes: () => flatten(frame.root),
    find(predicate: (node: PreviewNode) => boolean): PreviewNode {
      const node = ui.nodes().find(predicate);
      assert(node, "対象の部品がありません");
      return node;
    },
    /** ラベルか文字で探したボタンを押す。 */
    click(name: string) {
      exports.__bina_ui_event(frame.build, ui.find((node) => node.kind === "button" && (node.label === name || node.text === name)).handler);
    },
    type(label: string, value: string) {
      const field = ui.find((node) => node.label === label);
      const pointer = exports.__new(value.length * 2, 2);
      new Uint16Array(exports.memory.buffer, pointer, value.length).set(Array.from(value, (c) => c.charCodeAt(0)));
      exports.__bina_ui_text(frame.build, field.handler, pointer);
    },
    code: () => ui.find((node) => node.label === "Décor のコード").text,
    status: () => ui.find((node) => node.kind === "text" && node.text.startsWith("● ")).text,
    has: (label: string) => ui.nodes().some((node) => node.label === label),
    texts: () => ui.nodes().filter((node) => node.kind === "text").map((node) => node.text),
    /** 木の行は buttonOf なので、中の文字を集めて返す。 */
    rowText: (node: PreviewNode) => flatten(node).map((child) => child.text).join(" "),
  };
  return ui;
}

Deno.test("通常アプリの appIcon は説明をプレビューし、木とコードを保持する", async () => {
  const ui = await start();
  function checkIcon(value: string) {
    const nodes = ui.nodes();
    assertEquals(nodes.some((node) => node.kind === "appIcon"), false);
    assert(nodes.some((node) => node.kind === "text" && node.text.includes("appIcon(" + value + ")") && node.text.includes("ホーム専用")));
    assert(ui.code().includes("appIcon(" + value + ")"));
    const item = ui.find((node) => node.label.startsWith("部品を選択 appIcon"));
    assert(ui.rowText(item).includes(value));
  }
  ui.click("appIcon を追加");
  checkIcon("0");

  // 入れ子と根の appIcon を読み込んでも、ホーム専用 View を送らない。
  for (const code of ['buttonOf([appIcon(7).label("見本")], () => {})', 'appIcon(2)']) {
    ui.type("Décor のコード", code);
    ui.click("コードから反映");
    checkIcon(code.includes("7") ? "7" : "2");
  }
  // 根が appIcon のときは子を足せないので、追加のチップを押せない。
  assertEquals(ui.find((node) => node.label === "column を追加").enabled, false);
  ui.click("見本に戻す");
  assertEquals(ui.has("部品を選択 appIcon"), false);
});

Deno.test("インスペクターは選んだ部品に効く修飾だけをグループに分けて出す", async () => {
  const ui = await start();
  // 根の column: 余白・サイズ・識別・そのほか（list）。文字の中身や heading は出さない。
  for (const title of ["インスペクター", "余白", "サイズ", "識別", "そのほか", "3 個の子"]) assert(ui.texts().includes(title), title);
  for (const title of ["内容", "文字"]) assertEquals(ui.texts().includes(title), false, title);
  assert(ui.has("gap を増やす") && ui.has("list を切り替える"));
  assertEquals(ui.has("heading を増やす") || ui.has("multiline を切り替える") || ui.has("enabled を切り替える"), false);

  ui.click("部品を選択 text こんにちは");
  for (const title of ["内容", "文字", "余白"]) assert(ui.texts().includes(title), title);
  assert(ui.has("部品の文字または番号") && ui.has("heading を増やす"));
  assertEquals(ui.has("gap を増やす") || ui.has("コールバック式"), false);

  ui.click("部品を選択 button 押す");
  assert(ui.has("コールバック式") && ui.has("enabled を切り替える") && ui.has("arg を増やす"));
  assertEquals(ui.has("heading を増やす"), false);

  // コードで付けた効かない修飾も、消せるように出す。
  ui.type("Décor のコード", 'text("x").gap(4)');
  ui.click("コードから反映");
  assert(ui.has("gap の修飾を削除"));
  ui.click("gap の修飾を削除");
  assertEquals(ui.code(), 'text("x")');
  assertEquals(ui.has("gap を増やす"), false);
});

Deno.test("数値の ＋、木の操作、コードの状態と反映", async () => {
  const ui = await start();
  assertEquals(ui.status(), "● 木と一致");
  assertEquals(ui.find((node) => node.label === "コードから反映" || node.text === "コードから反映").enabled, false);
  // 根は消せず、先頭は上へ動かせない。
  assertEquals(ui.find((node) => node.label === "選択した部品を削除").enabled, false);
  assertEquals(ui.find((node) => node.label === "選択した部品を上へ移動").enabled, false);

  ui.click("padding を増やす");
  assert(ui.code().endsWith(".padding(17)"), ui.code());
  assertEquals(ui.status(), "● 木と一致");
  ui.click("padding の修飾を削除");
  assert(ui.code().endsWith("]).gap(16)"), ui.code());
  assertEquals(ui.find((node) => node.label === "padding の数値").text, "");

  ui.click("部品を選択 input 複数行…");
  ui.click("選択した部品を上へ移動");
  assert(ui.code().indexOf("input(") < ui.code().indexOf("row(["), ui.code());

  // 読めないコードは入力のうちに位置と理由を出し、反映しても木を変えない。
  const before = ui.code();
  ui.type("Décor のコード", 'column([\n  text("よい"),\n  unknown("悪い")\n])');
  assertEquals(ui.status(), "● 3 行 10 列: 対応していない部品です: unknown");
  ui.click("コードから反映");
  assertEquals(ui.status(), "● 3 行 10 列: 対応していない部品です: unknown");
  assert(ui.has("部品を選択 input 複数行…"));

  ui.type("Décor のコード", 'row([text("新しい")])');
  assertEquals(ui.status(), "● 未反映の変更があります");
  ui.click("コードから反映");
  assertEquals(ui.status(), "● 木と一致");
  assert(ui.has("部品を選択 text 新しい"));
  assertEquals(ui.has("部品を選択 input 複数行…"), false);
  assert(before !== ui.code());
});
