import { readRepliqueLibraries } from "../../regie/src/cli.ts";
import { assert, assertEquals } from "@std/assert";
import { buildApp } from "@binette/regie/build";
import { appId, createMemoryAppStore, serveApp, type RegieWorker } from "@binette/regie";
import { Window } from "happy-dom";
import { mountShell } from "../src/index.ts";

const root = new URL("../../..", import.meta.url);
const libraries = { ...await readRepliqueLibraries(new URL("packages/replique/", root)) };
const apps = await Promise.all(["cadre"].map(async name => {
  const read = (path: string) => Deno.readTextFile(new URL(`apps/${name}/${path}`, root));
  const built = await buildApp(read, { libraries });
  // ドックの試験では、ホームのタイルを設定とアイコンなしの 2 つにする
  const sub = built.manifest.sub ? { ...built.manifest.sub, apps: { ...built.manifest.sub.apps!, listed: false } } : undefined;
  built.manifest = { ...built.manifest, sub };
  return { source: "binette:system", prebuilt: { ...built, ...(built.manifest.sub ? { subIcons: Object.fromEntries(await Promise.all(Object.entries(built.manifest.sub).map(async ([id, sub]) => [id, sub.icon ? await read(sub.icon) : ""]))) } : {}), icon: built.manifest.icon ? await read(built.manifest.icon) : undefined } };
}));
const plain = await buildApp(path => Promise.resolve(path === "app.json"
  ? JSON.stringify({ id: "plain", name: "アイコンなし", version: "0.1.0", binette: "0.2", entry: { as: "main.ts" } })
  : 'import { App, launch } from "jsr:@binette/replique"; import { text, View } from "jsr:@binette/replique-ui@^0.1"; class Plain extends App { override build(): View { return text("本文"); } } launch(new Plain());'), { libraries });
apps.push({ source: "binette:system", prebuilt: { ...plain, icon: undefined } });

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = performance.now() + 10000;
  while (!condition() && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert(condition(), "Cadre の操作が反映されませんでした");
}
async function fixture(installed = true, store = createMemoryAppStore()) {
  const window = new Window();
  const element = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.append(element as never);
  let live = 0;
  let ready = 0;
  const errors: unknown[] = [];
  const cadre = await mountShell(element, { apps, installed, store, onError: error => errors.push(error),
    createWorker(): RegieWorker {
      live++;
      const { port1, port2 } = new MessageChannel();
      port1.start(); port2.start(); serveApp(port1 as never);
      let stopped = false;
      let resumed = false;
      const resumes = new Set<number>();
      return { postMessage: (message, transfer) => {
        const call = message as { type: string; name?: string; args?: unknown[]; id: number };
        if (call.type === "call" && call.name === "__bina_lifecycle" && call.args?.[0] === 3) resumes.add(call.id);
        port2.postMessage(message, transfer as never);
      },
        addEventListener: (type, listener) => port2.addEventListener(type, ((event: MessageEvent) => {
          if (type === "message" && event.data.type === "done" && resumes.delete(event.data.id) && !resumed) { resumed = true; ready++; }
          (listener as (event: MessageEvent) => void)(event);
        }) as never),
        terminate() { if (stopped) return; stopped = true; live--; if (resumed) ready--; port1.close(); port2.close(); } };
    },
  });
  const button = (key: string) => element.querySelector<HTMLButtonElement>(`[data-bina-key=${key}]`);
  await waitFor(() => button("home") !== null && button("home-tile-0") !== null);
  const waitReady = async () => {
    await waitFor(() => live === ready);
    await new Promise(resolve => setTimeout(resolve, 0));
  };
  await waitReady();
  return { window, element, cadre, button, errors, waitReady, get live() { return live; },
    async close() { cadre.stop(); await window.happyDOM.close(); } };
}

Deno.test("Cadre の枠はホームと起動中だけを並べ、前面の印と切り替えを更新する", async () => {
  const f = await fixture();
  try {
    assertEquals(f.button("home")!.getAttribute("aria-pressed"), "true");
    assertEquals(f.element.querySelector<HTMLElement>("[data-bina-key=dock]")!.hidden, true);
    f.button("home-tile-0")!.click();
    await waitFor(() => f.button("dock-0") !== null && f.element.querySelector("[data-bina-key=settings-root]") !== null);
    assertEquals(f.element.querySelectorAll("[data-bina-key=dock] > .bina-ui-button").length, 1);
    assertEquals(f.button("dock-0")!.getAttribute("aria-pressed"), "true");
    assertEquals(f.button("home")!.getAttribute("aria-pressed"), "false");
    await f.waitReady();
    f.button("home")!.click();
    await waitFor(() => f.button("home")!.getAttribute("aria-pressed") === "true");
    assertEquals(f.errors, []);
    assertEquals(f.button("dock-0")!.getAttribute("aria-pressed"), "false");
    await f.waitReady();
    f.button("dock-0")!.click();
    await waitFor(() => f.button("dock-0")!.getAttribute("aria-pressed") === "true");
    assertEquals(f.errors, []);
  } finally { await f.close(); }
});

Deno.test("ドックは対応するアプリのアイコンと読み上げ名を持ち、画像なしは名前を表示する", async () => {
  const f = await fixture();
  try {
    f.button("home-tile-0")!.click();
    await waitFor(() => f.button("dock-0") !== null && f.element.querySelector("[data-bina-key=settings-root]") !== null);
    const dock = f.button("dock-0")!;
    assertEquals(dock.getAttribute("aria-label"), "設定を開く");
    const image = dock.querySelector("img")!;
    assertEquals(image.getAttribute("src"), `data:image/svg+xml;charset=utf-8,${encodeURIComponent(apps[0]!.prebuilt.subIcons!.settings!)}`);
    assertEquals(image.getAttribute("alt"), "");
    await f.waitReady();
    f.button("home")!.click();
    await waitFor(() => f.button("home")!.getAttribute("aria-pressed") === "true");
    f.button("home-tile-1")!.click();
    await waitFor(() => f.button("dock-1") !== null && [...f.element.querySelectorAll(".bina-shell-app")].some(host => host.querySelector(".bina-ui-text")?.textContent === "本文"));
    assertEquals(f.button("dock-1")!.getAttribute("aria-label"), "アイコンなしを開く");
    assertEquals(f.button("dock-1")!.textContent, "ア");
    assertEquals(f.button("dock-1")!.querySelector("img"), null);
  } finally { await f.close(); }
});

Deno.test("ドックのメニューから閉じると、閉じたアプリをドックから除く", async () => {
  const f = await fixture();
  try {
    f.button("home-tile-0")!.click();
    await waitFor(() => f.button("dock-0") !== null && f.element.querySelector("[data-bina-key=settings-root]") !== null);
    await f.waitReady();
    f.button("dock-0")!.dispatchEvent(new f.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }) as unknown as Event);
    const close = [...f.element.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === "閉じる");
    assert(close);
    close.click();
    await waitFor(() => f.button("dock-0") === null && f.button("home")!.getAttribute("aria-pressed") === "true");
    assertEquals(f.element.querySelector<HTMLElement>("[data-bina-key=dock]")!.hidden, true);
    assertEquals(f.errors, []);
  } finally { await f.close(); }
});

Deno.test("ドックのメニューは選んだアプリだけを閉じ、残ったアプリを開ける", async () => {
  const f = await fixture();
  try {
    f.button("home-tile-0")!.click();
    await waitFor(() => f.button("dock-0") !== null && f.element.querySelector("[data-bina-key=settings-root]") !== null);
    await f.waitReady();
    f.button("home")!.click();
    await waitFor(() => f.button("home")!.getAttribute("aria-pressed") === "true");
    f.button("home-tile-1")!.click();
    await waitFor(() => f.button("dock-1") !== null && f.button("dock-1")!.getAttribute("aria-pressed") === "true");
    await f.waitReady();
    // 前面でない設定のメニューから閉じても、前面のアプリは閉じない
    f.button("dock-0")!.dispatchEvent(new f.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }) as unknown as Event);
    const close = [...f.element.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === "閉じる");
    assert(close);
    close.click();
    await waitFor(() => f.button("dock-0") === null);
    assertEquals(f.button("dock-1")!.getAttribute("aria-pressed"), "true");
    await f.waitReady();
    f.button("home")!.click();
    await waitFor(() => f.button("home")!.getAttribute("aria-pressed") === "true");
    f.button("dock-1")!.click();
    await waitFor(() => f.button("dock-1")!.getAttribute("aria-pressed") === "true");
    assertEquals(f.errors, []);
  } finally { await f.close(); }
});

Deno.test("インストールはライブモードだけに表示し、押すと手順を開く", async () => {
  for (const installed of [false, true]) {
    const f = await fixture(installed);
    try {
      await waitFor(() => (f.button("install-tile") === null) === installed);
      assertEquals(f.button("install"), null);
      assert(f.button("clock") !== null);
      if (!installed) {
        f.button("install-tile")!.click();
        await waitFor(() => f.element.querySelector<HTMLDialogElement>("dialog")!.open);
      }
    } finally { await f.close(); }
  }
});

Deno.test("stop は Cadre とアプリの Worker および表示を片付け、古いボタンは起動しない", async () => {
  const f = await fixture();
  try {
    const oldButton = f.button("home")!;
    f.cadre.stop();
    oldButton.click();
    await new Promise(resolve => setTimeout(resolve, 20));
    assertEquals(f.live, 0);
    assertEquals(f.element.childNodes.length, 0);
    assertEquals(f.errors, []);
  } finally { await f.close(); }
});

/** 置き場の枠ごとに、中の部品の key を並びの順に返す。狭い幅で写した分は narrow- が付く */
function frames(element: HTMLElement): Record<string, string[]> {
  return Object.fromEntries([...element.querySelectorAll<HTMLElement>("[data-bina-reserve]")].filter(frame => !frame.hidden).map(frame =>
    [frame.getAttribute("data-bina-key")!, [...frame.children].map(child => child.getAttribute("data-bina-key") ?? "")]));
}
const cadreKey = appId("binette:system", "cadre");
async function storeWith(layout: string) {
  const store = createMemoryAppStore();
  await store.data.write(cadreKey, "cadre.layout", layout);
  return store;
}

Deno.test("Cadre の既定の並びはホームが左下、ドックが下中央、時計が右下で、通知は時計の近くから出す", async () => {
  const f = await fixture();
  try {
    assertEquals(frames(f.element), { "frame-bl": ["home"], "frame-br": ["clock"] }, "開いているアプリが無いドックは枠ごと隠す");
    assertEquals(f.element.querySelector("[data-bina-key=frame-bc]")!.getAttribute("data-bina-reserve"), "bc");
    assert(f.element.querySelector("[data-bina-key=notice-br]") !== null);
    // アプリの表示領域は画面全体で、枠はその上に重なる（領域の外の兄弟）
    const area = f.element.querySelector<HTMLElement>("[data-bina-key=cadre-area]")!;
    assert(!area.querySelector("[data-bina-reserve]"));
    assertEquals(area.parentElement!.getAttribute("data-bina-key"), "cadre-root");
  } finally { await f.close(); }
});

Deno.test("ホームのメニューから編集モードに入り、時計をドラッグした並びを保存して、起動し直しても同じ並びで出す", async () => {
  const store = createMemoryAppStore();
  const f = await fixture(true, store);
  const window = f.window;
  try {
    f.button("home")!.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }) as unknown as Event);
    const edit = [...f.element.querySelectorAll<HTMLElement>('.bina-ui-menu [role="menuitem"]')].find(node => node.textContent === "レイアウトを編集")!;
    edit.click();
    await waitFor(() => f.button("layout-done") !== null);
    // 編集中は 8 か所の置き場をすべて出す
    assertEquals(Object.keys(frames(f.element)), ["frame-tl", "frame-tc", "frame-tr", "frame-ml", "frame-mr", "frame-bl", "frame-bc", "frame-br"]);
    // happy-dom の箱はすべて 0 なので、どこへ動かしても最初の置き場（左上）に吸い付く
    const clock = f.button("clock")!;
    const pointer = (target: EventTarget, type: string, x: number) =>
      target.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: x, pointerId: 1, pointerType: "mouse", button: 0 }) as unknown as Event);
    pointer(clock, "pointerdown", 0);
    const document = window.document as unknown as EventTarget;
    pointer(document, "pointermove", 20);
    pointer(document, "pointerup", 20);
    await waitFor(() => frames(f.element)["frame-tl"]?.[0] === "clock");
    assertEquals((await store.data.read(cadreKey)).get("cadre.layout"), "tl=clock;bl=home;bc=dock");
    f.button("layout-done")!.click();
    await waitFor(() => f.button("layout-done") === null);
    assertEquals(frames(f.element), { "frame-tl": ["clock"], "frame-bl": ["home"] });
    assert(f.element.querySelector("[data-bina-key=notice-tl]") !== null, "通知は左上の時計の近くから出す");
  } finally { await f.close(); }
  const again = await fixture(true, store);
  try { assertEquals(frames(again.element), { "frame-tl": ["clock"], "frame-bl": ["home"] }); }
  finally { await again.close(); }
});

Deno.test("Cadre は壊れた並びを読み捨てて既定に戻し、最初の並びに戻すと保存も消す", async () => {
  const store = await storeWith("bl=home;bc=home;br=clock");
  const f = await fixture(true, store);
  try {
    assertEquals(frames(f.element), { "frame-bl": ["home"], "frame-br": ["clock"] });
    assertEquals((await store.data.read(cadreKey)).has("cadre.layout"), false);
  } finally { await f.close(); }
  await store.data.write(cadreKey, "cadre.layout", "tr=home,clock;bl=dock");
  const g = await fixture(true, store);
  try {
    assertEquals(frames(g.element), { "frame-tr": ["home", "clock"] }, "同じ置き場の部品は並びの順に横に並ぶ");
    g.button("home")!.dispatchEvent(new g.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }) as unknown as Event);
    [...g.element.querySelectorAll<HTMLElement>('.bina-ui-menu [role="menuitem"]')].find(node => node.textContent === "レイアウトを編集")!.click();
    await waitFor(() => g.button("layout-reset") !== null);
    g.button("layout-reset")!.click();
    await waitFor(() => frames(g.element)["frame-bl"]?.[0] === "home");
    assertEquals((await store.data.read(cadreKey)).has("cadre.layout"), false);
    // Escape でも編集を終える
    (g.window.document as unknown as EventTarget).dispatchEvent(new g.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as unknown as Event);
    await waitFor(() => g.button("layout-done") === null);
  } finally { await g.close(); }
});

Deno.test("ml・mr の部品は縦表示にし、狭い幅のために下中央へ横表示で写す", async () => {
  const f = await fixture(true, await storeWith("ml=home;mr=clock;bc=dock"));
  try {
    const all = frames(f.element);
    assertEquals(all["frame-ml"], ["home"]);
    assertEquals(all["frame-mr"], ["clock"]);
    assertEquals(f.element.querySelector("[data-bina-key=frame-ml]")!.classList.contains("bina-ui-column"), true);
    assert(f.element.querySelector("[data-bina-key=frame-mr] [data-bina-key=clock-lines]"), "縦の時計は時と分を 2 段にする");
    assertEquals(f.element.querySelector("[data-bina-key=narrow-clock] [data-bina-key=clock-lines]"), null);
    // ドックは空なので、下中央は写した分だけの枠（狭い幅でだけ CSS で出す）
    assertEquals(all["frame-bc-narrow"], ["narrow-home", "dock", "narrow-clock"]);
    assert(f.element.querySelector("[data-bina-key=notice-mr]") !== null);
  } finally { await f.close(); }
});
