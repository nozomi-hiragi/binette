import { assert, assertEquals, assertRejects } from "@std/assert";
import { createMemoryAppStore, type RegieWorker, serveApp } from "@binette/regie";
import { Window } from "happy-dom";
import { buildApp, DestroyCause, DestroyKind, mountApp, mountShell, State } from "../src/index.ts";

const libraries = { "jsr:@binette/replique": await Deno.readTextFile(new URL("../../replique/src/index.ts", import.meta.url)) };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !condition(); i++) await sleep(5);
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
    assert(last.state == State.None && last.done && last.page == "");
    assert(last.reason.kind == 0 && last.reason.cause == 0);
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
function host(window: Window): HTMLElement {
  const element = window.document.createElement("div");
  window.document.body.append(element);
  return element as unknown as HTMLElement;
}
const logOf = (element: HTMLElement | null) => element?.querySelector("#log")?.textContent;
const click = (element: HTMLElement, id: string) => element.querySelector<HTMLButtonElement>(`#${id}`)!.click();

Deno.test("起動の順と Last、Pause・Stop のクリック抑止、Stop から Start と Resume", async () => {
  const window = new Window(); const element = host(window);
  const mounted = await mountApp(element, await build(), { createWorker, stopDelay: 40, page: "ページ🏠" });
  try {
    assertEquals(mounted.state, State.Resume);
    assertEquals(logOf(element), "create:0;start:1;resume;");
    assertEquals(element.querySelector("#page")!.textContent, "ページ🏠");
    await mounted.pause(); await mounted.pause();
    click(element, "click"); await sleep(10);
    assertEquals(logOf(element), "create:0;start:1;resume;pause;");
    await mounted.resume();
    assertEquals(logOf(element), "create:0;start:1;resume;pause;resume;");
    await mounted.pause();
    await waitFor(() => mounted.state === State.Stop && logOf(element)!.endsWith("stop;"));
    click(element, "click"); await sleep(10);
    assert(!logOf(element)!.includes("click;"));
    await mounted.resume(); await mounted.resume();
    assert(logOf(element)!.endsWith("stop;start:5;resume;"));
    click(element, "click"); await waitFor(() => logOf(element)!.endsWith("click;"));
    await mounted.destroy(DestroyKind.System, DestroyCause.Stack);
    assert(logOf(element)!.endsWith("click;pause;stop;destroy:1:2;"));
    assertEquals(mounted.state, State.Destroy);
    const previous = logOf(element); click(element, "click"); await sleep(10); assertEquals(logOf(element), previous);
  } finally { mounted.stop(); await window.happyDOM.close(); }
});

Deno.test("Stop までの残り時間は freeze の間は減らず、resume から続ける", async () => {
  const window = new Window(); const element = host(window);
  const mounted = await mountApp(element, await build(), { createWorker, stopDelay: 200 });
  try {
    await mounted.pause(); await sleep(50); mounted.setFrozen(true);
    await sleep(250); assertEquals(mounted.state, State.Pause);
    mounted.setFrozen(false); await sleep(80); assertEquals(mounted.state, State.Pause);
    await waitFor(() => logOf(element)!.endsWith("stop;"));
    assertEquals(mounted.state, State.Stop);
    // stop は状態の通知を追加しない
    mounted.stop(); assert(!logOf(element)!.includes("destroy:"));
  } finally { mounted.stop(); await window.happyDOM.close(); }
});

Deno.test("launch が無くても初期化のリスナーとイベントは動き、二回の launch は起動に失敗する", async () => {
  const window = new Window(); const element = host(window);
  const built = await build(`import { document } from "jsr:@binette/replique";
document.getElementById("click").addEventListener("click", () => { document.getElementById("log").textContent = "届いた"; });`);
  const mounted = await mountApp(element, built, { createWorker });
  try { click(element, "click"); await waitFor(() => logOf(element) === "届いた"); }
  finally { mounted.stop(); await window.happyDOM.close(); }
  const twice = await build('import { App, launch } from "jsr:@binette/replique"; launch(new App()); launch(new App());');
  await assertRejects(() => mountApp(element, twice, { createWorker }), Error, "launch は一回だけ");
});

Deno.test("hidden・visible・freeze・resume を反映し、blur だけでは Pause にしない", async () => {
  const window = new Window(); const element = host(window);
  Object.defineProperty(window.document, "visibilityState", { configurable: true, value: "visible" });
  const shell = await mountShell(element, { apps: [{ source: "binette:system", prebuilt: await build(source, true) }], store: createMemoryAppStore(), createWorker, stopDelay: 80 });
  const event = (type: string) => window.document.dispatchEvent(new window.Event(type));
  const visibility = (value: string) => { Object.defineProperty(window.document, "visibilityState", { configurable: true, value }); event("visibilitychange"); };
  try {
    window.dispatchEvent(new window.Event("blur")); await sleep(10);
    assertEquals(logOf(element), "create:0;start:1;resume;");
    visibility("hidden"); await waitFor(() => logOf(element)!.endsWith("pause;"));
    click(element, "click"); event("freeze"); await sleep(120);
    assert(logOf(element)!.endsWith("pause;"));
    event("resume"); await sleep(15); assert(logOf(element)!.endsWith("pause;"));
    await waitFor(() => logOf(element)!.endsWith("stop;"));
    click(element, "click"); visibility("visible");
    await waitFor(() => logOf(element)!.endsWith("start:5;resume;"));
    assert(!logOf(element)!.includes("click;"));
    visibility("hidden"); await waitFor(() => logOf(element)!.endsWith("pause;"));
    visibility("visible"); await waitFor(() => logOf(element)!.endsWith("pause;resume;"));
  } finally { shell.stop(); await window.happyDOM.close(); }
});

Deno.test("戻るの理由、finish の順序、ホームの再起動、ページの識別子", async () => {
  const builtHome = await build(source, true), built = await build();
  const window = new Window(); const element = host(window); const errors: unknown[] = [];
  const shell = await mountShell(element, { apps: [{ source: "binette:system", prebuilt: builtHome }, { source: "test", prebuilt: built }], store: createMemoryAppStore(), createWorker, onError: e => errors.push(e) });
  const active = () => element.querySelector<HTMLElement>(".bina-shell-app")!;
  const page = active().querySelector("#page")!.textContent;
  const ready = () => logOf(active()) === "create:0;start:1;resume;";
  try {
    assert(page);
    let previous = active(); click(previous, "open");
    await waitFor(() => active() !== previous && ready());
    assertEquals(logOf(previous), "create:0;start:1;resume;pause;stop;destroy:1:2;");
    assertEquals(active().querySelector("#page")!.textContent, page);
    previous = active(); element.querySelector<HTMLButtonElement>(".bina-shell-back")!.click();
    await waitFor(() => active() !== previous && ready());
    assert(logOf(previous)!.endsWith("pause;stop;destroy:1:2;"));
    previous = active(); click(previous, "finish");
    await waitFor(() => active() !== previous && ready());
    assert(logOf(previous)!.endsWith("before;after;pause;stop;destroy:0:1;"));
    previous = active(); click(previous, "open"); await waitFor(() => active() !== previous && ready());
    previous = active(); click(previous, "finish"); await waitFor(() => active() !== previous && ready());
    assert(logOf(previous)!.endsWith("before;after;pause;stop;destroy:0:1;"));
    assertEquals(active().querySelector("#page")!.textContent, page);
    assertEquals(errors, []);
    const other = host(window);
    const second = await mountShell(other, { apps: [{ source: "binette:system", prebuilt: builtHome }], store: createMemoryAppStore(), createWorker });
    try { assert(other.querySelector("#page")!.textContent !== page); }
    finally { second.stop(); }
  } finally { shell.stop(); await window.happyDOM.close(); }
});

for (const phase of ["call", "init", "destroy", "destroy-regie"] as const) {
  Deno.test(phase + " の無限ループを打ち切り、Destroy だけはエラーを出さない", async () => {
    const code = phase === "init" ? source + '\nwhile (true) {}' : phase === "call"
      ? source.replace('() => record("click")', '() => { while (true) {} }')
      : source.replace('record("destroy:" + reason.kind.toString() + ":" + reason.cause.toString());', 'while (true) {}');
    const built = await build(code), home = await build(source, true);
    const window = new Window(); const element = host(window); const errors: unknown[] = []; let launches = 0;
    const shell = await mountShell(element, { apps: [{ source: "binette:system", prebuilt: home }, { source: "test", prebuilt: built }], store: createMemoryAppStore(), createWorker() { launches++; return realWorker(); },
      callTimeout: phase === "destroy" ? 500 : 100, destroyTimeout: phase === "destroy-regie" ? 500 : 100, onError: e => errors.push(e) });
    try {
      const homeHost = element.querySelector(".bina-shell-app"); click(element, "open");
      if (phase !== "init") {
        await waitFor(() => element.querySelector(".bina-shell-app") !== homeHost && logOf(element) === "create:0;start:1;resume;");
        await sleep(10);
        if (phase === "call") click(element, "click");
        else element.querySelector<HTMLButtonElement>(".bina-shell-back")!.click();
      }
      await waitFor(() => {
        const toolbar = element.querySelector<HTMLElement>(".bina-shell-toolbar");
        return !!toolbar?.hidden && logOf(element) === "create:0;start:1;resume;" && (phase.startsWith("destroy") || errors.length === 1);
      });
      assertEquals(launches, 3);
      if (phase.startsWith("destroy")) {
        assertEquals(errors, []); assertEquals(element.querySelector<HTMLElement>("[role=status]")!.hidden, true);
      } else {
        assertEquals(errors.length, 1); assert((errors[0] as Error).message.includes("応答しない"));
      }
    } finally { shell.stop(); await window.happyDOM.close(); }
  });
}

Deno.test("onCreate の finish は続く起動通知をやめ、今の呼び出し後に閉じる", async () => {
  const code = source.replace('record("create:" + last.state.toString());', 'record("create:" + last.state.toString()); this.finish(); record("after");');
  const window = new Window(); const element = host(window);
  let finishes = 0;
  const mounted = await mountApp(element, await build(code), { createWorker, onFinish() { finishes++; } });
  try {
    await waitFor(() => finishes === 1);
    assertEquals(logOf(element), "create:0;after;");
    await mounted.destroy(DestroyKind.User, DestroyCause.App);
    assertEquals(logOf(element), "create:0;after;pause;stop;destroy:0:1;");
  } finally { mounted.stop(); await window.happyDOM.close(); }
});

for (const state of ["pause", "stop"] as const) {
  Deno.test(state + " の例外は続く終了通知を呼ばず、ホームへ一度だけエラーを出す", async () => {
    const code = source.replace(`record("${state}");`, `record("${state}"); throw new Error("終了前の例外");`);
    const window = new Window(); const element = host(window); const errors: unknown[] = [];
    const shell = await mountShell(element, { apps: [{ source: "binette:system", prebuilt: await build(source, true) }, { source: "test", prebuilt: await build(code) }], store: createMemoryAppStore(), createWorker, onError: e => errors.push(e) });
    try {
      const home = element.querySelector(".bina-shell-app"); click(element, "open");
      await waitFor(() => element.querySelector(".bina-shell-app") !== home && logOf(element) === "create:0;start:1;resume;");
      const previous = element.querySelector<HTMLElement>(".bina-shell-app")!;
      element.querySelector<HTMLButtonElement>(".bina-shell-back")!.click();
      await waitFor(() => errors.length === 1 && element.querySelector<HTMLElement>(".bina-shell-toolbar")!.hidden && logOf(element) === "create:0;start:1;resume;");
      assertEquals(logOf(previous), state === "pause" ? "create:0;start:1;resume;pause;" : "create:0;start:1;resume;pause;stop;");
      assertEquals(element.querySelector<HTMLElement>("[role=status]")!.hidden, false);
      assert((errors[0] as Error).message.includes("終了前の例外"));
    } finally { shell.stop(); await window.happyDOM.close(); }
  });
}
