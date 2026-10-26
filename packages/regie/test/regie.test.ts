import assert from "node:assert/strict";
import { test } from "node:test";
import asc from "assemblyscript/asc";
import { launchApp, serveApp, type RegieWorker } from "../src/index.ts";

const source = `
@external("binette", "ui.text")
declare function text(name: string, value: string): void;
export function hello(): void { text("名前", "値"); }
export function boom(): void { throw new Error("こわれた"); }
`;

/** AS のソースを WASM にビルドする */
async function build(code: string): Promise<Uint8Array> {
  let wasm: Uint8Array | undefined;
  let stderr = "";
  const { error } = await asc.main(["main.ts", "--outFile", "main.wasm", "--optimizeLevel", "2", "--exportStart", "_start"], {
    readFile: (name) => name === "main.ts" ? code : null,
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
  serveApp(port1 as never);
  return {
    postMessage: (message, transfer) => port2.postMessage(message, transfer as never),
    addEventListener: (type, listener) => port2.addEventListener(type, listener as never),
    terminate: () => { port1.close(); port2.close(); },
  };
}

test("export の一覧を受け取り、呼び出し中の ui.text が完了より先に届く", async () => {
  const texts: [string, string][] = [];
  const app = await launchApp(await build(source), { createWorker, onText: (name, value) => texts.push([name, value]) });
  try {
    assert.deepEqual([...app.exports].sort(), ["boom", "hello"]);
    await app.call("hello");
    assert.deepEqual(texts, [["名前", "値"]]);
  } finally {
    app.stop();
  }
});

test("無い関数やアプリの中の例外は reject し、onError にも渡す", async () => {
  const errors: Error[] = [];
  const app = await launchApp(await build(source), { createWorker, onError: (error) => errors.push(error) });
  try {
    await assert.rejects(app.call("nothing"), /nothing/);
    await assert.rejects(app.call("boom"), /こわれた/);
    assert.equal(errors.length, 2);
  } finally {
    app.stop();
  }
});

test("WASM でないものは起動できない", async () => {
  await assert.rejects(launchApp(new Uint8Array([1, 2, 3]), { createWorker }), /起動できません/);
});

test("トップレベルの初期化で呼んだ ui.text も届く", async () => {
  const texts: [string, string][] = [];
  const code = `
@external("binette", "ui.text")
declare function text(name: string, value: string): void;
text("初期化", "済み");
export function start(): void {}
`;
  const app = await launchApp(await build(code), { createWorker, onText: (name, value) => texts.push([name, value]) });
  try {
    assert.deepEqual(app.exports, ["start"]);
    assert.deepEqual(texts, [["初期化", "済み"]]);
  } finally {
    app.stop();
  }
});

test("Buffer で渡した WASM でも起動できる", async () => {
  const wasm = await build(source);
  // 前後に別のバイトがある大きなバッファの一部を見る Buffer。Buffer の slice は写しを作らない
  const view = Buffer.from(new ArrayBuffer(wasm.length + 16), 8, wasm.length);
  view.set(wasm);
  const app = await launchApp(view, { createWorker });
  try {
    assert.deepEqual([...app.exports].sort(), ["boom", "hello"]);
  } finally {
    app.stop();
  }
});

test("init を送れなければ Worker を止めて reject する", async () => {
  let terminated = false;
  const failing = (): RegieWorker => ({
    postMessage: () => { throw new Error("送れない"); },
    addEventListener: () => {},
    terminate: () => { terminated = true; },
  });
  await assert.rejects(launchApp(await build(source), { createWorker: failing }), /送れない/);
  assert.ok(terminated);
});
