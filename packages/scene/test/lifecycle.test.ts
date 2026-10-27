import { assert, assertEquals, assertRejects } from "@std/assert";
import { createMemoryAppStore, type RegieWorker, serveApp } from "@binette/regie";
import { Window } from "happy-dom";
import { buildApp, DestroyCause, DestroyKind, mountApp, mountShell, State } from "../src/index.ts";

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

Deno.test("ホームに戻っても画面を残し、finish は User・App で閉じる。ページの識別子は共有する", async () => {
  const builtHome = await build(source, true), built = await build();
  const window = new Window(); const element = host(window); const errors: unknown[] = [];
  const shell = await mountShell(element, { apps: [{ source: "binette:system", prebuilt: builtHome }, { source: "test", prebuilt: built }], store: createMemoryAppStore(), createWorker, onError: e => errors.push(e) });
  const page = activeHost(element).querySelector("#page")!.textContent;
  const home = activeHost(element);
  try {
    assert(page); click(home, "open");
    await waitFor(() => activeHost(element) !== home && logOf(element) === "create:0;start:1;resume;");
    const app = activeHost(element);
    assertEquals(logOf(home), "create:0;start:1;resume;pause;");
    assertEquals(app.querySelector("#page")!.textContent, page);
    element.querySelector<HTMLButtonElement>('[aria-label=ホームを開く]')!.click();
    await waitFor(() => activeHost(element) === home && logOf(home)!.endsWith("pause;resume;"));
    assertEquals(logOf(app), "create:0;start:1;resume;pause;");
    click(home, "open");
    await waitFor(() => activeHost(element) === app && logOf(app)!.endsWith("pause;resume;"));
    click(app, "finish");
    await waitFor(() => activeHost(element) === home && !app.isConnected);
    assert(logOf(app)!.endsWith("before;after;pause;stop;destroy:0:1;"));
    click(home, "finish");
    await waitFor(() => activeHost(element) !== home && !!logOf(element)?.includes("start:1;resume;"));
    assert(logOf(home)!.endsWith("before;after;pause;stop;destroy:0:1;"));
    assertEquals(activeHost(element).querySelector("#page")!.textContent, page);
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

Deno.test("onStart(Stop) で finish したら onResume を呼ばずに閉じる", async () => {
  const built = await build(source.replace('onStart(last: State): void { record("start:" + last.toString()); }',
    'onStart(last: State): void { record("start:" + last.toString()); if (last == State.Stop) this.finish(); }'));
  const window = new Window(); const element = host(window); let finished = 0;
  const mounted = await mountApp(element, built, { createWorker, stopDelay: 10, onFinish: () => finished++ });
  try {
    await mounted.pause();
    await waitFor(() => mounted.state === State.Stop);
    await mounted.resume();
    await waitFor(() => finished === 1);
    assertEquals(logOf(element), "create:0;start:1;resume;pause;stop;start:5;");
    assertEquals(mounted.state, State.Start);
  } finally { mounted.stop(); await window.happyDOM.close(); }
});

Deno.test("起動で固まるホームは、時間切れのあと開き直し続けない", async () => {
  const builtHome = await build("let spin: i32 = 0;\nwhile (true) { spin++; }", true);
  const window = new Window(); const element = host(window); const errors: unknown[] = []; let count = 0;
  const shell = await mountShell(element, { apps: [{ source: "binette:system", prebuilt: builtHome }], store: createMemoryAppStore(),
    callTimeout: 50, homeRetryWindow: 50, createWorker() { count++; return realWorker(); }, onError: e => errors.push(e) });
  try {
    await waitFor(() => count >= 2);
    await sleep(400);
    const settled = count;
    await sleep(300);
    assertEquals(count, settled);
    assert(settled <= 3);
    assert((errors.at(-1) as Error).message.includes("応答しない"));
  } finally { shell.stop(); await window.happyDOM.close(); }
});

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

Deno.test("保存した設定は ShellOptions より優先し、スタック 1 ではホームも Destroy して戻ると起動", async () => {
  const window = new Window(); const element = host(window); const store = createMemoryAppStore();
  await store.system.putSettings({ home: "後続で使う設定", stackSize: 1, historyLimit: 2, stopDelay: 15 });
  const shell = await mountShell(element, { apps: await stackFixtures(), store, createWorker, stackSize: 9, historyLimit: 9, stopDelay: 10000 });
  const home = activeHost(element);
  try {
    click(home, "open"); await waitFor(() => !home.isConnected);
    assert(logOf(home)!.endsWith("pause;stop;destroy:1:2;"));
    const a = activeHost(element);
    bar(element, "ホームを開く"); await waitFor(() => activeHost(element) !== a && !a.isConnected && !!logOf(element)?.endsWith("resume;"));
    assert(activeHost(element) !== home); assert(logOf(element)!.startsWith("create:6;"));
    const history = await store.system.listLaunches();
    assertEquals(history.map(r => JSON.parse(r.app)[1]), ["A", "home"]);
    assert(history.every(r => r.time > 0));
    assertEquals((await store.system.getSettings())!.home, "後続で使う設定");
  } finally { shell.stop(); await window.happyDOM.close(); }
});

Deno.test("スタック内では前面だけを Pause・Resume し、freeze は全インスタンスの計時を止める", async () => {
  const window = new Window(); const element = host(window);
  Object.defineProperty(window.document, "visibilityState", { configurable: true, value: "visible" });
  const event = (type: string) => window.document.dispatchEvent(new window.Event(type));
  const visibility = (value: string) => { Object.defineProperty(window.document, "visibilityState", { configurable: true, value }); event("visibilitychange"); };
  const shell = await mountShell(element, { apps: await stackFixtures(), store: createMemoryAppStore(), createWorker, stopDelay: 150 });
  const home = activeHost(element);
  try {
    click(home, "open"); await waitFor(() => activeHost(element) !== home && !!logOf(element)?.endsWith("resume;"));
    const a = activeHost(element);
    visibility("hidden"); await waitFor(() => logOf(a)!.endsWith("pause;"));
    const homeLog = logOf(home), appLog = logOf(a);
    event("freeze"); await sleep(200);
    assertEquals(logOf(home), homeLog); assertEquals(logOf(a), appLog);
    event("resume"); await sleep(30);
    assertEquals(logOf(home), homeLog); assertEquals(logOf(a), appLog);
    visibility("visible"); await waitFor(() => logOf(a)!.endsWith("pause;resume;"));
    await waitFor(() => logOf(home)!.endsWith("stop;"));
    assertEquals(logOf(a), appLog + "resume;");
    bar(element, "ホームを開く"); await waitFor(() => activeHost(element) === home && logOf(home)!.endsWith("stop;start:5;resume;"));
  } finally { shell.stop(); await window.happyDOM.close(); }
});

Deno.test("隠れたインスタンスの Stop の例外はスタックから外し、前面を変えずにエラーを出す", async () => {
  const window = new Window(); const element = host(window); const errors: unknown[] = [];
  const fixtures = await stackFixtures();
  fixtures[1]!.prebuilt = { ...await build(source.replace('record("stop");', 'record("stop"); throw new Error("背面の失敗");')), manifest: fixtures[1]!.prebuilt.manifest };
  const shell = await mountShell(element, { apps: fixtures, store: createMemoryAppStore(), createWorker, stopDelay: 60, onError: e => errors.push(e) });
  const home = activeHost(element);
  try {
    click(home, "open"); await waitFor(() => activeHost(element) !== home && !!logOf(element)?.endsWith("resume;"));
    const a = activeHost(element);
    bar(element, "ホームを開く"); await waitFor(() => activeHost(element) === home);
    click(home, "open1"); await waitFor(() => activeHost(element) !== home && !!logOf(element)?.endsWith("resume;"));
    const b = activeHost(element);
    await waitFor(() => errors.length === 1);
    assertEquals(activeHost(element), b); assert(!a.isConnected);
    assertEquals(element.querySelector('[aria-label="Aを開く"]'), null);
    assertEquals(logOf(a), "create:0;start:1;resume;pause;stop;");
    assert((errors[0] as Error).message.includes("背面の失敗"));
    assertEquals(element.querySelector<HTMLElement>('[role=status]')!.hidden, false);
  } finally { shell.stop(); await window.happyDOM.close(); }
});

const lastSource = `import { App, Last, document, launch } from "jsr:@binette/replique";
class TestApp extends App {
  onCreate(last: Last): void {
    document.getElementById("page").textContent = last.state.toString() + "," + last.done.toString() + "," + last.page + "," + last.reason.kind.toString() + "," + last.reason.cause.toString();
  }
}
launch(new TestApp());`;

Deno.test("6 メソッドの前後の保存を待ち、次の onCreate に state・done・page・reason を渡す", async () => {
  const window = new Window(); const element = host(window); const system = createMemoryAppStore().system;
  const records: import("@binette/regie").LifecycleRecord[] = [];
  let latest: import("@binette/regie").LifecycleRecord | undefined;
  const persistence = { key: "test", store: { ...system, async putLast(key: string, record: import("@binette/regie").LifecycleRecord) {
    await sleep(1); await system.putLast(key, record); latest = structuredClone(record); records.push(latest);
  } } };
  const built = await build(lastSource);
  const mounted = await mountApp(element, built, { page: "前のページ🏠", stopDelay: 20, persistence, createWorker() {
    const worker = createWorker();
    return { ...worker, postMessage(message: unknown, transfer?: Transferable[]) {
      const data = message as { type: string; args?: number[] };
      if (data.type === "call") { assertEquals(latest!.state, data.args![0]); assertEquals(latest!.done, false); }
      worker.postMessage(message, transfer);
    } };
  } });
  try {
    assertEquals(element.querySelector("#page")!.textContent, "0,true,,0,0");
    await mounted.pause(); await mounted.resume(); await mounted.pause();
    await waitFor(() => records.at(-1)?.state === State.Stop && records.at(-1)?.done === true);
    await mounted.resume(); await mounted.destroy(DestroyKind.System, DestroyCause.Stack);
    const states = [State.Create, State.Start, State.Resume, State.Pause, State.Resume, State.Pause, State.Stop, State.Start, State.Resume, State.Pause, State.Stop, State.Destroy];
    assertEquals(records.map(r => [r.state, r.done]), states.flatMap(state => [[state, false], [state, true]]));
    assert(records.every(r => r.page === "前のページ🏠"));
    assertEquals(await system.getLast("test"), { state: State.Destroy, done: true, page: "前のページ🏠", reason: { kind: DestroyKind.System, cause: DestroyCause.Stack } });
    const second = await mountApp(element, built, { page: "次のページ", persistence, createWorker });
    try {
      assertEquals(element.querySelector("#page")!.textContent, "6,true,前のページ🏠,1,2");
      assertEquals((await system.getLast("test"))!.reason, { kind: DestroyKind.System, cause: DestroyCause.Stack });
      assertEquals((await system.listLaunches()).length, 2);
    } finally { second.stop(); }
  } finally { mounted.stop(); await window.happyDOM.close(); }
});

for (const phase of ["Create", "Stop", "Destroy", "CreateTimeout", "DestroyTimeout"] as const) {
  Deno.test(phase + " の途中で落ちた記録は done=false のまま次の起動に届く", async () => {
    const window = new Window(); const element = host(window); const system = createMemoryAppStore().system;
    const state = phase.startsWith("Create") ? State.Create : phase === "Stop" ? State.Stop : State.Destroy;
    const method = state === State.Create ? "Create" : state === State.Stop ? "Stop" : "Destroy";
    const code = source.replace(`on${method}(${method === "Create" ? "last: Last" : method === "Destroy" ? "reason: DestroyReason" : ""}): void {`,
      `on${method}(${method === "Create" ? "last: Last" : method === "Destroy" ? "reason: DestroyReason" : ""}): void { ${phase.endsWith("Timeout") ? "while (true) {}" : 'throw new Error("記録の途中");'}`);
    const persistence = { store: system, key: "test" };
    let mounted: Awaited<ReturnType<typeof mountApp>> | undefined;
    let exits = 0;
    try {
      const mounting = () => mountApp(element, built, { page: "切れたページ", persistence, createWorker: phase.endsWith("Timeout") ? realWorker : createWorker, callTimeout: 100, destroyTimeout: 50, stopDelay: 10, onExit() { exits++; } });
      const built = await build(code);
      if (state === State.Create) await assertRejects(mounting);
      else {
        mounted = await mounting();
        if (state === State.Stop) { await mounted.pause(); await waitFor(() => exits === 1); }
        else await mounted.destroy(DestroyKind.System, DestroyCause.Stack);
      }
      const expectedReason = state === State.Destroy ? { kind: 1, cause: 2 } : { kind: 0, cause: 0 };
      assertEquals(await system.getLast("test"), { state, done: false, page: "切れたページ", reason: expectedReason });
      const next = await mountApp(element, await build(lastSource), { persistence, createWorker });
      try { assertEquals(element.querySelector("#page")!.textContent, `${state},false,切れたページ,${expectedReason.kind},${expectedReason.cause}`); }
      finally { next.stop(); }
    } finally { mounted?.stop(); await window.happyDOM.close(); }
  });
}

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
  const mounting = mountApp(element, await build(), { createWorker: heldResume });
  await waitFor(() => release !== undefined);
  click(element, "click");
  release!();
  const mounted = await mounting;
  try { await waitFor(() => logOf(element) === "create:0;start:1;resume;click;"); }
  finally { mounted.stop(); await window.happyDOM.close(); }
});
