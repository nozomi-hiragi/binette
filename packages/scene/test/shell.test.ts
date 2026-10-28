import { assert, assertEquals } from "@std/assert";
import { createMemoryAppStore, installedAppKey, type AppStore, type InstalledApp, type RegieWorker, type BinetteSystem, serveApp } from "@binette/regie";
import { Window } from "happy-dom";
import { buildApp, mountShell, createShellUi } from "../src/index.ts";

const root = new URL("../../..", import.meta.url);
const libraries = { "jsr:@binette/replique": await Deno.readTextFile(new URL("packages/replique/src/index.ts", root)) };
const apps = ["設定", "設定の写し"].map((name, index) => ({
  source: "binette:system",
  async read(path: string): Promise<string> {
    const text = await Deno.readTextFile(new URL(`apps/settings/${path}`, root));
    return path === "app.json" ? JSON.stringify({ ...JSON.parse(text), id: `settings-${index}`, name }) : text;
  },
}));
const homeRead = { source: "binette:system", read: (path: string) => Deno.readTextFile(new URL(`apps/home/${path}`, root)) };
const builtHome = await buildApp(homeRead.read, { libraries });
const homeApp = { source: "binette:system", prebuilt: builtHome };
const fixtures: InstalledApp[] = [];
for (const app of apps) {
  const built = await buildApp(app.read, { libraries });
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
  // 回数ではなく経過時間で待つ。全体を並べて動かすと遅くなるため
  const deadline = performance.now() + 10000;
  while (!condition() && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
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

Deno.test("ホームが一覧を作り、ホームへ戻っても Worker と DOM が残る", async () => {
  const window = new Window(); const element = elementIn(window); const worker = workers();
  const errors: unknown[] = []; const store = createMemoryAppStore();
  const shell = await mountShell(element, { apps: [homeApp, ...apps], store, libraries, createWorker: worker.createWorker, onError: (e) => errors.push(e) });
  try {
    assertEquals(element.querySelector(".bina-shell-apps")!.children.length, 0);
    const tiles = element.querySelectorAll<HTMLButtonElement>(".home-tile");
    assertEquals([...tiles].map((t) => t.textContent), ["設定", "設定の写し"]);
    assertEquals(element.querySelector("svg"), null);
    assertEquals(tiles[0]!.querySelector("img")!.getAttribute("src"), `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fixtures[0]!.icon!)}`);
    assertEquals(element.querySelector<HTMLElement>(".bina-shell-homebar")!.hidden, false);
    tiles[0]!.click(); tiles[1]!.click();
    await waitFor(() => worker.ready === 2);
    await waitFor(() => element.querySelector<HTMLElement>(".home-grid")!.closest<HTMLElement>(".bina-shell-app")!.hidden === true);
    assertEquals(element.querySelector<HTMLElement>(".bina-shell-homebar")!.hidden, false);
    // #details は最初の HTML にあり、リスナーは onCreate で付く。付くまで押し直す（押しても同じ文字を書くだけ）
    await waitFor(() => {
      if (element.querySelector("#description")?.textContent === "ブラウザだけで動く、アプリの土台です。") return true;
      element.querySelector<HTMLButtonElement>("#details")!.click();
      return false;
    });
    element.querySelector<HTMLButtonElement>('[aria-label=ホームを開く]')!.click();
    await waitFor(() => !element.querySelector<HTMLElement>(".home-grid")!.closest<HTMLElement>(".bina-shell-app")!.hidden);
    assertEquals(element.querySelector("#description")!.textContent, "ブラウザだけで動く、アプリの土台です。");
    element.querySelector<HTMLButtonElement>('[aria-label="設定を開く"]')!.click();
    await waitFor(() => !element.querySelector<HTMLElement>("#description")!.closest<HTMLElement>(".bina-shell-app")!.hidden);
    assertEquals(worker.created, 2); assertEquals(worker.maximum, 2); assertEquals(worker.live, 2);
    assertEquals(errors, []);
    shell.stop(); shell.stop();
    assertEquals(worker.live, 0); assertEquals(element.childNodes.length, 0);
  } finally { shell.stop(); await window.happyDOM.close(); }
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

for (const action of ["back", "stop"] as const) for (const phase of ["ready", "resolved", "create"] as const) {
  Deno.test(`${phase} 待ちの ${action} で遅い描画を残さない`, async () => {
    const window = new Window(); const element = elementIn(window); const worker = heldWorker(); const good = workers(); const errors: unknown[] = []; let count = 0;
    const shell = await mountShell(element, { apps: [homeApp, apps[0]!], store: await savedStore(), createWorker() { return ++count === 2 ? worker.createWorker() : good.createWorker(); }, onError: (e) => errors.push(e) });
    try {
      element.querySelector<HTMLButtonElement>(".home-tile")!.click(); await waitFor(() => count === 2);
      assertEquals(Object.hasOwn(worker.messages[0] as object, "apps"), false);
      if (phase === "resolved") worker.emit({ type: "ready", exports: [] });
      if (phase === "create") { worker.emit({ type: "ready", exports: ["create"] }); await waitFor(() => worker.messages.length === 2); }
      if (action === "stop") shell.stop(); else element.querySelector<HTMLButtonElement>('[aria-label=ホームを開く]')!.click();
      await waitFor(() => worker.terminated === 1);
      worker.emit({ type: "ready", exports: ["create"] }); worker.emit({ type: "dom", ops: [{ op: "text", handle: 1, value: "遅い表示" }] }); worker.emit({ type: "done", id: 1 });
      if (action === "back") await waitFor(() => element.querySelectorAll(".home-tile").length === 1);
      assertEquals(element.querySelector("#description"), null); assertEquals(errors, []);
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

for (const phase of ["resolved", "create", "mounted"] as const) {
  Deno.test(phase + " のアプリ終了でホームへ戻り一度だけ知らせる", async () => {
    const window = new Window(); const element = elementIn(window); const good = workers(); const bad = heldWorker();
    const errors: unknown[] = []; let count = 0;
    const shell = await mountShell(element, { apps: [homeApp, apps[0]!], store: await savedStore(),
      createWorker() { return ++count === 2 ? bad.createWorker() : good.createWorker(); }, onError: e => errors.push(e) });
    try {
      element.querySelector<HTMLButtonElement>(".home-tile")!.click(); await waitFor(() => count === 2);
      bad.emit({ type: "ready", exports: phase === "create" ? ["create"] : ["showDetails"] });
      if (phase === "create") await waitFor(() => bad.messages.length === 2);
      if (phase === "mounted") {
        for (let id = 1; id <= 3; id++) {
          await waitFor(() => bad.messages.length === id + 1);
          bad.emit({ type: "done", id });
        }
        bad.emit({ type: "dom", ops: [{ op: "byId", handle: 1, id: "details" }, { op: "listen", handle: 1, type: "click", listener: 0 }] });
        await new Promise(resolve => setTimeout(resolve, 0));
        element.querySelector<HTMLButtonElement>("#details")!.click();
        await waitFor(() => bad.messages.length === 5);
      }
      bad.emit({ type: "fail", id: 1, message: "実行の失敗", exit: true });
      await waitFor(() => errors.length === 1 && element.querySelectorAll(".home-tile").length === 1);
      assertEquals((errors[0] as Error).message, "実行の失敗");
      assertEquals(element.querySelector("[role=status]")!.textContent, "実行の失敗");
      assertEquals(bad.terminated, 1); assertEquals(count, 2);
    } finally { shell.stop(); await window.happyDOM.close(); }
  });
}

Deno.test("ホーム自身の終了ではホームを開き直す", async () => {
  const window = new Window(); const element = elementIn(window); const bad = heldWorker(); const good = workers(); const errors: unknown[] = []; let count = 0;
  const mounting = mountShell(element, { apps: [homeApp], store: createMemoryAppStore(),
    createWorker() { return ++count === 1 ? bad.createWorker() : good.createWorker(); }, onError: e => errors.push(e) });
  await waitFor(() => count === 1);
  bad.emit({ type: "ready", exports: [] });
  for (let id = 1; id <= 3; id++) {
    await waitFor(() => bad.messages.length === id + 1);
    bad.emit({ type: "done", id });
  }
  const shell = await mounting;
  try {
    bad.emit({ type: "fail", id: 1, message: "ホームの失敗", exit: true });
    await waitFor(() => errors.length === 1);
    // 起動し直す前に少し待つ
    await waitFor(() => count === 2 && element.querySelector(".bina-shell-app") !== null);
    assertEquals(bad.terminated, 1);
    assertEquals(element.querySelector("[role=status]")!.textContent, "ホームの失敗");
  } finally { shell.stop(); await window.happyDOM.close(); }
});

Deno.test("ホームの起動失敗でもホームを開き直し、stop で再試行を止められる", async () => {
  for (const recover of [true, false]) {
    const window = new Window(); const element = elementIn(window); const good = workers(); const errors: unknown[] = []; let count = 0;
    const shell = await mountShell(element, { apps: [homeApp], store: createMemoryAppStore(), callTimeout: 20,
      createWorker() {
        count++;
        if (recover && count > 1) return good.createWorker();
        return heldWorker().createWorker();
      }, onError: error => errors.push(error) });
    try {
      if (recover) await waitFor(() => element.querySelector(".home-grid") !== null);
      else await waitFor(() => errors.length === 2);
      assert(count >= 2); assert((errors[0] as Error).message.includes("応答しない"));
      shell.stop();
      const stoppedAt = count; await new Promise(resolve => setTimeout(resolve, 40));
      assertEquals(count, stoppedAt); assertEquals(good.live, 0);
    } finally { shell.stop(); await window.happyDOM.close(); }
  }
});

Deno.test("ホームの起動失敗が続くと homeRetryWindow を過ぎて Apps を出す", async () => {
  const window = new Window(); const element = elementIn(window); const errors: unknown[] = [];
  const held: ReturnType<typeof heldWorker>[] = [];
  const mounting = mountShell(element, { apps: [homeApp], store: createMemoryAppStore(), homeRetryWindow: 40,
    createWorker() { const worker = heldWorker(); held.push(worker); return worker.createWorker(); }, onError: error => errors.push(error) });
  await waitFor(() => held[0]?.messages.length === 1);
  const firstFailure = performance.now();
  held[0]!.emit({ type: "failed", message: "ホームの起動失敗" });
  const shell = await mounting;
  try {
    let failed = 1;
    await waitFor(() => {
      if (element.querySelector<HTMLElement>(".bina-shell-apps")?.hidden === false) return true;
      if (held[failed]?.messages.length === 1) held[failed++]!.emit({ type: "failed", message: "ホームの起動失敗" });
      return false;
    });
    assert(performance.now() - firstFailure >= 40);
    assert(held.length >= 2); assertEquals(errors.length, held.length);
    assertEquals(element.querySelectorAll(".bina-shell-app").length, 0);
    assertEquals(element.querySelector<HTMLElement>("[role=status]")!.hidden, false);
    assertEquals(element.querySelector("[role=status]")!.textContent, "ホームの起動失敗");
  } finally { shell.stop(); await window.happyDOM.close(); }
});

Deno.test("動作中のホームが落ち続けると Apps を出し、ホームボタンで時間を数え直す", async () => {
  const window = new Window(); const element = elementIn(window); const errors: unknown[] = [];
  const held: ReturnType<typeof heldWorker>[] = []; const store = createMemoryAppStore();
  let resumed = 0;
  const mounting = mountShell(element, { apps: [homeApp], homeRetryWindow: 80,
    store: { ...store, system: { ...store.system, async putLast(key, record) {
      await store.system.putLast(key, record);
      if (record.state === 3 && record.done) resumed++;
    } } },
    createWorker() { const worker = heldWorker(); held.push(worker); return worker.createWorker(); }, onError: error => errors.push(error) });
  const boot = async (index: number) => {
    await waitFor(() => held[index]?.messages.length === 1);
    const worker = held[index]!;
    worker.emit({ type: "ready", exports: [] });
    for (let id = 1; id <= 3; id++) {
      await waitFor(() => worker.messages.length === id + 1);
      worker.emit({ type: "done", id });
    }
    await waitFor(() => resumed === index + 1);
  };
  await boot(0);
  const shell = await mounting;
  try {
    for (let cycle = 0; cycle < 2; cycle++) {
      const index = cycle * 2;
      if (cycle) {
        element.querySelector<HTMLButtonElement>('[aria-label=ホームを開く]')!.click();
        await boot(index);
        assertEquals(element.querySelector<HTMLElement>(".bina-shell-apps")!.hidden, true);
      }
      held[index]!.emit({ type: "fail", id: 3, message: "ホームの失敗", exit: true });
      const failedAt = performance.now();
      await waitFor(() => held.length === index + 2);
      // 次のホームを起動し終える前に、最初の落ちからの時間を過ごす
      await waitFor(() => performance.now() - failedAt >= 80);
      await boot(index + 1);
      held[index + 1]!.emit({ type: "fail", id: 3, message: "ホームの失敗", exit: true });
      await waitFor(() => element.querySelector<HTMLElement>(".bina-shell-apps")!.hidden === false);
      assertEquals(held.length, index + 2);
      assertEquals(errors.length, index + 2);
      assertEquals(element.querySelector("[role=status]")!.textContent, "ホームの失敗");
    }
  } finally { shell.stop(); await window.happyDOM.close(); }
});

Deno.test("Apps は名前を文字コード順に安全に並べ、ホーム候補を含めない", async () => {
  const window = new Window(); const element = elementIn(window);
  const names = ["設定", "a", "Z", '<img src=x onerror="alert(1)">', "A", "あ"];
  const listing = names.map((name, i) => ({ source: "binette:system", prebuilt: { ...fixtures[0]!, manifest: { ...fixtures[0]!.manifest, id: `app-${i}`, name } } }));
  const other = { source: "elsewhere", prebuilt: { ...builtHome, manifest: { ...builtHome.manifest, id: "other", name: "別のホーム" } } };
  const shell = await mountShell(element, { apps: [homeApp, ...listing, other], store: createMemoryAppStore(), homeRetryWindow: 0,
    createWorker() { throw new Error("ホームの起動失敗"); } });
  try {
    const host = element.querySelector<HTMLElement>(".bina-shell-apps")!;
    assertEquals(host.hidden, false);
    assertEquals(host.parentElement, element.querySelector(".bina-shell-stage"));
    assertEquals(host.closest(".bina-shell-app"), null);
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
    assertEquals(buttons.map(button => button.textContent), ['<img src=x onerror="alert(1)">', "A", "Z", "a", "あ", "設定"]);
    assertEquals(host.children.length, names.length);
    for (const button of buttons) {
      assertEquals(button.type, "button"); assertEquals(button.getAttribute("aria-label"), `${button.textContent}を開く`);
      assertEquals(button.children.length, 0);
    }
    assertEquals(element.querySelector(".bina-shell-homebar")!.textContent, "ホームインストール");
    shell.stop(); assertEquals(element.children.length, 0);
  } finally { shell.stop(); await window.happyDOM.close(); }
});

for (const action of ["close", "finish", "crash", "startup"] as const) {
  Deno.test(`Apps から開いて ${action} したら Apps に戻り、スタックには数えない`, async () => {
    const window = new Window(); const element = elementIn(window); const good = workers(); const bad = heldWorker(); const errors: unknown[] = []; let count = 0;
    const shell = await mountShell(element, { apps: [homeApp, { source: fixtures[0]!.source, prebuilt: fixtures[0]! }], store: createMemoryAppStore(), stackSize: 1, homeRetryWindow: 0,
      createWorker() {
        count++;
        if (count === 1) throw new Error("ホームの起動失敗");
        return action === "close" ? good.createWorker() : bad.createWorker();
      }, onError: error => errors.push(error) });
    try {
      const host = element.querySelector<HTMLElement>(".bina-shell-apps")!;
      host.querySelector<HTMLButtonElement>("button")!.click();
      await waitFor(() => count === 2);
      assertEquals(host.hidden, true);
      if (action === "close") {
        await waitFor(() => element.querySelectorAll(".settings-row").length === 6);
        assertEquals(good.live, 1); assertEquals(good.terminated, 0);
        assertEquals(element.querySelector(".bina-shell-homebar")!.textContent, "ホーム設定×インストール");
        element.querySelector<HTMLButtonElement>('[aria-label="設定を閉じる"]')!.click();
      } else if (action === "startup") bad.emit({ type: "failed", message: "アプリの起動失敗" });
      else {
        bad.emit({ type: "ready", exports: [] });
        for (let id = 1; id <= 3; id++) {
          await waitFor(() => bad.messages.length === id + 1);
          if (id === 3 && action === "finish") bad.emit({ type: "finish" });
          bad.emit({ type: "done", id });
        }
        if (action === "crash") bad.emit({ type: "fail", id: 3, message: "アプリの失敗", exit: true });
        else {
          for (let id = 4; id <= 6; id++) {
            await waitFor(() => bad.messages.length === id + 1);
            bad.emit({ type: "done", id });
          }
        }
      }
      await waitFor(() => !host.hidden && element.querySelector(".bina-shell-app") === null);
      assertEquals(count, 2); assertEquals(element.querySelector(".bina-shell-homebar")!.textContent, "ホームインストール");
      assertEquals(errors.length, action === "startup" || action === "crash" ? 2 : 1);
    } finally { shell.stop(); await window.happyDOM.close(); }
  });
}

Deno.test("Apps から開いたアプリの背面でもホームを再試行でき、成功後はホームに戻る", async () => {
  const window = new Window(); const element = elementIn(window); const good = workers(); let count = 0;
  const store = createMemoryAppStore(); let resumed = 0;
  const shell = await mountShell(element, { apps: [homeApp, { source: fixtures[0]!.source, prebuilt: fixtures[0]! }], homeRetryWindow: 0,
    store: { ...store, system: { ...store.system, async putLast(key, record) {
      await store.system.putLast(key, record);
      if (record.state === 3 && record.done) resumed++;
    } } },
    createWorker() { if (++count === 1) throw new Error("ホームの起動失敗"); return good.createWorker(); } });
  try {
    const host = element.querySelector<HTMLElement>(".bina-shell-apps")!;
    host.querySelector<HTMLButtonElement>("button")!.click();
    await waitFor(() => resumed === 1);
    assertEquals(host.hidden, true);
    element.querySelector<HTMLButtonElement>('.bina-shell-homebar [aria-label=ホームを開く]')!.click();
    await waitFor(() => resumed === 2);
    element.querySelector<HTMLButtonElement>('.bina-shell-homebar [aria-label="設定を開く"]')!.click();
    await waitFor(() => !element.querySelector<HTMLElement>("#debug")!.closest<HTMLElement>(".bina-shell-app")!.hidden);
    element.querySelector<HTMLButtonElement>('[aria-label="設定を閉じる"]')!.click();
    await waitFor(() => element.querySelector("#debug") === null && !element.querySelector<HTMLElement>(".home-grid")!.closest<HTMLElement>(".bina-shell-app")!.hidden);
    assertEquals(host.hidden, true); assertEquals(count, 3); assertEquals(good.live, 1);
  } finally { shell.stop(); await window.happyDOM.close(); }
});

Deno.test("os は system の role settings だけに渡し、ほかのアプリが呼ぶと終了する", async () => {
  for (const [source, role] of [["elsewhere", "settings"], ["binette:system", undefined]]) {
    const window = new Window(); const element = elementIn(window); const worker = workers(); const errors: unknown[] = [];
    const fixture = fixtures[0]!;
    const app = { source: source!, prebuilt: { ...fixture, manifest: { ...fixture.manifest, role } } };
    const shell = await mountShell(element, { apps: [homeApp, app], store: createMemoryAppStore(), createWorker: worker.createWorker, onError: e => errors.push(e) });
    try {
      element.querySelector<HTMLButtonElement>(".home-tile")!.click();
      await waitFor(() => errors.length === 1);
      assert((errors[0] as Error).message.includes("システムの設定アプリだけ"));
      assertEquals(worker.terminated, 1);
      assertEquals(element.querySelectorAll("#debug").length, 0);
      assertEquals(element.querySelector<HTMLElement>(".bina-shell-app")!.hidden, false);
    } finally { shell.stop(); await window.happyDOM.close(); }
  }
});

Deno.test("実際の設定の − ＋ は範囲で止まり、保存し、次の起動でスタックと履歴の上限が効く", async () => {
  const window = new Window(); const element = elementIn(window); const worker = workers(); const store = createMemoryAppStore(); const errors: unknown[] = [];
  await store.system.putSettings({ stackSize: 2, stopDelay: 0, historyLimit: 0, callTimeout: 1000, destroyTimeout: 1000, homeRetryWindow: 0 });
  const options = { apps: [homeApp, ...apps], store, libraries, createWorker: worker.createWorker, onError: (e: unknown) => errors.push(e) };
  let shell = await mountShell(element, options);
  try {
    element.querySelector<HTMLButtonElement>(".home-tile")!.click();
    await waitFor(() => element.querySelectorAll(".settings-row").length === 6);
    const rows = element.querySelectorAll<HTMLElement>(".settings-row");
    const value = (i: number) => rows[i]!.querySelector(".settings-value")!.textContent;
    const click = (i: number, direction: number) => rows[i]!.querySelectorAll<HTMLButtonElement>("button")[direction]!.click();
    for (let i = 0; i < 6; i++) click(i, 0);
    // クリックは順に処理されるので、最後の行が変われば全部済んでいる
    await waitFor(() => value(5) === "0 秒");
    for (let i = 0; i < 6; i++) click(i, 0);
    await new Promise(resolve => setTimeout(resolve, 20));
    assertEquals([...rows].map((_, i) => value(i)), ["1", "0 秒", "0", "1 秒", "1 秒", "0 秒"]);
    assertEquals(worker.live, 2);
    for (let i = 0; i < 6; i++) click(i, 1);
    await waitFor(() => value(5) === "1 秒");
    assertEquals([...rows].map((_, i) => value(i)), ["2", "1 秒", "10", "2 秒", "2 秒", "1 秒"]);
    // stackSize を 1 に戻しても、その場ではホームを捨てない
    click(0, 0);
    await waitFor(() => value(0) === "1");
    await waitFor(() => worker.live === 2);
    element.querySelector<HTMLButtonElement>('[aria-label=ホームを開く]')!.click();
    await waitFor(() => !element.querySelector<HTMLElement>(".home-grid")!.closest<HTMLElement>(".bina-shell-app")!.hidden);
    element.querySelectorAll<HTMLButtonElement>(".home-tile")[1]!.click();
    await waitFor(() => worker.created === 3 && worker.live === 1);
    assertEquals((await store.system.listLaunches()).length, 1);
    await waitFor(() => errors.length === 0);
    shell.stop();
    const saved = (await store.system.getSettings())!;
    assertEquals(saved, { home: "", stackSize: 1, stopDelay: 1000, historyLimit: 10, callTimeout: 2000, destroyTimeout: 2000, homeRetryWindow: 1000 });
    shell = await mountShell(element, options);
    element.querySelector<HTMLButtonElement>(".home-tile")!.click();
    await waitFor(() => element.querySelectorAll(".settings-row").length === 6 && worker.live === 1);
    assertEquals([...element.querySelectorAll(".settings-value")].map(node => node.textContent), ["1", "1 秒", "10", "2 秒", "2 秒", "1 秒"]);
    assertEquals(errors, []);
  } finally { shell.stop(); await window.happyDOM.close(); }
});

Deno.test("設定した Stop までの時間は、残っているインスタンスの次の Pause から効く", async () => {
  const window = new Window(); const element = elementIn(window); const worker = workers(); const store = createMemoryAppStore();
  const shell = await mountShell(element, { apps: [homeApp, apps[0]!], store, libraries, createWorker: worker.createWorker, stopDelay: 1000 });
  const key = installedAppKey(homeApp.source, builtHome.manifest.id);
  try {
    element.querySelector<HTMLButtonElement>(".home-tile")!.click();
    await waitFor(() => element.querySelectorAll(".settings-row").length === 6);
    element.querySelectorAll<HTMLElement>(".settings-row")[1]!.querySelector<HTMLButtonElement>("button")!.click();
    await waitFor(() => element.querySelectorAll(".settings-value")[1]!.textContent === "0 秒");
    await new Promise(resolve => setTimeout(resolve, 30));
    assertEquals((await store.system.getLast(key))!.state, 4);
    element.querySelector<HTMLButtonElement>('[aria-label=ホームを開く]')!.click();
    await waitFor(() => !element.querySelector<HTMLElement>(".home-grid")!.closest<HTMLElement>(".bina-shell-app")!.hidden);
    element.querySelector<HTMLButtonElement>(".home-tile")!.click();
    await waitFor(() => !element.querySelector<HTMLElement>("#debug")!.closest<HTMLElement>(".bina-shell-app")!.hidden);
    await waitFor(() => worker.live === 2);
    const deadline = performance.now() + 10000;
    while ((await store.system.getLast(key))?.state !== 5 && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assertEquals((await store.system.getLast(key))!.state, 5);
  } finally { shell.stop(); await window.happyDOM.close(); }
});

Deno.test("ホームの選択を保存し、前のホームを User・Os で Destroy し、次のホームに apps を渡す", async () => {
  const window = new Window(); const element = elementIn(window); const worker = workers(); const store = createMemoryAppStore();
  const other = { source: "elsewhere", prebuilt: { ...builtHome, manifest: { ...builtHome.manifest, id: "other-home", name: "別のホーム" } } };
  const otherKey = installedAppKey(other.source, other.prebuilt.manifest.id);
  const options = { apps: [homeApp, ...apps, other], store, libraries, createWorker: worker.createWorker };
  let shell = await mountShell(element, options);
  try {
    element.querySelector<HTMLButtonElement>(".home-tile")!.click();
    await waitFor(() => element.querySelectorAll("#homes button").length === 2);
    assertEquals(element.querySelector("#homes button")!.textContent, "ホーム（使用中）");
    element.querySelectorAll<HTMLButtonElement>("#homes button")[1]!.click();
    await waitFor(() => element.querySelectorAll("#homes button")[1]!.textContent === "別のホーム（使用中）" && worker.live === 1);
    assertEquals((await store.system.getSettings())!.home, otherKey);
    const old = (await store.system.getLast(installedAppKey(homeApp.source, builtHome.manifest.id)))!;
    assertEquals({ state: old.state, done: old.done, reason: old.reason }, { state: 6, done: true, reason: { kind: 0, cause: 0 } });
    element.querySelector<HTMLButtonElement>('[aria-label=ホームを開く]')!.click();
    await waitFor(() => element.querySelectorAll(".home-tile").length === 2);
    assertEquals((await store.system.listLaunches()).at(-1)!.app, otherKey);
    element.querySelector<HTMLButtonElement>(".home-tile")!.click();
    await waitFor(() => !element.querySelector<HTMLElement>("#homes")!.closest<HTMLElement>(".bina-shell-app")!.hidden);
    element.querySelector<HTMLButtonElement>('[aria-label="設定を閉じる"]')!.click();
    await waitFor(() => element.querySelector("#homes") === null && !element.querySelector<HTMLElement>(".home-grid")!.closest<HTMLElement>(".bina-shell-app")!.hidden);
    assertEquals((await store.system.listLaunches()).at(-1)!.app, otherKey);
    shell.stop();
    // 今回の apps に無くても、保存済みのホームを選べる
    shell = await mountShell(element, { ...options, apps: [homeApp, ...apps] });
    assertEquals((await store.system.listLaunches()).at(-1)!.app, otherKey);
    assertEquals(element.querySelectorAll(".home-tile").length, 2);
  } finally { shell.stop(); await window.happyDOM.close(); }
});

Deno.test("実際の設定は履歴を新しい順に UTC の日時と名前で表示する", async () => {
  const window = new Window(); const element = elementIn(window); const worker = workers(); const store = createMemoryAppStore();
  const times = [-1, 0, Date.UTC(2000, 1, 29, 12, 34, 56), Date.UTC(2100, 2, 1)];
  for (const time of times) await store.system.recordLaunch({ time, app: "無いアプリの識別子" });
  const shell = await mountShell(element, { apps: [homeApp, apps[0]!], store, libraries, createWorker: worker.createWorker });
  try {
    element.querySelector<HTMLButtonElement>(".home-tile")!.click();
    await waitFor(() => element.querySelectorAll("#history li").length === 5);
    const lines = [...element.querySelectorAll("#history li")].map(node => node.textContent!);
    assert(lines[0]!.endsWith(" ホーム"));
    assertEquals(lines.slice(1), ["2100-03-01 00:00:00 無いアプリの識別子", "2000-02-29 12:34:56 無いアプリの識別子", "1970-01-01 00:00:00 無いアプリの識別子", "1969-12-31 23:59:59 無いアプリの識別子"]);
  } finally { shell.stop(); await window.happyDOM.close(); }
});

Deno.test("os.set の範囲外と知らない名前は false になり、SystemStore に保存しない", async () => {
  const files: Record<string, string> = {
    "app.json": JSON.stringify({ id: "bad-settings", name: "検査用設定", role: "settings", entry: { html: "index.html", as: "main.ts" } }),
    "index.html": '<p id="checked"></p>',
    "main.ts": `import { App, Last, document, launch, os } from "jsr:@binette/replique";
class Settings extends App {
  onCreate(_last: Last): void {
    assert(!os.set("unknown", 1)); assert(!os.set("home", 1)); assert(!os.set("stackSize", 0));
    assert(!os.set("historyLimit", -1)); assert(!os.set("stopDelay", -1)); assert(!os.set("homeRetryWindow", -1));
    assert(!os.set("callTimeout", 999)); assert(!os.set("destroyTimeout", 999));
    assert(os.get("stackSize") == 3);
    document.getElementById("checked").textContent = "確認済み";
  }
}
launch(new Settings());`,
  };
  const built = await buildApp(path => Promise.resolve(files[path]!), { libraries });
  const window = new Window(); const element = elementIn(window); const worker = workers(); const store = createMemoryAppStore(); const writes: unknown[] = []; const errors: unknown[] = [];
  const shell = await mountShell(element, { apps: [homeApp, { source: "binette:system", prebuilt: built }],
    store: { ...store, system: { ...store.system, putSettings(settings) { writes.push(settings); return store.system.putSettings(settings); } } },
    createWorker: worker.createWorker, onError: e => errors.push(e) });
  try {
    element.querySelector<HTMLButtonElement>(".home-tile")!.click();
    await waitFor(() => element.querySelector("#checked")?.textContent === "確認済み");
    assertEquals(writes, []); assertEquals(await store.system.getSettings(), undefined); assertEquals(errors, []);
  } finally { shell.stop(); await window.happyDOM.close(); }
});

Deno.test("createShellUi は bind 前のボタンを無視し、bind で現在のページを一度知らせる", async () => {
  const window = new Window(); const element = elementIn(window);
  Object.defineProperty(window.document, "visibilityState", { configurable: true, value: "hidden" });
  const pages: { visible: boolean; frozen: boolean }[] = [];
  let opened = 0;
  const system: BinetteSystem = {
    async openHome() { opened++; }, async open() {}, async close() {},
    setPage(page) { pages.push(page); }, stop() {},
  };
  const ui = createShellUi(element, { installed: true });
  try {
    const home = () => element.querySelector<HTMLButtonElement>("[aria-label=ホームを開く]")!.click();
    home();
    assertEquals(opened, 0); assertEquals(pages, []);
    window.document.dispatchEvent(new window.Event("freeze"));
    ui.bind(system);
    assertEquals(pages, [{ visible: false, frozen: true }]);
    home(); assertEquals(opened, 1);
    window.document.dispatchEvent(new window.Event("resume"));
    assertEquals(pages.at(-1), { visible: false, frozen: false });
    ui.stop();
    window.document.dispatchEvent(new window.Event("visibilitychange"));
    assertEquals(pages.length, 2); assertEquals(element.children.length, 0);
  } finally { ui.stop(); await window.happyDOM.close(); }
});
