import { assert, assertEquals } from "@std/assert";
import { parseAppManifest, type DomOp } from "@binette/core";
import { createMemoryAppStore, installedAppKey, startSystem, serveApp, type Process, type RegieWorker, type SystemOptions, type SystemUi, type SystemView, type BinetteSystem } from "../src/index.ts";
import asc from "assemblyscript/asc";

const replique = await Deno.readTextFile(new URL("../../replique/src/index.ts", import.meta.url));
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(condition: () => boolean): Promise<void> {
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
/** ライフサイクルの試験用 WASM。Scene のビルドと DOM に依存しない */
async function build(code = source, home = false) {
  let wasm: Uint8Array | undefined;
  const stderr = asc.createMemoryStream();
  const { error } = await asc.main(["main.ts", "--outFile", "main.wasm", "--optimizeLevel", "2", "--exportStart", "_start", "--exportRuntime"], {
    readFile(name: string) {
      if (name === "main.ts") return code + '\nexport { __bina_event, __bina_lifecycle } from "jsr:@binette/replique";';
      if (name === "node_modules/jsr:@binette/replique.ts") return replique;
      return null;
    },
    writeFile(name: string, contents: string | Uint8Array) { if (name === "main.wasm" && typeof contents !== "string") wasm = contents; },
    listFiles: () => [], stderr,
  });
  assert(!error && wasm, stderr.toString());
  return { manifest: parseAppManifest(JSON.stringify({ id: home ? "home" : "test", name: "テスト", ...(home ? { role: "home" } : {}), entry: { html: "index.html", as: "main.ts" } })), html: "", wasm };
}

/** プロセスの出力と置き場の寿命だけを記録する偽 UI */
function output() {
  const records = new Map<number, { id: number; process: Process; text: Map<string, string>; listeners: Map<string, number>; connected: boolean }>();
  let view: SystemView = { instances: [], front: undefined, apps: [] };
  const errors: unknown[] = [];
  const reported = new Set<unknown>();
  const ui: SystemUi = {
    update(value) { view = value; },
    report(error) { if (!reported.has(error)) { reported.add(error); errors.push(error); } },
    present(instance, process) {
      const record = { id: instance.id, process, text: new Map<string, string>(), listeners: new Map<string, number>(), connected: true };
      const ids = new Map<number, string>();
      process.attach((ops: DomOp[]) => {
        for (const op of ops) {
          if (op.op === "byId") ids.set(op.handle, op.id);
          else if (op.op === "text") record.text.set(ids.get(op.handle)!, op.value);
          else if (op.op === "listen") record.listeners.set(ids.get(op.handle)!, op.listener);
        }
      });
      records.set(instance.id, record);
      return { remove() { record.connected = false; process.attach(() => {}); } };
    },
  };
  return { ui, errors, get view() { return view; }, get active() { return records.get(view.front as number)!; } };
}
type Output = ReturnType<typeof output>;
type RecordOutput = Output["active"];
const activeHost = (result: Output) => result.active;
const logOf = (result: Output | RecordOutput) => ("active" in result ? result.active : result)?.text.get("log");
const click = (result: Output | RecordOutput, id: string) => {
  const record = "active" in result ? result.active : result;
  record.process.dispatch(record.listeners.get(id)!);
};
async function mountSystem(result: Output, options: Omit<SystemOptions, "ui">) {
  const system = await startSystem({ ...options, ui: result.ui });
  await system.openHome();
  return system;
}
function bar(result: Output, system: BinetteSystem, label: string) {
  if (label === "ホームを開く") { void system.openHome(); return; }
  const close = label.endsWith("を閉じる");
  const name = label.slice(0, -4);
  const instance = result.view.instances.find(instance => instance.name === name)!;
  if (close) void system.close(instance.id); else void system.open(instance.key);
}
async function stackFixtures() {
  const extra = [1, 2].map(i => `document.getElementById("open${i}").addEventListener("click", () => apps.open(${i}));`).join("\n");
  const home = await build(source.replace('record("create:" + last.state.toString());', `record("create:" + last.state.toString()); ${extra}`), true);
  home.html += '<button id="open1">B</button><button id="open2">C</button>';
  const app = await build();
  return [{ source: "binette:system", prebuilt: home }, ...["A", "B", "C"].map(id => ({ source: "test", prebuilt: { ...app, manifest: { ...app.manifest, id, name: id } } }))];
}

Deno.test("ホームに戻っても画面を残し、finish は User・App で閉じる。ページの識別子は共有する", async () => {
  const builtHome = await build(source, true), built = await build();
  const element = output(); const errors = element.errors;
  const shell = await mountSystem(element, { apps: [{ source: "binette:system", prebuilt: builtHome }, { source: "test", prebuilt: built }], store: createMemoryAppStore(), createWorker });
  const page = activeHost(element).text.get("page");
  const home = activeHost(element);
  try {
    assert(page); click(home, "open");
    await waitFor(() => activeHost(element) !== home && logOf(element) === "create:0;start:1;resume;");
    const app = activeHost(element);
    assertEquals(logOf(home), "create:0;start:1;resume;pause;");
    assertEquals(app.text.get("page"), page);
    void shell.openHome();
    await waitFor(() => activeHost(element) === home && logOf(home)!.endsWith("pause;resume;"));
    assertEquals(logOf(app), "create:0;start:1;resume;pause;");
    click(home, "open");
    await waitFor(() => activeHost(element) === app && logOf(app)!.endsWith("pause;resume;"));
    click(app, "finish");
    await waitFor(() => activeHost(element) === home && !app.connected);
    assert(logOf(app)!.endsWith("before;after;pause;stop;destroy:0:1;"));
    click(home, "finish");
    await waitFor(() => activeHost(element) !== home && !!logOf(element)?.includes("start:1;resume;"));
    assert(logOf(home)!.endsWith("before;after;pause;stop;destroy:0:1;"));
    assertEquals(activeHost(element).text.get("page"), page);
    assertEquals(errors, []);
    const other = output();
    const second = await mountSystem(other, { apps: [{ source: "binette:system", prebuilt: builtHome }], store: createMemoryAppStore(), createWorker });
    try { assert(other.active.text.get("page") !== page); }
    finally { second.stop(); }
  } finally { shell.stop(); }
});


Deno.test("起動で固まるホームは、時間切れのあと開き直し続けない", async () => {
  const builtHome = await build("let spin: i32 = 0;\nwhile (true) { spin++; }", true);
  const element = output(); const errors = element.errors; let count = 0;
  const shell = await mountSystem(element, { apps: [{ source: "binette:system", prebuilt: builtHome }], store: createMemoryAppStore(),
    callTimeout: 50, homeRetryWindow: 50, createWorker() { count++; return realWorker(); } });
  try {
    await waitFor(() => count >= 2);
    await sleep(400);
    const settled = count;
    await sleep(300);
    assertEquals(count, settled);
    assert(settled <= 3);
    assert((errors.at(-1) as Error).message.includes("応答しない"));
  } finally { shell.stop(); }
});


Deno.test("保存した設定は ShellOptions より優先し、スタック 1 ではホームも Destroy して戻ると起動", async () => {
  const element = output(); const store = createMemoryAppStore();
  await store.system.putSettings({ home: "後続で使う設定", stackSize: 1, historyLimit: 2, stopDelay: 15 });
  const shell = await mountSystem(element, { apps: await stackFixtures(), store, createWorker, stackSize: 9, historyLimit: 9, stopDelay: 10000 });
  const home = activeHost(element);
  try {
    click(home, "open"); await waitFor(() => !home.connected);
    assert(logOf(home)!.endsWith("pause;stop;destroy:1:2;"));
    const a = activeHost(element);
    bar(element, shell, "ホームを開く"); await waitFor(() => activeHost(element) !== a && !a.connected && !!logOf(element)?.endsWith("resume;"));
    assert(activeHost(element) !== home); assert(logOf(element)!.startsWith("create:6;"));
    const history = await store.system.listLaunches();
    assertEquals(history.map(r => JSON.parse(r.app)[1]), ["A", "home"]);
    assert(history.every(r => r.time > 0));
    assertEquals((await store.system.getSettings())!.home, "後続で使う設定");
  } finally { shell.stop(); }
});


Deno.test("スタック内では前面だけを Pause・Resume し、freeze は全インスタンスの計時を止める", async () => {
  const element = output();
  let visible = true, frozen = false;
  const event = (type: string) => { frozen = type === "freeze"; shell.setPage({ visible, frozen }); };
  const visibility = (value: string) => { visible = value === "visible"; shell.setPage({ visible, frozen }); };
  const shell = await mountSystem(element, { apps: await stackFixtures(), store: createMemoryAppStore(), createWorker, stopDelay: 150 });
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
    bar(element, shell, "ホームを開く"); await waitFor(() => activeHost(element) === home && logOf(home)!.endsWith("stop;start:5;resume;"));
  } finally { shell.stop(); }
});


Deno.test("隠れたインスタンスの Stop の例外はスタックから外し、前面を変えずにエラーを出す", async () => {
  const element = output(); const errors = element.errors;
  const fixtures = await stackFixtures();
  fixtures[1]!.prebuilt = { ...await build(source.replace('record("stop");', 'record("stop"); throw new Error("背面の失敗");')), manifest: fixtures[1]!.prebuilt.manifest };
  const shell = await mountSystem(element, { apps: fixtures, store: createMemoryAppStore(), createWorker, stopDelay: 60 });
  const home = activeHost(element);
  try {
    click(home, "open"); await waitFor(() => activeHost(element) !== home && !!logOf(element)?.endsWith("resume;"));
    const a = activeHost(element);
    bar(element, shell, "ホームを開く"); await waitFor(() => activeHost(element) === home);
    click(home, "open1"); await waitFor(() => activeHost(element) !== home && !!logOf(element)?.endsWith("resume;"));
    const b = activeHost(element);
    await waitFor(() => errors.length === 1);
    assertEquals(activeHost(element), b); assert(!a.connected);
    assertEquals(element.view.instances.find(instance => instance.name === "A"), undefined);
    assertEquals(logOf(a), "create:0;start:1;resume;pause;stop;");
    assert((errors[0] as Error).message.includes("背面の失敗"));
    assertEquals(element.errors.length > 0, true);
  } finally { shell.stop(); }
});


Deno.test("ホームが onPause で落ちても、開いたアプリから引き離さない", async () => {
  const fixtures = await stackFixtures();
  const home = fixtures[0]!.prebuilt;
  fixtures[0]!.prebuilt = { ...await build(source.replace('onPause(): void { record("pause"); }', 'onPause(): void { record("pause"); throw new Error("ホームの Pause の失敗"); }'), true), manifest: home.manifest };
  const element = output(); const errors = element.errors;
  const shell = await mountSystem(element, { apps: fixtures, store: createMemoryAppStore(), createWorker });
  const start = activeHost(element);
  try {
    click(start, "open");
    await waitFor(() => errors.length === 1 && activeHost(element) !== start && !!logOf(element)?.endsWith("resume;"));
    const opened = activeHost(element);
    // 起動し直しの予約（100ms〜）が残っていれば、ここでホームへ戻ってしまう
    await sleep(400);
    assertEquals(activeHost(element), opened);
    assertEquals(typeof element.view.front, "number");
    assertEquals(element.view.instances.find(instance => instance.name === "A")!.id, element.view.front);
  } finally { shell.stop(); }
});


const builtHome = await build(source, true);
const homeApp = { source: "binette:system", prebuilt: builtHome };
const fixtures = ["設定", "設定の写し"].map((name, i) => {
  const manifest = { ...builtHome.manifest, id: `settings-${i}`, name, role: "settings" as const };
  return { ...builtHome, manifest, key: installedAppKey("binette:system", manifest.id), source: "binette:system", installedAt: 1, icon: undefined };
});
const apps = fixtures.map(fixture => ({ source: fixture.source, read: (path: string) => {
  assertEquals(path, "app.json"); return Promise.resolve(JSON.stringify(fixture.manifest));
} }));
async function savedStore() {
  const store = createMemoryAppStore();
  for (const fixture of fixtures) await store.put(fixture);
  return store;
}
function heldWorker() {
  let listener: ((event: MessageEvent) => void) | undefined;
  const messages: unknown[] = [];
  let terminated = 0;
  return {
    messages, get terminated() { return terminated; },
    emit(data: unknown) { listener?.({ data } as MessageEvent); },
    createWorker: (): RegieWorker => ({
      postMessage: (message) => { messages.push(message); },
      addEventListener: (type, callback) => { if (type === "message") listener = callback as (event: MessageEvent) => void; },
      terminate: () => { terminated++; },
    }),
  };
}

Deno.test("read は同じ版を再ビルドせず、版が変われば保存し直す", async () => {
  const element = output(); const store = await savedStore();
  let builds = 0;
  const build = async (read: (path: string) => Promise<string>) => {
    builds++;
    return { ...fixtures[0]!, manifest: parseAppManifest(await read("app.json")) };
  };
  const cached = apps.map((app) => ({ ...app, async read(path: string) { assertEquals(path, "app.json"); return await app.read(path); } }));
  let shell = await startSystem({ ui: element.ui, apps: [homeApp, ...cached], store, build });
  try {
    assertEquals(builds, 0); assertEquals(element.view.apps.length, 2);
    shell.stop();
    const app = apps[0]!;
    shell = await startSystem({ ui: element.ui, apps: [homeApp, { ...app, async read(path) {
      const text = await app.read(path); return path === "app.json" ? JSON.stringify({ ...JSON.parse(text), version: "0.2.0" }) : text;
    } }], store, build });
    assertEquals(builds, 1); assertEquals((await store.get(fixtures[0]!.key))!.manifest.version, "0.2.0");
  } finally { shell.stop(); }
});


Deno.test("prebuilt は compiler を使わず毎回保存し、installedAt を保つ", async () => {
  const element = output(); const store = await savedStore();
  const build = () => { throw new Error("ビルド不要"); };
  const fixture = fixtures[0]!; const changed = { ...fixture, html: "更新した HTML", manifest: { ...fixture.manifest, version: "0.3.0" } };
  const shell = await startSystem({ ui: element.ui, apps: [homeApp, { source: fixture.source, prebuilt: changed }], store, build });
  try {
    const saved = (await store.get(fixture.key))!;
    assertEquals(saved.html, changed.html); assertEquals(saved.manifest.version, "0.3.0"); assertEquals(saved.installedAt, 1);
  } finally { shell.stop(); }
});


Deno.test("読み込み・保存の失敗があっても残りを渡し、重複は並べない", async () => {
  const element = output(); const store = await savedStore(); const errors = element.errors;
  const shell = await startSystem({ ui: element.ui, apps: [homeApp, { source: "bad", read: () => Promise.resolve("{") }, ...apps, apps[1]!],
    store: { ...store, get(key) { return key === fixtures[0]!.key ? Promise.reject(new Error("保存失敗")) : store.get(key); } },
     });
  try {
    assertEquals(errors.length, 2); assertEquals(element.errors.length > 0, true); assertEquals(element.view.apps.length, 1);
    assertEquals(element.view.apps[0]!.name, "設定の写し");
  } finally { shell.stop(); }
});


Deno.test("ホームは system かつ role home の最初のもの。別のホームも一覧に含めない", async () => {
  const element = output();
  const second = { source: "binette:system", prebuilt: { ...builtHome, manifest: { ...builtHome.manifest, id: "second" }, html: "別のホーム" } };
  const shell = await startSystem({ ui: element.ui, createWorker, apps: [homeApp, second, { source: fixtures[0]!.source, prebuilt: fixtures[0]! }], store: createMemoryAppStore() });
  try { await shell.openHome(); assertEquals(element.view.apps.length, 1); assertEquals(element.view.instances.find(instance => instance.home)!.key, installedAppKey(homeApp.source, builtHome.manifest.id)); }
  finally { shell.stop(); }
});


Deno.test("フォルダ外の icon は読まずに拒む", async () => {
  const element = output(); const reads: string[] = []; const errors = element.errors; const app = apps[0]!;
  const shell = await startSystem({ ui: element.ui, apps: [homeApp, { source: app.source, async read(path) {
    reads.push(path); const text = await app.read(path); return path === "app.json" ? JSON.stringify({ ...JSON.parse(text), icon: "../secret.svg" }) : text;
  } }], store: createMemoryAppStore() });
  try { assertEquals(reads, ["app.json"]); assertEquals(errors.length, 1); assertEquals(element.view.apps.length, 0); }
  finally { shell.stop(); }
});

Deno.test("保存した home が無ければ system のホームを使う", async () => {
  const element = output(); const store = createMemoryAppStore();
  await store.system.putSettings({ home: "missing" });
  const shell = await mountSystem(element, { apps: [homeApp], store, createWorker });
  try { assertEquals((await store.system.listLaunches())[0]!.app, installedAppKey(homeApp.source, builtHome.manifest.id)); }
  finally { shell.stop(); }
});


Deno.test("落ちたホームを起動し直す前の待ちは倍になって頭打ちになり、「ホーム」で最初に戻る", async () => {
  const element = output(); const times: number[] = [];
  const shell = await mountSystem(element, { apps: [homeApp, ...apps], store: createMemoryAppStore(), homeRetryWindow: 2600,
    createWorker() {
      times.push(performance.now());
      const held = heldWorker();
      queueMicrotask(() => held.emit({ type: "failed", message: "ホームの失敗" }));
      return held.createWorker();
    } });
  try {
    // 100 → 200 → 400 → 800 → 1000 の待ちで起動し直し、2.6 秒の窓を過ぎたら Apps
    await waitFor(() => element.view.front === "apps");
    const gaps = times.slice(1).map((time, i) => time - times[i]!);
    assert(gaps.length >= 5, `起動し直した回数が少なすぎます: ${gaps.length}`);
    for (const [i, gap] of gaps.entries()) {
      const least = Math.min(100 * 2 ** i, 1000);
      assert(gap >= least - 5, `${i} 回目の待ちが短すぎます: ${gap}`);
      // 1000ms で頭打ちになり、それより大きく延びない
      if (least === 1000) assert(gap < 1900, `待ちが頭打ちになっていません: ${gap}`);
    }
    // 「ホーム」で数え直すと、待ちも 100ms に戻る
    const before = times.length;
    void shell.openHome();
    await waitFor(() => times.length >= before + 2);
    assert(times[before + 1]! - times[before]! < 600, `待ちが戻っていません: ${times[before + 1]! - times[before]!}`);
  } finally { shell.stop(); }
});

