import { assert, assertEquals } from "@std/assert";
import { createMemoryAppStore, installedAppKey, type AppStore, type InstalledApp, type RegieWorker, serveApp } from "@binette/regie";
import { DOMParser } from "@b-fuze/deno-dom";
import { Window } from "happy-dom";
import { buildApp, type Compiler, type HtmlParser, loadCompiler, mountShell } from "../src/index.ts";

const root = new URL("../../..", import.meta.url);
const parser = new DOMParser() as unknown as HtmlParser;
const libraries = { "jsr:@binette/replique": await Deno.readTextFile(new URL("packages/replique/src/index.ts", root)) };
const apps = ["設定", "設定の写し"].map((name, index) => ({
  source: `https://example.com/settings-${index}/`,
  async read(path: string): Promise<string> {
    const text = await Deno.readTextFile(new URL(`apps/settings/${path}`, root));
    return path === "app.json" ? JSON.stringify({ ...JSON.parse(text), id: `settings-${index}`, name }) : text;
  },
}));
const homeRead = { source: "binette:system", read: (path: string) => Deno.readTextFile(new URL(`apps/home/${path}`, root)) };
const builtHome = await buildApp(homeRead.read, { parser, libraries });
const homeApp = { source: "binette:system", prebuilt: builtHome };
const fixtures: InstalledApp[] = [];
for (const app of apps) {
  const built = await buildApp(app.read, { parser, libraries });
  fixtures.push({ manifest: built.manifest, html: built.html, wasm: built.wasm, key: installedAppKey(app.source, built.manifest.id), source: app.source,
    icon: await app.read(built.manifest.icon!), installedAt: 1 });
}
async function savedStore(): Promise<AppStore> {
  const store = createMemoryAppStore();
  for (const app of fixtures) await store.put(app);
  return store;
}
function elementIn(window: Window): HTMLElement {
  const element = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.append(element as never);
  return element;
}
async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert(condition(), "待ってもホームの状態が変わりませんでした");
}
function workers() {
  let live = 0;
  let maximum = 0;
  let created = 0;
  let terminated = 0;
  let ready = 0;
  return {
    get live() { return live; }, get maximum() { return maximum; },
    get created() { return created; }, get terminated() { return terminated; },
    get ready() { return ready; },
    createWorker(): RegieWorker {
      live++; created++; maximum = Math.max(maximum, live);
      const { port1, port2 } = new MessageChannel();
      port1.start(); port2.start();
      serveApp(port1 as never);
      let stopped = false;
      return {
        postMessage: (message, transfer) => port2.postMessage(message, transfer as never),
        addEventListener: (type, listener) => port2.addEventListener(type, ((event: MessageEvent) => {
          if (type === "message" && event.data.type === "ready") ready++;
          (listener as (event: MessageEvent) => void)(event);
        }) as never),
        terminate() {
          if (stopped) return;
          stopped = true; live--; terminated++;
          port1.close(); port2.close();
        },
      };
    },
  };
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

Deno.test("ホームが一覧を作り、開く・詳しく・戻るで一つずつ Worker が動く", async () => {
  const window = new Window(); const element = elementIn(window); const worker = workers();
  const errors: unknown[] = []; const store = createMemoryAppStore();
  const shell = await mountShell(element, { apps: [homeApp, ...apps], store, parser, libraries, createWorker: worker.createWorker, onError: (e) => errors.push(e) });
  try {
    const tiles = element.querySelectorAll<HTMLButtonElement>(".home-tile");
    assertEquals([...tiles].map((t) => t.textContent), ["設定", "設定の写し"]);
    assertEquals(element.querySelector("svg"), null);
    assertEquals(tiles[0]!.querySelector("img")!.getAttribute("src"), `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fixtures[0]!.icon!)}`);
    assertEquals(element.querySelector<HTMLElement>(".bina-shell-toolbar")!.hidden, true);
    tiles[0]!.click(); tiles[1]!.click();
    // 起動中のクリックは捨てられるので、設定の起動（ready）を受けて mountApp が続きを終えてから押す
    await waitFor(() => worker.ready === 2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(element.querySelector(".home-grid"), null);
    assertEquals(element.querySelector<HTMLElement>(".bina-shell-toolbar")!.hidden, false);
    element.querySelector<HTMLButtonElement>("[bina-on-click=showDetails]")!.click();
    await waitFor(() => element.querySelector("[bina=description]")?.textContent === "ブラウザだけで動く、アプリの土台です。");
    element.querySelector<HTMLButtonElement>(".bina-shell-back")!.click();
    await waitFor(() => element.querySelectorAll(".home-tile").length === 2);
    assertEquals(element.querySelector("[bina=description]"), null);
    assertEquals(worker.created, 3); assertEquals(worker.maximum, 1); assertEquals(worker.live, 1);
    assertEquals(errors, []);
    shell.stop(); shell.stop();
    assertEquals(worker.live, 0); assertEquals(element.childNodes.length, 0);
  } finally { shell.stop(); await window.happyDOM.close(); }
});

Deno.test("read は同じ版を再ビルドせず、版が変われば保存し直す", async () => {
  const window = new Window(); const element = elementIn(window); const store = await savedStore(); const worker = workers();
  const asc = await loadCompiler(); let builds = 0;
  const compiler: Compiler = { ...asc, main(argv, options) { builds++; return asc.main(argv, options); } };
  const cached = apps.map((app) => ({ ...app, async read(path: string) { assertEquals(path, "app.json"); return await app.read(path); } }));
  let shell = await mountShell(element, { apps: [homeApp, ...cached], store, compiler, createWorker: worker.createWorker });
  try {
    assertEquals(builds, 0); assertEquals(element.querySelectorAll(".home-tile").length, 2);
    shell.stop();
    const app = apps[0]!;
    shell = await mountShell(element, { apps: [homeApp, { ...app, async read(path) {
      const text = await app.read(path); return path === "app.json" ? JSON.stringify({ ...JSON.parse(text), version: "0.2.0" }) : text;
    } }], store, compiler, libraries, parser, createWorker: worker.createWorker });
    assertEquals(builds, 1); assertEquals((await store.get(fixtures[0]!.key))!.manifest.version, "0.2.0");
  } finally { shell.stop(); await window.happyDOM.close(); }
});

Deno.test("prebuilt は compiler を使わず毎回保存し、installedAt を保つ", async () => {
  const window = new Window(); const element = elementIn(window); const store = await savedStore(); const worker = workers();
  const compiler: Compiler = { main() { throw new Error("ビルド不要"); }, createMemoryStream() { throw new Error("ビルド不要"); } };
  const fixture = fixtures[0]!; const changed = { ...fixture, html: "更新した HTML", manifest: { ...fixture.manifest, version: "0.3.0" } };
  const shell = await mountShell(element, { apps: [homeApp, { source: fixture.source, prebuilt: changed }], store, compiler, createWorker: worker.createWorker });
  try {
    const saved = (await store.get(fixture.key))!;
    assertEquals(saved.html, changed.html); assertEquals(saved.manifest.version, "0.3.0"); assertEquals(saved.installedAt, 1);
  } finally { shell.stop(); await window.happyDOM.close(); }
});

Deno.test("読み込み・保存の失敗があっても残りを渡し、重複は並べない", async () => {
  const window = new Window(); const element = elementIn(window); const store = await savedStore(); const worker = workers(); const errors: unknown[] = [];
  const shell = await mountShell(element, { apps: [homeApp, { source: "bad", read: () => Promise.resolve("{") }, ...apps, apps[1]!],
    store: { ...store, get(key) { return key === fixtures[0]!.key ? Promise.reject(new Error("保存失敗")) : store.get(key); } },
    createWorker: worker.createWorker, onError: (e) => errors.push(e) });
  try {
    assertEquals(errors.length, 2); assertEquals(element.querySelector<HTMLElement>("[role=status]")!.hidden, false); assertEquals(element.querySelectorAll(".home-tile").length, 1);
    assertEquals(element.querySelector(".home-tile")!.textContent, "設定の写し");
  } finally { shell.stop(); await window.happyDOM.close(); }
});

Deno.test("ホームは system かつ role home の最初のもの。別のホームも一覧に含めない", async () => {
  const window = new Window(); const element = elementIn(window); const worker = workers();
  const second = { source: "binette:system", prebuilt: { ...builtHome, manifest: { ...builtHome.manifest, id: "second" }, html: "別のホーム" } };
  const shell = await mountShell(element, { apps: [homeApp, second, { source: fixtures[0]!.source, prebuilt: fixtures[0]! }], store: createMemoryAppStore(), createWorker: worker.createWorker });
  try { assertEquals(element.querySelectorAll(".home-tile").length, 1); }
  finally { shell.stop(); await window.happyDOM.close(); }
});

Deno.test("ホームが無い・system でないと画面と onError に知らせる", async () => {
  for (const source of ["elsewhere", "binette:system"]) {
    const window = new Window(); const element = elementIn(window); const errors: unknown[] = [];
    const prebuilt = source === "elsewhere" ? builtHome : fixtures[0]!;
    const shell = await mountShell(element, { apps: [{ source, prebuilt }], store: createMemoryAppStore(), onError: (e) => errors.push(e) });
    try { assertEquals(errors.length, 1); assertEquals(element.querySelector("[role=status]")!.textContent, "ホームのシステムアプリがありません。"); }
    finally { shell.stop(); await window.happyDOM.close(); }
  }
});

Deno.test("フォルダ外の icon は読まずに拒む", async () => {
  const window = new Window(); const element = elementIn(window); const reads: string[] = []; const errors: unknown[] = []; const worker = workers(); const app = apps[0]!;
  const shell = await mountShell(element, { apps: [homeApp, { source: app.source, async read(path) {
    reads.push(path); const text = await app.read(path); return path === "app.json" ? JSON.stringify({ ...JSON.parse(text), icon: "../secret.svg" }) : text;
  } }], store: createMemoryAppStore(), parser, libraries, createWorker: worker.createWorker, onError: (e) => errors.push(e) });
  try { assertEquals(reads, ["app.json"]); assertEquals(errors.length, 1); assertEquals(element.querySelectorAll(".home-tile").length, 0); }
  finally { shell.stop(); await window.happyDOM.close(); }
});

Deno.test("名前と SVG は HTML として差し込まない", async () => {
  const window = new Window(); const element = elementIn(window); const store = await savedStore(); const worker = workers();
  const app = structuredClone(fixtures[0]!); app.manifest.name = '<img src=x onerror="alert(1)">'; app.icon = '<svg><script>alert(1)</script></svg>'; await store.put(app);
  const shell = await mountShell(element, { apps: [homeApp, apps[0]!], store, createWorker: worker.createWorker });
  try {
    const tile = element.querySelector(".home-tile")!; assertEquals(tile.textContent, app.manifest.name);
    assertEquals(tile.querySelectorAll("img").length, 1); assertEquals(tile.querySelector("script"), null);
    assertEquals(tile.querySelector("img")!.getAttribute("src"), `data:image/svg+xml;charset=utf-8,${encodeURIComponent(app.icon)}`);
  } finally { shell.stop(); await window.happyDOM.close(); }
});

for (const action of ["back", "stop"] as const) for (const phase of ["ready", "resolved", "start"] as const) {
  Deno.test(`${phase} 待ちの ${action} で遅い描画を残さない`, async () => {
    const window = new Window(); const element = elementIn(window); const worker = heldWorker(); const good = workers(); const errors: unknown[] = []; let count = 0;
    const shell = await mountShell(element, { apps: [homeApp, apps[0]!], store: await savedStore(), createWorker() { return ++count === 2 ? worker.createWorker() : good.createWorker(); }, onError: (e) => errors.push(e) });
    try {
      element.querySelector<HTMLButtonElement>(".home-tile")!.click(); await waitFor(() => count === 2);
      assertEquals(Object.hasOwn(worker.messages[0] as object, "apps"), false);
      if (phase === "resolved") worker.emit({ type: "ready", exports: [] });
      if (phase === "start") { worker.emit({ type: "ready", exports: ["start"] }); await waitFor(() => worker.messages.length === 2); }
      if (action === "stop") shell.stop(); else element.querySelector<HTMLButtonElement>(".bina-shell-back")!.click();
      assertEquals(worker.terminated, 1);
      worker.emit({ type: "ready", exports: ["start"] }); worker.emit({ type: "text", name: "description", value: "遅い表示" }); worker.emit({ type: "done", id: 1 });
      if (action === "back") await waitFor(() => element.querySelectorAll(".home-tile").length === 1);
      assertEquals(element.querySelector("[bina=description]"), null); assertEquals(errors, []);
    } finally { shell.stop(); await window.happyDOM.close(); }
  });
}

Deno.test("起動失敗でホームを開き直して知らせる", async () => {
  const window = new Window(); const element = elementIn(window); const good = workers(); const bad = heldWorker(); const errors: unknown[] = []; let count = 0;
  const shell = await mountShell(element, { apps: [homeApp, apps[0]!], store: await savedStore(), createWorker() { return ++count === 2 ? bad.createWorker() : good.createWorker(); }, onError: (e) => errors.push(e) });
  try {
    element.querySelector<HTMLButtonElement>(".home-tile")!.click(); await waitFor(() => count === 2); bad.emit({ type: "failed", message: "起動の失敗" });
    await waitFor(() => errors.length === 1 && element.querySelectorAll(".home-tile").length === 1);
    assertEquals(bad.terminated, 1); assertEquals(good.maximum, 1);
    assertEquals(element.querySelector<HTMLElement>("[role=status]")!.hidden, false);
  } finally { shell.stop(); await window.happyDOM.close(); }
});

for (const phase of ["resolved", "start", "mounted"] as const) {
  Deno.test(phase + " のアプリ終了でホームへ戻り一度だけ知らせる", async () => {
    const window = new Window(); const element = elementIn(window); const good = workers(); const bad = heldWorker();
    const errors: unknown[] = []; let count = 0;
    const shell = await mountShell(element, { apps: [homeApp, apps[0]!], store: await savedStore(),
      createWorker() { return ++count === 2 ? bad.createWorker() : good.createWorker(); }, onError: e => errors.push(e) });
    try {
      element.querySelector<HTMLButtonElement>(".home-tile")!.click(); await waitFor(() => count === 2);
      bad.emit({ type: "ready", exports: phase === "start" ? ["start"] : ["showDetails"] });
      if (phase === "start") await waitFor(() => bad.messages.length === 2);
      if (phase === "mounted") {
        await new Promise(resolve => setTimeout(resolve, 0));
        element.querySelector<HTMLButtonElement>("[bina-on-click=showDetails]")!.click();
        await waitFor(() => bad.messages.length === 2);
      }
      bad.emit({ type: "fail", id: 1, message: "実行の失敗", exit: true });
      await waitFor(() => errors.length === 1 && element.querySelectorAll(".home-tile").length === 1);
      assertEquals((errors[0] as Error).message, "実行の失敗");
      assertEquals(element.querySelector("[role=status]")!.textContent, "実行の失敗");
      assertEquals(bad.terminated, 1); assertEquals(count, 3);
    } finally { shell.stop(); await window.happyDOM.close(); }
  });
}

Deno.test("ホーム自身の終了では開き直さない", async () => {
  const window = new Window(); const element = elementIn(window); const bad = heldWorker(); const errors: unknown[] = []; let count = 0;
  const mounting = mountShell(element, { apps: [homeApp], store: createMemoryAppStore(),
    createWorker() { count++; return bad.createWorker(); }, onError: e => errors.push(e) });
  await waitFor(() => count === 1);
  bad.emit({ type: "ready", exports: [] });
  const shell = await mounting;
  try {
    bad.emit({ type: "fail", id: 1, message: "ホームの失敗", exit: true });
    await waitFor(() => errors.length === 1);
    assertEquals(count, 1); assertEquals(bad.terminated, 1);
    assertEquals(element.querySelector(".bina-shell-app"), null);
    assertEquals(element.querySelector("[role=status]")!.textContent, "ホームの失敗");
  } finally { shell.stop(); await window.happyDOM.close(); }
});
