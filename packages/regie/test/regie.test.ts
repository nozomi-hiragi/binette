import { assert, assertEquals, assertRejects } from "@std/assert";
import asc from "assemblyscript/asc";
import { launchApp, serveApp, type RegieWorker } from "../src/index.ts";

const source = `
@external("binette", "elem.text")
declare function text(name: string, value: string): void;
export function hello(): void { text("名前", "値"); }
export function boom(): void { throw new Error("こわれた"); }
`;

/** AS のソースを WASM にビルドする */
async function build(code: string, runtime = false): Promise<Uint8Array> {
  let wasm: Uint8Array | undefined;
  let stderr = "";
  const { error } = await asc.main(["main.ts", "--outFile", "main.wasm", "--optimizeLevel", "2", "--exportStart", "_start", ...(runtime ? ["--exportRuntime"] : [])], {
    readFile: (name) => name === "main.ts" ? code : name === "replique.ts" ? Deno.readTextFileSync(new URL("../../replique/src/index.ts", import.meta.url)) : null,
    writeFile: (name, contents) => { if (name === "main.wasm") wasm = contents as Uint8Array; },
    listFiles: () => [],
    stderr: { write: (chunk: string) => { stderr += chunk; return true; } } as never,
  });
  if (error || !wasm) throw new Error(stderr);
  return wasm;
}

/** 同じスレッドの MessageChannel に serveApp をつないだ Worker */
function createWorker(): RegieWorker {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  serveApp(port1 as never);
  return {
    postMessage: (message, transfer) => port2.postMessage(message, transfer as never),
    addEventListener: (type, listener) => port2.addEventListener(type, listener as never),
    terminate: () => { port1.close(); port2.close(); },
  };
}

Deno.test("export の一覧を受け取り、呼び出し中の elem.text が完了より先に届く", async () => {
  const texts: [string, string][] = [];
  const app = await launchApp(await build(source), { createWorker, onText: (name, value) => texts.push([name, value]) });
  try {
    assertEquals([...app.exports].sort(), ["boom", "hello"]);
    await app.call("hello");
    assertEquals(texts, [["名前", "値"]]);
  } finally {
    app.stop();
  }
});

Deno.test("無い関数やアプリの中の例外は reject し、onError にも渡す", async () => {
  const errors: Error[] = [];
  const app = await launchApp(await build(source), { createWorker, onError: (error) => errors.push(error) });
  try {
    await assertRejects(() => app.call("nothing"), Error, "nothing");
    await assertRejects(() => app.call("boom"), Error, "こわれた");
    assertEquals(errors.length, 2);
  } finally {
    app.stop();
  }
});

Deno.test("WASM でないものは起動できない", async () => {
  await assertRejects(() => launchApp(new Uint8Array([1, 2, 3]), { createWorker }), Error, "起動できません");
});

Deno.test("トップレベルの初期化で呼んだ elem.text も届く", async () => {
  const texts: [string, string][] = [];
  const code = `
@external("binette", "elem.text")
declare function text(name: string, value: string): void;
text("初期化", "済み");
export function start(): void {}
`;
  const app = await launchApp(await build(code), { createWorker, onText: (name, value) => texts.push([name, value]) });
  try {
    assertEquals(app.exports, ["start"]);
    assertEquals(texts, [["初期化", "済み"]]);
  } finally {
    app.stop();
  }
});

Deno.test("大きな ArrayBuffer の一部を見る Uint8Array（subarray）でも起動できる", async () => {
  const wasm = await build(source);
  // 前後に別のバイトがある大きなバッファの一部を見る Uint8Array
  const buffer = new ArrayBuffer(wasm.length + 16);
  const view = new Uint8Array(buffer, 8, wasm.length);
  view.set(wasm);
  const app = await launchApp(view, { createWorker });
  try {
    assertEquals([...app.exports].sort(), ["boom", "hello"]);
  } finally {
    app.stop();
  }
});

Deno.test("init を送れなければ Worker を止めて reject する", async () => {
  let terminated = false;
  const failing = (): RegieWorker => ({
    postMessage: () => { throw new Error("送れない"); },
    addEventListener: () => {},
    terminate: () => { terminated = true; },
  });
  const wasm = await build(source);
  await assertRejects(() => launchApp(wasm, { createWorker: failing }), Error, "送れない");
  assert(terminated);
});

const homeSource = `
import { list, apps, elem } from "./replique";
const tiles = list("tiles");
export function start(): void {
  tiles.clear();
  for (let i = 0; i < apps.count(); i++) {
    const item = tiles.add();
    item.elem("name").text = apps.name(i);
    item.elem("id").text = apps.id(i);
    item.icon(i);
  }
}
export function openApp(row: i32): void { apps.open(row); }
export function count(): void { elem("count").text = apps.count().toString(); }
export function name(i: i32): void { elem("name").text = apps.name(i); }
export function id(i: i32): void { elem("id").text = apps.id(i); }
export function invalidText(row: i32): void {
  // 低水準の import を使って、不正な行番号も確かめる
  itemText("tiles", row, "name", "bad");
}
@external("binette", "item.text")
declare function itemText(list: string, row: i32, name: string, value: string): void;
@external("binette", "item.icon")
declare function itemIcon(list: string, row: i32, app: i32): void;
export function invalidIcon(row: i32): void { itemIcon("tiles", row, 0); }
export function invalidIconApp(i: i32): void { itemIcon("tiles", 0, i); }
export function clear(): void { tiles.clear(); }
export function add(): void { elem("row").text = tiles.add().row.toString(); }
`;

Deno.test("Réplique の一覧、文字列返却、行の引数と起動が Worker を通る", async () => {
  const events: unknown[] = [];
  const app = await launchApp(await build(homeSource, true), {
    createWorker, apps: [{ id: "設定.id", name: "設定🏠" }, { id: "", name: "" }],
    onListAdd: (list, row) => events.push(["add", list, row]),
    onListClear: (list) => events.push(["clear", list]),
    onItemText: (list, row, name, value) => events.push(["text", list, row, name, value]),
    onItemIcon: (list, row, i) => events.push(["icon", list, row, i]),
    onOpen: (i) => events.push(["open", i]),
    onText: (name, value) => events.push(["elem", name, value]),
  });
  try {
    assert(!app.exports.includes("__new"));
    await app.call("start");
    await app.call("openApp", 1);
    await app.call("clear");
    await app.call("add");
    assertEquals(events, [
      ["clear", "tiles"], ["add", "tiles", 0],
      ["text", "tiles", 0, "name", "設定🏠"], ["text", "tiles", 0, "id", "設定.id"], ["icon", "tiles", 0, 0],
      ["add", "tiles", 1], ["text", "tiles", 1, "name", ""], ["text", "tiles", 1, "id", ""], ["icon", "tiles", 1, 1],
      ["open", 1], ["clear", "tiles"], ["add", "tiles", 0], ["elem", "row", "0"],
    ]);
  } finally { app.stop(); }
});

Deno.test("apps を渡さないと apps.* はすべて失敗する", async () => {
  const app = await launchApp(await build(homeSource, true), { createWorker });
  try {
    for (const fn of ["count", "name", "id", "openApp"]) {
      await assertRejects(() => app.call(fn, 0), Error, "この呼び出しはホームのアプリだけが使えます。");
    }
  } finally { app.stop(); }
});

Deno.test("空の apps は count が 0 で、範囲外の番号は失敗する", async () => {
  const texts: string[] = [];
  const app = await launchApp(await build(homeSource, true), { createWorker, apps: [], onText: (_, value) => texts.push(value) });
  try {
    await app.call("count");
    assertEquals(texts, ["0"]);
    for (const fn of ["name", "id", "openApp"]) {
      for (const i of [-1, 0, 1]) await assertRejects(() => app.call(fn, i), Error, "アプリの番号が範囲外です。");
    }
  } finally { app.stop(); }
});

Deno.test("行とアプリの範囲外の番号は通知せず失敗する。clear 後の行も使えない", async () => {
  const app = await launchApp(await build(homeSource, true), { createWorker, apps: [{ id: "settings", name: "設定" }] });
  try {
    for (const fn of ["invalidText", "invalidIcon"]) await assertRejects(() => app.call(fn, 0), Error, "行の番号が範囲外です。");
    await app.call("start");
    for (const fn of ["invalidText", "invalidIcon"]) {
      for (const row of [-1, 1]) await assertRejects(() => app.call(fn, row), Error, "行の番号が範囲外です。");
    }
    for (const fn of ["name", "id", "openApp", "invalidIconApp"]) {
      for (const i of [-1, 1]) await assertRejects(() => app.call(fn, i), Error, "アプリの番号が範囲外です。");
    }
    await app.call("clear");
    await assertRejects(() => app.call("invalidText", 0), Error, "行の番号が範囲外です。");
  } finally { app.stop(); }
});

Deno.test("文字列を返す import は runtime export が無ければ失敗する", async () => {
  const app = await launchApp(await build(homeSource), { createWorker, apps: [{ id: "settings", name: "設定" }] });
  try {
    await assertRejects(() => app.call("name", 0), Error, "--exportRuntime");
  } finally { app.stop(); }
});

Deno.test("文字列の返却でメモリが伸びても UTF-16 の内容を保つ", async () => {
  const value = "設定🏠".repeat(50000);
  const texts: string[] = [];
  const app = await launchApp(await build(homeSource, true), {
    createWorker, apps: [{ id: value, name: value }], onText: (_, text) => texts.push(text),
  });
  try {
    for (let i = 0; i < 3; i++) {
      await app.call("name", 0);
      await app.call("id", 0);
    }
    assertEquals(texts, Array(6).fill(value));
  } finally { app.stop(); }
});

Deno.test("行番号は同じ名前の一覧で共有し、ほかの一覧には影響しない", async () => {
  const rows: unknown[] = [];
  const code = `
import { list } from "./replique";
export function start(): void {
  list("a").add(); list("b").add(); list("a").add();
  list("a").clear(); list("a").add(); list("b").add();
}
`;
  const app = await launchApp(await build(code), { createWorker, onListAdd: (list, row) => rows.push([list, row]) });
  try {
    await app.call("start");
    assertEquals(rows, [["a", 0], ["b", 0], ["a", 1], ["a", 0], ["b", 1]]);
  } finally { app.stop(); }
});
