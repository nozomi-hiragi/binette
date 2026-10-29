import { assert, assertEquals, assertRejects } from "@std/assert";
import { createMemoryAppStore, type ProcessOptions, type RegieWorker, serveApp, startProcess } from "../src/index.ts";
import { type DomOp, DestroyCause, DestroyKind, State } from "@binette/core";
import { buildApp } from "../src/build.ts";

const libraries = { "jsr:@binette/replique": await Deno.readTextFile(new URL("../../replique/src/index.ts", import.meta.url)) };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(condition: () => boolean): Promise<void> {
  // 回数ではなく経過時間で待つ。全体を並べて動かすと遅くなるため
  const deadline = performance.now() + 10000;
  while (!condition() && performance.now() < deadline) await sleep(5);
  assert(condition(), "待っても状態が変わりませんでした");
}
function createWorker(): RegieWorker {
  const { port1, port2 } = new MessageChannel();
  port1.start(); port2.start(); serveApp(port1 as never);
  return {
    postMessage: (message, transfer) => port2.postMessage(message, transfer as never),
    addEventListener: (type, listener) => port2.addEventListener(type, listener as never),
    terminate() { port1.close(); port2.close(); },
  };
}
/** 無限ループもメインを止めずに試せる、別スレッドの Worker */
function realWorker(): RegieWorker {
  const url = URL.createObjectURL(new Blob([`(${serveApp.toString()})(self)`], { type: "text/javascript" }));
  try { return new Worker(url, { type: "module" }); }
  finally { URL.revokeObjectURL(url); }
}
const source = `import { App, Last, State, DestroyReason, document, launch, apps } from "jsr:@binette/replique";
let log = "";
function record(value: string): void { log += value + ";"; document.getElementById("log").textContent = log; }
class TestApp extends App {
  onCreate(last: Last): void {

    record("create:" + last.state.toString());
    document.getElementById("page").textContent = this.page;
    document.getElementById("click").addEventListener("click", () => record("click"));
    document.getElementById("finish").addEventListener("click", () => test.finishNow());
    document.getElementById("open").addEventListener("click", () => apps.open(0));
  }
  onStart(last: State): void { record("start:" + last.toString()); }
  onResume(): void { record("resume"); }
  onPause(): void { record("pause"); }
  onStop(): void { record("stop"); }
  onDestroy(reason: DestroyReason): void { record("destroy:" + reason.kind.toString() + ":" + reason.cause.toString()); }
  finishNow(): void { record("before"); this.finish(); record("after"); }
}
const test = new TestApp();
launch(test);`;
async function build(code = source, home = false) {
  const files: Record<string, string> = {
    "app.json": JSON.stringify({ id: home ? "home" : "test", name: "テスト", ...(home ? { role: "home" } : {}), entry: { html: "index.html", as: "main.ts" } }),
    "index.html": '<p id="log"></p><p id="page"></p><button id="click">click</button><button id="finish">finish</button><button id="open">open</button>',
    "main.ts": code,
  };
  return await buildApp(path => Promise.resolve(files[path]!), { libraries });
}
/** DOM を作らず、アプリが知らせた文字とリスナーの番号だけを記録する。 */
function output() {
  const ids = new Map<number, string>();
  const text = new Map<string, string>();
  const listeners = new Map<string, number>();
  return {
    text: (id: string) => text.get(id),
    listener: (id: string) => { const listener = listeners.get(id); assert(listener !== undefined); return listener; },
    receive(ops: DomOp[]) {
      for (const op of ops) {
        if (op.op === "byId") ids.set(op.handle, op.id);
        else if (op.op === "text") text.set(ids.get(op.handle)!, op.value);
        else if (op.op === "listen") listeners.set(ids.get(op.handle)!, op.listener);
      }
    },
  };
}
async function begin(built: Awaited<ReturnType<typeof build>>, result: ReturnType<typeof output>, options: ProcessOptions) {
  const process = await startProcess(built.wasm, options);
  try { process.attach(result.receive); await process.begin(); return process; }
  catch (error) { process.stop(); throw error; }
}
const logOf = (result: ReturnType<typeof output>) => result.text("log");
const dispatch = (process: Awaited<ReturnType<typeof begin>>, result: ReturnType<typeof output>, id: string) => process.dispatch(result.listener(id));

Deno.test("起動の順と Last、Pause・Stop のクリック抑止、Stop から Start と Resume", async () => {
  const element = output();
  const mounted = await begin(await build(), element, { createWorker, stopDelay: 40, page: "ページ🏠" });
  try {
    assertEquals(mounted.state, State.Resume);
    assertEquals(logOf(element), "create:0;start:1;resume;");
    assertEquals(element.text("page"), "ページ🏠");
    await mounted.pause(); await mounted.pause();
    dispatch(mounted, element, "click"); await sleep(10);
    assertEquals(logOf(element), "create:0;start:1;resume;pause;");
    await mounted.resume();
    assertEquals(logOf(element), "create:0;start:1;resume;pause;resume;");
    await mounted.pause();
    await waitFor(() => mounted.state === State.Stop && logOf(element)!.endsWith("stop;"));
    dispatch(mounted, element, "click"); await sleep(10);
    assert(!logOf(element)!.includes("click;"));
    await mounted.resume(); await mounted.resume();
    assert(logOf(element)!.endsWith("stop;start:5;resume;"));
    dispatch(mounted, element, "click"); await waitFor(() => logOf(element)!.endsWith("click;"));
    await mounted.destroy(DestroyKind.System, DestroyCause.Stack);
    assert(logOf(element)!.endsWith("click;pause;stop;destroy:1:2;"));
    assertEquals(mounted.state, State.Destroy);
    const previous = logOf(element); dispatch(mounted, element, "click"); await sleep(10); assertEquals(logOf(element), previous);
  } finally { mounted.stop(); }
});

Deno.test("Stop までの残り時間は freeze の間は減らず、resume から続ける", async () => {
  const element = output();
  const mounted = await begin(await build(), element, { createWorker, stopDelay: 200 });
  try {
    await mounted.pause(); await sleep(50); mounted.setFrozen(true);
    await sleep(250); assertEquals(mounted.state, State.Pause);
    mounted.setFrozen(false); await sleep(80); assertEquals(mounted.state, State.Pause);
    await waitFor(() => logOf(element)!.endsWith("stop;"));
    assertEquals(mounted.state, State.Stop);
    // stop は状態の通知を追加しない
    mounted.stop(); assert(!logOf(element)!.includes("destroy:"));
  } finally { mounted.stop(); }
});

Deno.test("onCreate の finish は続く起動通知をやめ、今の呼び出し後に閉じる", async () => {
  const code = source.replace('record("create:" + last.state.toString());', 'record("create:" + last.state.toString()); this.finish(); record("after");');
  const element = output();
  let finishes = 0;
  const mounted = await begin(await build(code), element, { createWorker, onFinish() { finishes++; } });
  try {
    await waitFor(() => finishes === 1);
    assertEquals(logOf(element), "create:0;after;");
    await mounted.destroy(DestroyKind.User, DestroyCause.App);
    assertEquals(logOf(element), "create:0;after;pause;stop;destroy:0:1;");
  } finally { mounted.stop(); }
});

Deno.test("onStart(Stop) で finish したら onResume を呼ばずに閉じる", async () => {
  const built = await build(source.replace('onStart(last: State): void { record("start:" + last.toString()); }',
    'onStart(last: State): void { record("start:" + last.toString()); if (last == State.Stop) this.finish(); }'));
  const element = output(); let finished = 0;
  const mounted = await begin(built, element, { createWorker, stopDelay: 10, onFinish: () => finished++ });
  try {
    await mounted.pause();
    await waitFor(() => mounted.state === State.Stop);
    await mounted.resume();
    await waitFor(() => finished === 1);
    assertEquals(logOf(element), "create:0;start:1;resume;pause;stop;start:5;");
    assertEquals(mounted.state, State.Start);
  } finally { mounted.stop(); }
});

const lastSource = `import { App, Last, document, launch } from "jsr:@binette/replique";
class TestApp extends App {
  onCreate(last: Last): void {
    document.getElementById("page").textContent = last.state.toString() + "," + last.done.toString() + "," + last.page + "," + last.reason.kind.toString() + "," + last.reason.cause.toString();
  }
}
launch(new TestApp());`;

Deno.test("6 メソッドの前後の保存を待ち、次の onCreate に state・done・page・reason を渡す", async () => {
  const element = output(); const system = createMemoryAppStore().system;
  const records: import("@binette/regie").LifecycleRecord[] = [];
  let latest: import("@binette/regie").LifecycleRecord | undefined;
  const persistence = { key: "test", store: { ...system, async putLast(key: string, record: import("@binette/regie").LifecycleRecord) {
    await sleep(1); await system.putLast(key, record); latest = structuredClone(record); records.push(latest);
  } } };
  const built = await build(lastSource);
  const mounted = await begin(built, element, { page: "前のページ🏠", stopDelay: 20, persistence, createWorker() {
    const worker = createWorker();
    return { ...worker, postMessage(message: unknown, transfer?: Transferable[]) {
      const data = message as { type: string; args?: number[] };
      if (data.type === "call") { assertEquals(latest!.state, data.args![0]); assertEquals(latest!.done, false); }
      worker.postMessage(message, transfer);
    } };
  } });
  try {
    assertEquals(element.text("page"), "0,true,,0,0");
    await mounted.pause(); await mounted.resume(); await mounted.pause();
    await waitFor(() => records.at(-1)?.state === State.Stop && records.at(-1)?.done === true);
    await mounted.resume(); await mounted.destroy(DestroyKind.System, DestroyCause.Stack);
    const states = [State.Create, State.Start, State.Resume, State.Pause, State.Resume, State.Pause, State.Stop, State.Start, State.Resume, State.Pause, State.Stop, State.Destroy];
    assertEquals(records.map(r => [r.state, r.done]), states.flatMap(state => [[state, false], [state, true]]));
    assert(records.every(r => r.page === "前のページ🏠"));
    assertEquals(await system.getLast("test"), { state: State.Destroy, done: true, page: "前のページ🏠", reason: { kind: DestroyKind.System, cause: DestroyCause.Stack } });
    const second = await begin(built, element, { page: "次のページ", persistence, createWorker });
    try {
      assertEquals(element.text("page"), "6,true,前のページ🏠,1,2");
      assertEquals((await system.getLast("test"))!.reason, { kind: DestroyKind.System, cause: DestroyCause.Stack });
      assertEquals((await system.listLaunches()).length, 2);
    } finally { second.stop(); }
  } finally { mounted.stop(); }
});

for (const phase of ["Create", "Stop", "Destroy", "CreateTimeout", "DestroyTimeout"] as const) {
  Deno.test(phase + " の途中で落ちた記録は done=false のまま次の起動に届く", async () => {
    const element = output(); const system = createMemoryAppStore().system;
    const state = phase.startsWith("Create") ? State.Create : phase === "Stop" ? State.Stop : State.Destroy;
    const method = state === State.Create ? "Create" : state === State.Stop ? "Stop" : "Destroy";
    const code = source.replace(`on${method}(${method === "Create" ? "last: Last" : method === "Destroy" ? "reason: DestroyReason" : ""}): void {`,
      `on${method}(${method === "Create" ? "last: Last" : method === "Destroy" ? "reason: DestroyReason" : ""}): void { ${phase.endsWith("Timeout") ? "while (true) {}" : 'throw new Error("記録の途中");'}`);
    const persistence = { store: system, key: "test" };
    let mounted: Awaited<ReturnType<typeof begin>> | undefined;
    let exits = 0;
    try {
      const mounting = () => begin(built, element, { page: "切れたページ", persistence, createWorker: phase.endsWith("Timeout") ? realWorker : createWorker, callTimeout: 100, destroyTimeout: 50, stopDelay: 10, onExit() { exits++; } });
      const built = await build(code);
      if (state === State.Create) await assertRejects(mounting);
      else {
        mounted = await mounting();
        if (state === State.Stop) { await mounted.pause(); await waitFor(() => exits === 1); }
        else await mounted.destroy(DestroyKind.System, DestroyCause.Stack);
      }
      const expectedReason = state === State.Destroy ? { kind: 1, cause: 2 } : { kind: 0, cause: 0 };
      assertEquals(await system.getLast("test"), { state, done: false, page: "切れたページ", reason: expectedReason });
      const next = await begin(await build(lastSource), element, { persistence, createWorker });
      try { assertEquals(element.text("page"), `${state},false,切れたページ,${expectedReason.kind},${expectedReason.cause}`); }
      finally { next.stop(); }
    } finally { mounted?.stop(); }
  });
}


Deno.test("リスナーの解除と部分木の解放は Worker 越しに届き、古い番号を再利用しない", async () => {
  const code = `import { App, Last, document, Element, Event, launch, __bina_listener_count, __bina_element_count } from "jsr:@binette/replique";
let count = 0;
let parent = document.createElement("div");
let child = document.createElement("button");
function clicked(_event: Event): void { count++; document.getElementById("log").textContent = count.toString(); }
export function setup(): void {
  parent = document.createElement("div"); child = document.createElement("button");
  parent.appendChild(child); document.getElementById("page").appendChild(parent);
  parent.addEventListener("click", clicked); child.addEventListener("click", clicked);
}
export function unbind(): void { child.removeEventListener("click", clicked); }
export function rebind(): void { child.addEventListener("click", clicked); }
export function removeTree(): void { parent.remove(); }
export function clearTree(): void { document.getElementById("page").textContent = ""; }
export function stress(): void {
  const listenerCount = __bina_listener_count();
  const elementCount = __bina_element_count();
  for (let i = 0; i < 1000; i++) {
    const p = document.createElement("div");
    const c = document.createElement("button");
    const known = document.getElementById("stress-" + i.toString());
    p.appendChild(c); p.appendChild(known); document.getElementById("page").appendChild(p);
    known.addEventListener("click", clicked);
    p.addEventListener("click", clicked); c.addEventListener("click", clicked);
    c.removeEventListener("click", clicked); c.addEventListener("click", clicked);
    p.remove();
  }
  assert(__bina_listener_count() == listenerCount);
  assert(__bina_element_count() == elementCount);
}
class TestApp extends App { onCreate(_last: Last): void { setup(); } }
launch(new TestApp());`;
  const ops: DomOp[] = [];
  const mounted = await startProcess((await build(code)).wasm, { createWorker });
  try {
    mounted.attach(batch => ops.push(...batch));
    await mounted.begin();
    const listens = () => ops.filter((op): op is Extract<DomOp, { op: "listen" }> => op.op === "listen");
    const texts = () => ops.filter((op): op is Extract<DomOp, { op: "text" }> => op.op === "text");
    const first = listens();
    assertEquals(first.length, 2);
    mounted.dispatch(first[1]!.listener);
    await waitFor(() => texts().some(op => op.value === "1"));
    await mounted.app.call("unbind");
    assert(ops.some(op => op.op === "unlisten" && op.listener === first[1]!.listener));
    await mounted.app.call("rebind");
    const next = listens()[2]!.listener;
    assert(next > first[1]!.listener);
    mounted.dispatch(first[1]!.listener);
    mounted.dispatch(next);
    await waitFor(() => texts().some(op => op.value === "2"));
    assert(!texts().some(op => op.value === "3"));
    await mounted.app.call("removeTree");
    mounted.dispatch(first[0]!.listener); mounted.dispatch(next);
    await mounted.app.call("setup");
    const afterRemove = listens().slice(-2);
    mounted.dispatch(afterRemove[1]!.listener);
    await waitFor(() => texts().some(op => op.value === "3"));
    await mounted.app.call("clearTree");
    mounted.dispatch(afterRemove[0]!.listener); mounted.dispatch(afterRemove[1]!.listener);
    await mounted.app.call("setup");
    mounted.dispatch(listens().at(-1)!.listener);
    await waitFor(() => texts().some(op => op.value === "4"));
    assert(!texts().some(op => op.value === "5"));
    await mounted.app.call("stress");
  } finally { mounted.stop(); }
});
