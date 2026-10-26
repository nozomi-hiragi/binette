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

Deno.test("無い関数は onError に渡し、次の呼び出しを続ける", async () => {
  const errors: Error[] = [];
  const app = await launchApp(await build(source), { createWorker, onError: (error) => errors.push(error) });
  try {
    await assertRejects(() => app.call("nothing"), Error, "nothing");
    await app.call("hello");
    assertEquals(errors.length, 1);
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

Deno.test("apps を渡さないと apps.* はすべてアプリを終了する", async () => {
  const wasm = await build(homeSource, true);
  for (const fn of ["count", "name", "id", "openApp"]) {
    const app = await launchApp(wasm, { createWorker });
    try { await assertRejects(() => app.call(fn, 0), Error, "この呼び出しはホームのアプリだけが使えます。"); }
    finally { app.stop(); }
  }
});

Deno.test("空の apps は count が 0 で、範囲外の番号は終了する", async () => {
  const wasm = await build(homeSource, true);
  const texts: string[] = [];
  const app = await launchApp(wasm, { createWorker, apps: [], onText: (_, value) => texts.push(value) });
  try { await app.call("count"); assertEquals(texts, ["0"]); } finally { app.stop(); }
  for (const fn of ["name", "id", "openApp"]) {
    for (const i of [-1, 0, 1]) {
      const app = await launchApp(wasm, { createWorker, apps: [] });
      try { await assertRejects(() => app.call(fn, i), Error, "アプリの番号が範囲外です。"); }
      finally { app.stop(); }
    }
  }
});

Deno.test("行とアプリの範囲外の番号は終了する。clear 後の行も使えない", async () => {
  const wasm = await build(homeSource, true);
  const cases: [string, number, boolean, boolean, string][] = [];
  for (const fn of ["invalidText", "invalidIcon"]) {
    cases.push([fn, 0, false, false, "行"]);
    for (const row of [-1, 1]) cases.push([fn, row, true, false, "行"]);
  }
  for (const fn of ["name", "id", "openApp", "invalidIconApp"]) {
    for (const i of [-1, 1]) cases.push([fn, i, true, false, "アプリ"]);
  }
  cases.push(["invalidText", 0, true, true, "行"]);
  for (const [fn, arg, start, clear, kind] of cases) {
    const app = await launchApp(wasm, { createWorker, apps: [{ id: "settings", name: "設定" }] });
    try {
      if (start) await app.call("start");
      if (clear) await app.call("clear");
      await assertRejects(() => app.call(fn, arg), Error, kind + "の番号が範囲外です。");
    } finally { app.stop(); }
  }
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

Deno.test("アプリの例外は待つ call を終了し、onExit だけを一度呼ぶ", async () => {
  const errors: Error[] = []; const exits: Error[] = [];
  const app = await launchApp(await build(source), { createWorker, onError: e => errors.push(e), onExit: e => exits.push(e) });
  const results = await Promise.allSettled([app.call("boom"), app.call("hello")]);
  assertEquals(results.map(r => r.status), ["rejected", "rejected"]);
  for (const result of results) {
    assert(result.status === "rejected");
    assertEquals(result.reason, exits[0]);
    assert(result.reason.message.includes("こわれた"));
  }
  await assertRejects(() => app.call("hello"), Error, "アプリは止まっています。");
  app.stop();
  assertEquals(exits.length, 1); assertEquals(errors.length, 0);
});

function eventWorker() {
  const listeners = new Map<string, (event: never) => void>();
  let terminated = 0;
  return {
    get terminated() { return terminated; },
    emit(type: string, event: unknown) { listeners.get(type)?.(event as never); },
    createWorker: (): RegieWorker => ({
      postMessage() {},
      addEventListener(type, listener) { listeners.set(type, listener as (event: never) => void); },
      terminate() { terminated++; },
    }),
  };
}

for (const [type, event, message] of [
  ["error", { message: "壊れた", preventDefault() {} }, "アプリが落ちました: 壊れた"],
  ["error", {}, "アプリが落ちました。"],
  ["messageerror", {}, "アプリとのやりとりに失敗しました。"],
] as const) {
  Deno.test(type + " は起動前なら reject、起動後なら待つ call とアプリを終了する: " + message, async () => {
    const exits: Error[] = [];
    const early = eventWorker();
    const launch = launchApp(new Uint8Array(), { createWorker: early.createWorker, onExit: e => exits.push(e) });
    early.emit(type, event);
    await assertRejects(() => launch, Error, message);
    assertEquals(early.terminated, 1); assertEquals(exits.length, 0);
    const worker = eventWorker();
    const ready = launchApp(new Uint8Array(), { createWorker: worker.createWorker, onExit: e => exits.push(e) });
    worker.emit("message", { data: { type: "ready", exports: ["hello"] } });
    const app = await ready;
    const calls = Promise.allSettled([app.call("hello"), app.call("hello")]);
    worker.emit(type, event); worker.emit(type, event);
    for (const result of await calls) {
      assert(result.status === "rejected"); assertEquals(result.reason, exits[0]);
    }
    assertEquals(exits[0]!.message, message); assertEquals(exits.length, 1); assertEquals(worker.terminated, 1);
    await assertRejects(() => app.call("hello"), Error, "アプリは止まっています。");
  });
}

Deno.test("stop と signal は onExit を呼ばない", async () => {
  for (const abort of [false, true]) {
    const worker = eventWorker(); const controller = new AbortController(); const exits: Error[] = [];
    const ready = launchApp(new Uint8Array(), { createWorker: worker.createWorker, signal: controller.signal, onExit: e => exits.push(e) });
    worker.emit("message", { data: { type: "ready", exports: [] } });
    const app = await ready;
    if (abort) controller.abort(); else app.stop();
    worker.emit("error", { message: "遅いエラー" });
    assertEquals(exits, []); assertEquals(worker.terminated, 1);
  }
});
