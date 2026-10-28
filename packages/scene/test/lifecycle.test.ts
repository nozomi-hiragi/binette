import { assert, assertEquals, assertRejects } from "@std/assert";
import { createMemoryAppStore, type RegieWorker, serveApp } from "@binette/regie";
import { Window } from "happy-dom";
import { State } from "@binette/core";
import { buildApp, mountShell } from "../src/index.ts";
import { mountStartedApp } from "./mount-helper.ts";

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
function host(window: Window): HTMLElement {
  const element = window.document.createElement("div");
  window.document.body.append(element);
  return element as unknown as HTMLElement;
}
const activeHost = (element: HTMLElement) => element.querySelector<HTMLElement>(".bina-shell-app:not([hidden])")!;
const logOf = (element: HTMLElement | null) => (element?.querySelector(".bina-shell") ? activeHost(element) : element)?.querySelector("#log")?.textContent;
const click = (element: HTMLElement, id: string) => (element.querySelector(".bina-shell") ? activeHost(element) : element).querySelector<HTMLButtonElement>(`#${id}`)!.click();

Deno.test("launch が無くても初期化のリスナーとイベントは動き、二回の launch は起動に失敗する", async () => {
  const window = new Window(); const element = host(window);
  const built = await build(`import { document } from "jsr:@binette/replique";
document.getElementById("click").addEventListener("click", () => { document.getElementById("log").textContent = "届いた"; });`);
  const mounted = await mountStartedApp(element, built, { createWorker });
  try { click(element, "click"); await waitFor(() => logOf(element) === "届いた"); }
  finally { mounted.stop(); await window.happyDOM.close(); }
  const twice = await build('import { App, launch } from "jsr:@binette/replique"; launch(new App()); launch(new App());');
  await assertRejects(() => mountStartedApp(element, twice, { createWorker }), Error, "launch は一回だけ");
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
      const homeHost = activeHost(element); click(element, "open");
      if (phase !== "init") {
        await waitFor(() => activeHost(element) !== homeHost && logOf(element) === "create:0;start:1;resume;");
        await sleep(10);
        if (phase === "call") click(element, "click");
        else element.querySelector<HTMLButtonElement>('[aria-label="テストを閉じる"]')!.click();
      }
      await waitFor(() => {
        return activeHost(element) === homeHost && !!logOf(element)?.endsWith("resume;") && (phase.startsWith("destroy") || errors.length === 1);
      });
      assertEquals(launches, 2);
      if (phase.startsWith("destroy")) {
        assertEquals(errors, []); assertEquals(element.querySelector<HTMLElement>("[role=status]")!.hidden, true);
      } else {
        assertEquals(errors.length, 1); assert((errors[0] as Error).message.includes("応答しない"));
      }
    } finally { shell.stop(); await window.happyDOM.close(); }
  });
}

for (const state of ["pause", "stop"] as const) {
  Deno.test(state + " の例外は続く終了通知を呼ばず、ホームへ一度だけエラーを出す", async () => {
    const code = source.replace(`record("${state}");`, `record("${state}"); throw new Error("終了前の例外");`);
    const window = new Window(); const element = host(window); const errors: unknown[] = [];
    const shell = await mountShell(element, { apps: [{ source: "binette:system", prebuilt: await build(source, true) }, { source: "test", prebuilt: await build(code) }], store: createMemoryAppStore(), createWorker, stopDelay: 20, onError: e => errors.push(e) });
    try {
      const home = activeHost(element); click(element, "open");
      await waitFor(() => activeHost(element) !== home && logOf(element) === "create:0;start:1;resume;");
      const previous = activeHost(element);
      element.querySelector<HTMLButtonElement>('[aria-label=ホームを開く]')!.click();
      await waitFor(() => errors.length === 1 && activeHost(element) === home && !!logOf(element)?.endsWith("resume;"));
      assertEquals(logOf(previous), state === "pause" ? "create:0;start:1;resume;pause;" : "create:0;start:1;resume;pause;stop;");
      assertEquals(element.querySelector<HTMLElement>("[role=status]")!.hidden, false);
      assert((errors[0] as Error).message.includes("終了前の例外"));
    } finally { shell.stop(); await window.happyDOM.close(); }
  });
}

async function stackFixtures() {
  const extra = [1, 2].map(i => `document.getElementById("open${i}").addEventListener("click", () => apps.open(${i}));`).join("\n");
  const home = await build(source.replace('record("create:" + last.state.toString());', `record("create:" + last.state.toString()); ${extra}`), true);
  home.html += '<button id="open1">B</button><button id="open2">C</button>';
  const app = await build();
  return [{ source: "binette:system", prebuilt: home }, ...["A", "B", "C"].map(id => ({ source: "test", prebuilt: { ...app, manifest: { ...app.manifest, id, name: id } } }))];
}
const bar = (element: HTMLElement, label: string) => element.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click();

Deno.test("4 つ目は最後に前面に出た順で片付け、前面は消さない。ホームバーで切り替え・閉じる", async () => {
  const window = new Window(); const element = host(window); const store = createMemoryAppStore();
  let launches = 0, terminated = 0;
  const shell = await mountShell(element, { apps: await stackFixtures(), store,
    createWorker() { launches++; const worker = createWorker(); return { ...worker, terminate() { terminated++; worker.terminate(); } }; } });
  const home = activeHost(element);
  const goHome = async () => { bar(element, "ホームを開く"); await waitFor(() => activeHost(element) === home && !!logOf(home)?.endsWith("resume;")); };
  const openNew = async (id: string) => { click(home, id); await waitFor(() => activeHost(element) !== home && !!logOf(element)?.endsWith("resume;")); return activeHost(element); };
  try {
    const a = await openNew("open"); await goHome();
    const b = await openNew("open1"); await goHome();
    // A を再び前面へ出すと、B のほうが古くなる
    bar(element, "Aを開く"); await waitFor(() => activeHost(element) === a && logOf(a)!.endsWith("pause;resume;"));
    await goHome(); const c = await openNew("open2");
    await waitFor(() => !b.isConnected);
    assertEquals(logOf(b), "create:0;start:1;resume;pause;stop;destroy:1:2;");
    assertEquals(activeHost(element), c); assert(a.isConnected); assert(home.isConnected);
    assertEquals(launches, 4); assertEquals(terminated, 1);
    assertEquals(element.querySelector('[aria-label="Bを開く"]'), null);
    bar(element, "Aを閉じる"); await waitFor(() => !a.isConnected);
    assert(logOf(a)!.endsWith("stop;destroy:0:0;")); assertEquals(activeHost(element), c);
    bar(element, "Cを閉じる"); await waitFor(() => !c.isConnected && activeHost(element) === home);
    assert(logOf(c)!.endsWith("pause;stop;destroy:0:0;"));
    assertEquals((await store.system.listLaunches()).length, 4);
    shell.stop(); assert(!logOf(home)!.includes("destroy:")); assertEquals(terminated, 4);
  } finally { shell.stop(); await window.happyDOM.close(); }
});



Deno.test("Pause を待つあいだに同じアプリへ戻っても、前面を失わない", async () => {
  // 一回だけ Pause の通知を止めておける Worker
  let holding = false; let release: (() => void) | undefined;
  const delayedWorker = (): RegieWorker => {
    const inner = createWorker();
    return {
      postMessage(message, transfer) {
        const call = message as { type: string; name?: string; args?: number[] };
        if (holding && call.type === "call" && call.name === "__bina_lifecycle" && call.args?.[0] === State.Pause) {
          holding = false; release = () => inner.postMessage(message, transfer); return;
        }
        inner.postMessage(message, transfer);
      },
      addEventListener: inner.addEventListener,
      terminate: inner.terminate,
    };
  };
  const window = new Window(); const element = host(window);
  const shell = await mountShell(element, { apps: await stackFixtures(), store: createMemoryAppStore(), createWorker: delayedWorker });
  const home = activeHost(element);
  const visible = () => element.querySelectorAll(".bina-shell-app:not([hidden])").length;
  try {
    click(home, "open"); await waitFor(() => activeHost(element) !== home && !!logOf(element)?.endsWith("resume;"));
    const a = activeHost(element);
    holding = true;
    bar(element, "ホームを開く"); await waitFor(() => release !== undefined);
    bar(element, "Aを開く");
    release!();
    await waitFor(() => !!a.querySelector("#log")!.textContent!.endsWith("pause;resume;"));
    assertEquals(activeHost(element), a); assertEquals(visible(), 1);
    assertEquals(element.querySelector('[aria-label="Aを開く"]')!.getAttribute("aria-pressed"), "true");
    bar(element, "ホームを開く"); await waitFor(() => activeHost(element) === home);
    assertEquals(visible(), 1); assert(a.hidden);
  } finally { shell.stop(); await window.happyDOM.close(); }
});

Deno.test("起動の途中のクリックは捨てずに Resume のあとに届ける", async () => {
  // Resume の通知を止めておき、その間にクリックする
  let release: (() => void) | undefined;
  const heldResume = (): RegieWorker => {
    const inner = createWorker();
    return {
      postMessage(message, transfer) {
        const call = message as { type: string; name?: string; args?: number[] };
        if (!release && call.type === "call" && call.name === "__bina_lifecycle" && call.args?.[0] === State.Resume) {
          release = () => inner.postMessage(message, transfer); return;
        }
        inner.postMessage(message, transfer);
      },
      addEventListener: inner.addEventListener,
      terminate: inner.terminate,
    };
  };
  const window = new Window(); const element = host(window);
  const mounting = mountStartedApp(element, await build(), { createWorker: heldResume });
  await waitFor(() => release !== undefined);
  click(element, "click");
  release!();
  const mounted = await mounting;
  try { await waitFor(() => logOf(element) === "create:0;start:1;resume;click;"); }
  finally { mounted.stop(); await window.happyDOM.close(); }
});
