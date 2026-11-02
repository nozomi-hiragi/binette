import { assert, assertEquals, assertRejects } from "@std/assert";
import asc from "assemblyscript/asc";
import type { DomOp } from "@binette/core";
import { launchApp, type OsSnapshot, serveApp, type RegieWorker } from "../src/index.ts";

const source = `
@external("binette", "dom.text")
declare function text(handle: i32, value: string): void;
export function hello(): void { text(1, "値"); }
export function boom(): void { throw new Error("こわれた"); }
`;

/** AS のソースを WASM にビルドする */
async function build(code: string, runtime = false): Promise<Uint8Array> {
  let wasm: Uint8Array | undefined;
  let stderr = "";
  const { error } = await asc.main(["main.ts", "--outFile", "main.wasm", "--optimizeLevel", "2", "--exportStart", "_start", ...(runtime ? ["--exportRuntime"] : [])], {
    readFile: (name) => name === "main.ts" ? code : name === "replique.ts" ? Deno.readTextFileSync(new URL("../../replique/src/index.ts", import.meta.url)) : name === "node_modules/jsr:@binette/decor/as.ts" ? Deno.readTextFileSync(new URL("../../decor/src/as.ts", import.meta.url)) : name === "node_modules/jsr:@binette/decor/parts.ts" ? Deno.readTextFileSync(new URL("../../decor/src/parts.ts", import.meta.url)) : null,
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

Deno.test("export の一覧を受け取り、呼び出し中の dom.text が完了より先に届く", async () => {
  const texts: DomOp[][] = [];
  const app = await launchApp(await build(source), { createWorker, onDom: (ops) => texts.push(ops) });
  try {
    assertEquals([...app.exports].sort(), ["boom", "hello"]);
    await app.call("hello");
    assertEquals(texts, [[{ op: "text", handle: 1, value: "値" }]]);
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

Deno.test("トップレベルの初期化で呼んだ dom.text も届く", async () => {
  const texts: DomOp[][] = [];
  const code = `
@external("binette", "dom.text")
declare function text(handle: i32, value: string): void;
text(1, "済み");
export function hello(): void {}
`;
  const app = await launchApp(await build(code), { createWorker, onDom: (ops) => texts.push(ops) });
  try {
    assertEquals(app.exports, ["hello"]);
    assertEquals(texts, [[{ op: "text", handle: 1, value: "済み" }]]);
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
import { document, Api, AppsApi } from "./replique";
const api = new Api();
function apps(): AppsApi { return api.get<AppsApi>("apps")!; }
export function openApp(i: i32): void { apps().open(i); }
export function count(): void { document.getElementById("count").textContent = apps().count().toString(); }
export function name(i: i32): void { document.getElementById("name").textContent = apps().name(i); }
export function id(i: i32): void { document.getElementById("id").textContent = apps().id(i); }
export function icon(i: i32): void { apps().icon(document.createElement("img"), i); }
`;

/** 辞書を通さずに OS の呼び出しを直接使うアプリ */
const directSource = `
@external("binette", "apps.count")
declare function count(): i32;
@external("binette", "os.get")
declare function osGet(name: string): i32;
@external("binette", "storage.count")
declare function storageCount(): i32;
export function apps(): void { count(); }
export function os(): void { osGet("stackSize"); }
export function storage(): void { storageCount(); }
`;

Deno.test("一回の call の操作を一回で解決前に届け、例外の前の操作も届ける", async () => {
  const batches: DomOp[][] = []; const order: string[] = [];
  const code = `import { document } from "./replique";
export function hello(): void {
 const e = document.getElementById("a"); e.textContent = "一"; e.className = "二";
}
export function boom(): void { hello(); throw new Error("こわれた"); }`;
  const app = await launchApp(await build(code), { createWorker, onDom(ops) { batches.push(ops); order.push("dom"); }, onExit() { order.push("exit"); } });
  try {
    await app.call("hello").then(() => order.push("done"));
    assertEquals(order, ["dom", "done"]);
    assertEquals(batches, [[{ op: "byId", handle: 1, id: "a" }, { op: "text", handle: 1, value: "一" }, { op: "class", handle: 1, value: "二" }]]);
    await assertRejects(() => app.call("boom"), Error, "こわれた");
    assertEquals(order, ["dom", "done", "dom", "exit"]);
    assertEquals(batches[1], [{ op: "text", handle: 1, value: "一" }, { op: "class", handle: 1, value: "二" }]);
  } finally { app.stop(); }
});

Deno.test("apps の文字列と icon と open を渡す", async () => {
  const batches: DomOp[][] = []; const opened: number[] = [];
  const app = await launchApp(await build(homeSource, true), { createWorker, apps: [{ id: "設定.id", name: "設定🏠" }], onDom: ops => batches.push(ops), onOpen: i => opened.push(i) });
  try {
    await app.call("name", 0); await app.call("id", 0); await app.call("icon", 0); await app.call("openApp", 0);
    assertEquals(batches, [
      [{ op: "byId", handle: 1, id: "name" }, { op: "text", handle: 1, value: "設定🏠" }],
      [{ op: "byId", handle: 2, id: "id" }, { op: "text", handle: 2, value: "設定.id" }],
      [{ op: "create", handle: 3, tag: "img" }, { op: "icon", handle: 3, app: 0 }],
    ]);
    assertEquals(opened, [0]);
  } finally { app.stop(); }
});

Deno.test("apps を渡さないと辞書の apps は null になり、辞書を通さない呼び出しはアプリを終了する", async () => {
  const wasm = await build(homeSource, true);
  for (const fn of ["count", "name", "id", "openApp", "icon"]) {
    const app = await launchApp(wasm, { createWorker });
    try { await assertRejects(() => app.call(fn, 0), Error, "アプリが中断しました"); }
    finally { app.stop(); }
  }
  const direct = await build(directSource, true);
  for (const [fn, key] of [["apps", "apps が届いた"], ["os", "os が届いた"], ["storage", "storage が届いた"]]) {
    const exits: Error[] = [];
    const app = await launchApp(direct, { createWorker, onExit: error => exits.push(error) });
    try {
      await assertRejects(() => app.call(fn), Error, key);
      assertEquals(exits.length, 1);
      await assertRejects(() => app.call(fn), Error, "止まっています");
    } finally { app.stop(); }
  }
});

const whySource = `
import { document, Api, AppsApi, OsApi, StorageApi, FsApi, Why } from "./replique";
const api = new Api();
function text(value: string): void { document.getElementById("value").textContent = value; }
function name(why: Why): string { return why == Why.Granted ? "Granted" : why == Why.NotGranted ? "NotGranted" : "NotAssigned"; }
export function report(): void {
  text([
    name(api.why("apps")), api.get<AppsApi>("apps") != null ? "apps" : "-",
    name(api.why("os")), api.get<OsApi>("os") != null ? "os" : "-",
    name(api.why("storage")), api.get<StorageApi>("storage") != null ? "storage" : "-",
    name(api.why("fs")), api.get<FsApi>("fs") != null ? "fs" : "-",
    name(api.why("unknown")), api.get<AppsApi>("unknown") != null ? "unknown" : "-",
    api.get<OsApi>("apps") != null ? "mismatch" : "-",
  ].join(","));
}
`;

Deno.test("辞書は届いたキーだけを取り出し、取れないキーの理由を why が返す", async () => {
  const wasm = await build(whySource, true);
  const texts: string[] = [];
  const onDom = (ops: DomOp[]) => { for (const op of ops) if (op.op === "text") texts.push(op.value); };
  const empty = await launchApp(wasm, { createWorker, onDom, denied: { apps: "NotAssigned", os: "NotAssigned", fs: "NotGranted" } });
  try { await empty.call("report"); } finally { empty.stop(); }
  assertEquals(texts.splice(0), ["NotAssigned,-,NotAssigned,-,NotGranted,-,NotGranted,-,NotAssigned,-,-"]);
  const home = await launchApp(wasm, { createWorker, onDom, apps: [], storage: new Map(), denied: { os: "NotAssigned", fs: "NotGranted" } });
  try { await home.call("report"); } finally { home.stop(); }
  assertEquals(texts.splice(0), ["Granted,apps,NotAssigned,-,Granted,storage,NotGranted,-,NotAssigned,-,-"]);
});

Deno.test("空の apps は count が 0 で、範囲外の番号は終了する", async () => {
  const wasm = await build(homeSource, true);
  const texts: string[] = [];
  const app = await launchApp(wasm, { createWorker, apps: [], onDom: ops => { for (const op of ops) if (op.op === "text") texts.push(op.value); } });
  try { await app.call("count"); assertEquals(texts, ["0"]); } finally { app.stop(); }
  for (const fn of ["name", "id", "openApp", "icon"]) {
    for (const i of [-1, 0, 1]) {
      const app = await launchApp(wasm, { createWorker, apps: [] });
      try { await assertRejects(() => app.call(fn, i), Error, "アプリの番号が範囲外です。"); }
      finally { app.stop(); }
    }
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
    createWorker, apps: [{ id: value, name: value }], onDom: ops => { for (const op of ops) if (op.op === "text") texts.push(op.value); },
  });
  try {
    for (let i = 0; i < 3; i++) {
      await app.call("name", 0);
      await app.call("id", 0);
    }
    assertEquals(texts, Array(6).fill(value));
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

Deno.test("apps.icon の範囲外は空でない一覧でもアプリを終了する", async () => {
  const wasm = await build(homeSource, true);
  for (const i of [-1, 1]) {
    const exits: Error[] = [];
    const app = await launchApp(wasm, { createWorker, apps: [{ id: "a", name: "一" }], onExit: e => exits.push(e) });
    try {
      await assertRejects(() => app.call("icon", i), Error, "アプリの番号が範囲外です。");
      assertEquals(exits.length, 1);
      await assertRejects(() => app.call("count"), Error, "アプリは止まっています。");
    } finally { app.stop(); }
  }
});

Deno.test("初期化は一回で ready 前に届き、空の call は配送せず、初期化失敗は捨てる", async () => {
  const batches: DomOp[][] = [];
  const code = `import { document } from "./replique";
const e = document.getElementById("a"); e.textContent = "初期化";
export function empty(): void {}`;
  const app = await launchApp(await build(code), { createWorker, onDom: ops => batches.push(ops) });
  try {
    assertEquals(batches, [[{ op: "byId", handle: 1, id: "a" }, { op: "text", handle: 1, value: "初期化" }]]);
    await app.call("empty"); assertEquals(batches.length, 1);
  } finally { app.stop(); }
  batches.length = 0;
  const buildFail = await build(code + '\nthrow new Error("初期化失敗");');
  await assertRejects(() => launchApp(buildFail, { createWorker, onDom: ops => batches.push(ops) }), Error);
  assertEquals(batches, []);
});

/** 無限ループをメインとは別のスレッドで実行する */
function realWorker(): RegieWorker {
  return new Worker(new URL("../src/worker-entry.ts", import.meta.url), { type: "module" });
}
// 最初の module Worker は読み込みが遅く、短い時間切れの試験が揺れるので、先に一度起動しておく
await new Promise<void>(resolve => {
  const worker = realWorker();
  worker.addEventListener("message", () => { worker.terminate(); resolve(); });
  worker.postMessage({ type: "init", wasm: new ArrayBuffer(0) });
});

Deno.test("call の時間切れで Worker と待つ call をすべて終了し、一度だけ知らせる", async () => {
  const exits: Error[] = [];
  const app = await launchApp(await build('export function loop(): void { while (true) {} }'), { createWorker: realWorker, callTimeout: 100, onExit: e => exits.push(e) });
  try {
    const results = await Promise.allSettled([app.call("loop"), app.call("loop")]);
    assertEquals(results.map(r => r.status), ["rejected", "rejected"]);
    for (const result of results) {
      assert(result.status === "rejected"); assertEquals(result.reason, exits[0]);
    }
    assertEquals(exits.length, 1); assert(exits[0]!.message.includes("応答しない"));
    await assertRejects(() => app.call("loop"), Error, "止まっています");
  } finally { app.stop(); }
});

Deno.test("_start の無限ループは ready 前の時間切れとして reject する", async () => {
  const exits: Error[] = [];
  await assertRejects(async () => launchApp(await build('while (true) {}'), { createWorker: realWorker, callTimeout: 100, onExit: e => exits.push(e) }), Error, "応答しない");
  assertEquals(exits, []);
});

Deno.test("call は可変長引数をそのまま WASM に渡す", async () => {
  const values: DomOp[][] = [];
  const code = `@external("binette", "dom.text") declare function text(handle: i32, value: string): void;
export function args(a: i32, b: i32, c: i32): void { text(a, b.toString() + ":" + c.toString()); }`;
  const app = await launchApp(await build(code), { createWorker, onDom: ops => values.push(ops) });
  try { await app.call("args", 7, 8, 9); assertEquals(values, [[{ op: "text", handle: 7, value: "8:9" }]]); }
  finally { app.stop(); }
});

Deno.test("page の既定値と finish の配送は呼び出し中の DOM を反映したあとになる", async () => {
  const code = `import { App, document } from "./replique";
const app = new App();
export function finish(): void { app.finish(); document.getElementById("page").textContent = app.page; }`;
  const wasm = await build(code, true);
  for (const page of [undefined, "ページ🏠"]) {
    const order: string[] = []; const texts: string[] = [];
    const app = await launchApp(wasm, { createWorker, page, onFinish() { order.push("finish"); }, onDom(ops) {
      order.push("dom"); for (const op of ops) if (op.op === "text") texts.push(op.value);
    } });
    try {
      await app.call("finish");
      assertEquals(texts, [page ?? ""]); assertEquals(order, ["dom", "finish"]);
    } finally { app.stop(); }
  }
});

Deno.test("launch のインスタンスは GC 後も上書きしたメソッドで OS の Last と辞書を受け取る", async () => {
  const code = `import { Api, App, Last, State, StorageApi, document, launch, __bina_lifecycle } from "./replique";
class TestApp extends App {
  onCreate(last: Last, api: Api): void {
    assert(last.state == State.Stop && !last.done);
    assert(api.get<StorageApi>("storage") != null && api.get<StorageApi>("apps") == null);
    document.getElementById("log").textContent = "届いた";
  }
}
launch(new TestApp());
export { __bina_lifecycle };`;
  const values: string[] = [];
  const app = await launchApp(await build(code, true), { createWorker, storage: new Map(), onDom(ops) { for (const op of ops) if (op.op === "text") values.push(op.value); } });
  try {
    await app.call("__collect");
    await app.call("__bina_lifecycle", 1, 5, 0);
    assertEquals(values, ["届いた"]);
  } finally { app.stop(); }
});

const osSource = `import { document, Api, OsApi } from "./replique";
const api = new Api();
function os(): OsApi { return api.get<OsApi>("os")!; }
function text(value: string): void { document.getElementById("value").textContent = value; }
export function get(): void { text(os().get("stackSize").toString()); }
export function set(value: i32): void { text(os().set("stackSize", value).toString() + ":" + os().get("stackSize").toString()); }
export function unknown(): void { text(os().set("unknown", 1).toString()); }
export function role(): void { text(os().role("home")); }
export function candidateCount(role: i32): void { text(os().candidateCount(role == 0 ? "home" : role == 1 ? "settings" : "unknown").toString()); }
export function candidateName(i: i32): void { text(os().candidateName("home", i)); }
export function candidateId(i: i32): void { text(os().candidateId("home", i)); }
export function assign(i: i32): void { os().assign("home", i); text(os().role("home")); }
export function launchCount(): void { text(os().launchCount().toString()); }
export function launchTime(i: i32): void { text(os().launchTime(i).toString()); }
export function launchName(i: i32): void { text(os().launchName(i)); }
export function updateAvailable(): void { text(os().updateAvailable().toString()); }
export function update(): void { os().update(); }
export function ranges(): void {
  assert(!os().set("historyLimit", -1)); assert(os().set("historyLimit", 0));
  assert(!os().set("stopDelay", -1)); assert(os().set("stopDelay", 0));
  assert(!os().set("homeRetryWindow", -1)); assert(os().set("homeRetryWindow", 0));
  assert(!os().set("callTimeout", 999)); assert(os().set("callTimeout", 1000));
  assert(!os().set("destroyTimeout", 999)); assert(os().set("destroyTimeout", 1000));
}
`;

const snapshot = (): OsSnapshot => ({
  settings: { stackSize: 3, stopDelay: 10000, historyLimit: 100, callTimeout: 5000, destroyTimeout: 5000, homeRetryWindow: 5000 },
  roles: { home: "key" }, candidates: { home: [] }, launches: [], updateAvailable: false,
});

Deno.test("os を渡さないと辞書の os は null で、辞書を通さずに呼ぶとアプリを終了する", async () => {
  const wasm = await build(osSource, true);
  for (const name of ["get", "set", "unknown", "role", "candidateCount", "candidateName", "candidateId", "assign", "launchCount", "launchTime", "launchName", "updateAvailable", "update"]) {
    const app = await launchApp(wasm, { createWorker });
    try { await assertRejects(() => app.call(name, 0), Error, "アプリが中断しました"); }
    finally { app.stop(); }
  }
});

Deno.test("os の写し、同期の set、範囲の検査、役割の割り当てと履歴と更新を読み書きする", async () => {
  const texts: string[] = []; const changes: [string, number][] = []; const assigns: [string, number][] = []; let updates = 0;
  const app = await launchApp(await build(osSource, true), { createWorker,
    os: { ...snapshot(), candidates: { home: [{ id: "key", name: "ホーム🏠" }, { id: "other", name: "別" }] },
      launches: [{ time: 1234567890123, name: "設定" }, { time: 0, name: "unknown-key" }], updateAvailable: true },
    onSet: (name, value) => changes.push([name, value]), onAssign: (role, i) => assigns.push([role, i]), onUpdate: () => updates++,
    onDom(ops) { for (const op of ops) if (op.op === "text") texts.push(op.value); },
  });
  try {
    await app.call("get"); await app.call("set", 0); await app.call("unknown"); await app.call("set", 1); await app.call("get");
    assertEquals(texts.splice(0), ["3", "false:3", "false", "true:1", "1"]); assertEquals(changes.splice(0), [["stackSize", 1]]);
    await app.call("ranges");
    assertEquals(changes, [["historyLimit", 0], ["stopDelay", 0], ["homeRetryWindow", 0], ["callTimeout", 1000], ["destroyTimeout", 1000]]);
    await app.call("role"); await app.call("candidateCount", 0); await app.call("candidateCount", 1); await app.call("candidateCount", 2);
    await app.call("candidateName", 0); await app.call("candidateId", 1); await app.call("assign", 1);
    await app.call("launchCount"); await app.call("launchTime", 0); await app.call("launchName", 0); await app.call("launchName", 1);
    await app.call("updateAvailable"); await app.call("update");
    assertEquals(texts, ["key", "2", "0", "0", "ホーム🏠", "other", "other", "2", "1234567890123.0", "設定", "unknown-key", "true"]);
    assertEquals(assigns, [["home", 1]]);
    assertEquals(updates, 1);
  } finally { app.stop(); }
});

Deno.test("os の候補と履歴の番号が範囲外ならアプリを終了する", async () => {
  const wasm = await build(osSource, true);
  for (const name of ["candidateName", "candidateId", "assign", "launchTime", "launchName"]) {
    for (const i of [-1, 0]) {
      const app = await launchApp(wasm, { createWorker, os: snapshot() });
      try { await assertRejects(() => app.call(name, i), Error, "番号が範囲外"); }
      finally { app.stop(); }
    }
  }
});

const storageSource = `import { document, Api, StorageApi } from "./replique";
const api = new Api();
function storage(): StorageApi { return api.get<StorageApi>("storage")!; }
function text(value: string): void { document.getElementById("value").textContent = value; }
export function read(): void { const value = storage().read("メモ"); text(value == null ? "null" : value); }
export function write(): void { text(storage().write("メモ", "中身🏠").toString()); }
export function writeBad(): void { text(storage().write("", "x").toString() + storage().write("a".repeat(257), "x").toString()); }
export function remove(): void { storage().remove("メモ"); storage().remove("無い"); text(storage().count().toString()); }
export function list(): void { let result = ""; for (let i = 0; i < storage().count(); i++) result += storage().name(i) + ","; text(result + storage().has("b").toString()); }
`;

Deno.test("storage は写しを読み、書き込みと削除を知らせ、名前の検査をする", async () => {
  const texts: string[] = []; const writes: [string, string | null][] = [];
  const app = await launchApp(await build(storageSource, true), { createWorker, storage: new Map([["メモ", "前の中身"], ["b", "2"], ["a", "1"]]),
    onStorage: (name, value) => writes.push([name, value]), onDom(ops) { for (const op of ops) if (op.op === "text") texts.push(op.value); } });
  try {
    await app.call("read"); await app.call("write"); await app.call("read"); await app.call("writeBad"); await app.call("list");
    await app.call("remove");
    assertEquals(texts, ["前の中身", "true", "中身🏠", "falsefalse", "a,b,メモ,true", "2"]);
    assertEquals(writes, [["メモ", "中身🏠"], ["メモ", null]]);
  } finally { app.stop(); }
});

Deno.test("既定の独立 module Worker で起動して関数を呼べる", async () => {
  const texts: DomOp[][] = [];
  const app = await launchApp(await build(source), { onDom: (ops) => texts.push(ops) });
  try {
    await app.call("hello");
    assert(texts.flat().some((op) => op.op === "text" && op.value === "値"));
  } finally { app.stop(); }
});

Deno.test("明示した Worker URL で起動し、createWorker は URL より優先する", async () => {
  const wasm = await build(source);
  for (const options of [
    { workerUrl: new URL("../src/worker-entry.ts", import.meta.url) },
    { workerUrl: "invalid:ignored", createWorker },
  ]) {
    const app = await launchApp(wasm, options);
    try { await app.call("hello"); } finally { app.stop(); }
  }
});

Deno.test("Cadre の同期に応答しないアプリは、呼び出しの時間切れで終了する", async () => {
  // 描き直しで固まった Worker の代わりに、cadre.sync を届けない
  const createSilentSync = (): RegieWorker => {
    const worker = createWorker();
    return { ...worker, postMessage: (message, transfer) => { if ((message as { type: string }).type !== "cadre.sync") worker.postMessage(message, transfer); } };
  };
  let exited: Error | undefined;
  const app = await launchApp(await build(source), { createWorker: createSilentSync, callTimeout: 50, onExit: (error) => { exited = error; } });
  app.syncCadre!({ instances: [], homeFront: true, installed: true, installBusy: false });
  for (let i = 0; i < 100 && !exited; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(exited?.message, "アプリが応答しないので終了しました。");
});

Deno.test("Cadre の同期は完了を返し、時間切れにならない", async () => {
  let exited: Error | undefined;
  const app = await launchApp(await build(source), { createWorker, callTimeout: 50, onExit: (error) => { exited = error; } });
  app.syncCadre!({ instances: [], homeFront: true, installed: true, installBusy: false });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assertEquals(exited, undefined);
  app.stop();
});
