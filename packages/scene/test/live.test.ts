import { assert, assertEquals } from "@std/assert";
import { buildApp } from "@binette/regie/build";
import { createMemoryAppStore, serveApp, type RegieWorker } from "@binette/regie";
import { Window } from "happy-dom";
import { isInstalled, mountShell } from "../src/index.ts";

const root = new URL("../../..", import.meta.url);
const libraries = { "jsr:@binette/replique": await Deno.readTextFile(new URL("packages/replique/src/index.ts", root)) };
const shellApp = { source: "binette:system", prebuilt: await buildApp(path => Deno.readTextFile(new URL(`apps/shell/${path}`, root)), { libraries }) };
function createWorker(): RegieWorker {
  const { port1, port2 } = new MessageChannel();
  port1.start(); port2.start(); serveApp(port1 as never);
  return { postMessage: (message, transfer) => port2.postMessage(message, transfer as never),
    addEventListener: (type, listener) => port2.addEventListener(type, listener as never),
    terminate() { port1.close(); port2.close(); } };
}
function installButton(element: HTMLElement): HTMLButtonElement | null {
  const button = element.querySelector<HTMLButtonElement>("[data-bina-key=install]");
  return button?.hidden ? null : button;
}

function fakeWindow(mode?: string, standalone = false): globalThis.Window {
  return { navigator: { standalone }, matchMedia: (query: string) => ({ matches: query === `(display-mode: ${mode})` }) } as unknown as globalThis.Window;
}

async function fixture(installed?: boolean, prepare?: (window: Window) => void) {
  const window = new Window();
  prepare?.(window);
  const element = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.append(element as never);
  // 実際のシェルを起動して Worker 経由のインストール操作を検証する
  const shell = await mountShell(element, { apps: [shellApp], store: createMemoryAppStore(), installed, createWorker });
  await waitFor(() => element.querySelector("[data-bina-key=home]") !== null &&
    (installButton(element) === null) === element.querySelector<HTMLElement>(".bina-shell-live")!.hidden);
  return { window, element, shell, async close() { shell.stop(); await window.happyDOM.close(); } };
}

async function waitFor(condition: () => boolean) {
  const deadline = performance.now() + 10000;
  while (!condition() && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert(condition(), "インストール表示が変わりませんでした");
}

Deno.test("インストール済みは 3 つの display-mode と iPhone の standalone で見分ける", () => {
  for (const mode of ["standalone", "minimal-ui", "window-controls-overlay"]) assert(isInstalled(fakeWindow(mode)), mode);
  assert(isInstalled(fakeWindow(undefined, true)));
  assertEquals(isInstalled(fakeWindow("fullscreen")), false);
  assertEquals(isInstalled(fakeWindow("browser")), false);
  for (const window of [null, {}, { matchMedia: () => undefined }, { matchMedia: () => { throw new Error("未実装"); } }]) {
    assertEquals(isInstalled(window as unknown as globalThis.Window), false);
  }
});

Deno.test("installed の上書きでは matchMedia を使わず、ライブの透かしとボタンだけを切り替える", async () => {
  for (const installed of [false, true]) {
    let mediaCalls = 0;
    const f = await fixture(installed, window => {
      Object.defineProperty(window, "matchMedia", { value: () => { mediaCalls++; throw new Error("呼んではいけない"); } });
    });
    try {
      const watermark = f.element.querySelector<HTMLElement>(".bina-shell-live")!;
      const button = installButton(f.element);
      assertEquals(watermark.hidden, installed);
      assertEquals(installButton(f.element) === null, installed);
      assertEquals(watermark.textContent, "ライブモード");
      assertEquals(watermark.getAttribute("aria-hidden"), "true");
      assertEquals(watermark.closest(".bina-shell-app"), null);
      assertEquals(watermark.parentElement, f.element.querySelector(".bina-shell-host .bina-ui-appArea"));
      assertEquals(f.element.querySelector("dialog")!.parentElement, f.element.querySelector(".bina-shell"));
      // ホームバーの右端に置き、読み上げは「インストール」
      if (button) assertEquals(button.closest("[data-bina-key=homebar]") !== null, true);
      if (button) assertEquals(button.parentElement?.lastElementChild, button);
      if (button) assertEquals(button.textContent, "インストール");
      assert(f.element.querySelector("style")!.textContent!.match(/:where\(\.bina-shell-live\)[^}]*pointer-events: none/));
      f.window.dispatchEvent(new f.window.Event("appinstalled"));
      assertEquals(installButton(f.element) === null, installed);
      assertEquals(mediaCalls, 0);
    } finally { await f.close(); }
  }
});

Deno.test("display-mode の change で透かしとボタンが変わり、stop で監視を外す", async () => {
  const queries = new Map<string, EventTarget & { matches: boolean }>();
  const f = await fixture(undefined, window => {
    Object.defineProperty(window, "matchMedia", { value: (query: string) => {
      if (!queries.has(query)) queries.set(query, Object.assign(new EventTarget(), { matches: false }));
      return queries.get(query);
    } });
  });
  try {
    const watermark = f.element.querySelector<HTMLElement>(".bina-shell-live")!;
    assert(installButton(f.element) !== null);
    const query = queries.get("(display-mode: standalone)")!;
    query.matches = true; query.dispatchEvent(new Event("change"));
    await waitFor(() => installButton(f.element) === null && watermark.hidden === true);
    assert(f.shell.requireInstall("不要な表示"));
    query.matches = false; query.dispatchEvent(new Event("change"));
    await waitFor(() => installButton(f.element) !== null && !watermark.hidden);
    const detachedButton = installButton(f.element)!;
    f.shell.stop();
    query.matches = true; query.dispatchEvent(new Event("change"));
    assertEquals(watermark.hidden, false);
    assertEquals(detachedButton.isConnected, false);
    assertEquals(f.element.childNodes.length, 0);
  } finally { await f.close(); }
});

Deno.test("matchMedia が無くてもライブを表示でき、appinstalled で手順とライブ表示が閉じる", async () => {
  const f = await fixture(undefined, window => { Object.defineProperty(window, "matchMedia", { value: undefined }); });
  try {
    const button = installButton(f.element);
    button!.click();
    const dialog = f.element.querySelector<HTMLDialogElement>("dialog")!;
    await waitFor(() => dialog.open);
    f.window.dispatchEvent(new f.window.Event("appinstalled"));
    await waitFor(() => installButton(f.element) === null && !dialog.open);
    assertEquals(f.element.querySelector<HTMLElement>(".bina-shell-live")!.hidden, true);
    assert(f.shell.requireInstall("インストール後"));
  } finally { await f.close(); }
});

Deno.test("requireInstall はライブで理由を文字として手順に添え、インストール済みなら何も開かない", async () => {
  for (const installed of [false, true]) {
    const f = await fixture(installed);
    try {
      const reason = '<img src=x onerror="alert(1)">通知にはインストールが必要です。';
      assertEquals(f.shell.requireInstall(reason), installed);
      const dialog = f.element.querySelector<HTMLDialogElement>("dialog")!;
      assertEquals(dialog.open, !installed);
      assertEquals(dialog.querySelector("img"), null);
      if (!installed) assert(dialog.textContent!.includes(reason));
      assertEquals(dialog.closest(".bina-shell-app"), null);
    } finally { await f.close(); }
  }
});

Deno.test("prompt が無ければ短い手順を開き、閉じるボタンで閉じて再び開ける", async () => {
  const f = await fixture(false);
  try {
    const dialog = f.element.querySelector<HTMLDialogElement>("dialog")!;
    // showModal/close の無い DOM 実装でも open 属性で動く
    Object.defineProperty(dialog, "showModal", { value: undefined });
    Object.defineProperty(dialog, "close", { value: undefined });
    const button = installButton(f.element);
    button!.click();
    await waitFor(() => dialog.open);
    assert(dialog.textContent!.includes("ブラウザのメニュー"));
    dialog.querySelector<HTMLButtonElement>("button")!.click();
    assertEquals(dialog.open, false);
    f.shell.requireInstall("特別な理由");
    button!.click();
    assertEquals(dialog.open, true);
    await waitFor(() => dialog.querySelector("p")!.hidden === true);
  } finally { await f.close(); }
});

Deno.test("iPhone では Safari の共有からホーム画面に追加する手順を出す", async () => {
  const f = await fixture(false, window => { Object.defineProperty(window.navigator, "userAgent", { value: "iPhone Safari" }); });
  try {
    installButton(f.element)!.click();
    await waitFor(() => f.element.querySelector<HTMLDialogElement>("dialog")!.open);
    assert(f.element.querySelector("dialog")!.textContent!.includes("Safari の共有 → ホーム画面に追加"));
  } finally { await f.close(); }
});

Deno.test("beforeinstallprompt は標準表示を止め、ボタンで一度だけ prompt を呼ぶ", async () => {
  const f = await fixture(false);
  try {
    let calls = 0;
    const event = new f.window.Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, { prompt() { calls++; return Promise.resolve(); } });
    f.window.dispatchEvent(event);
    assert(event.defaultPrevented);
    const button = installButton(f.element);
    button!.click();
    await waitFor(() => calls === 1 && !installButton(f.element)!.disabled);
    assertEquals(f.element.querySelector<HTMLDialogElement>("dialog")!.open, false);
    button!.click();
    await waitFor(() => f.element.querySelector<HTMLDialogElement>("dialog")!.open);
    assertEquals(calls, 1);
  } finally { await f.close(); }
});

Deno.test("prompt の失敗は手順で案内し、複数の shell の表示は干渉しない", async () => {
  const fixtures = await Promise.all([fixture(false), fixture(false)]);
  try {
    await Promise.all(fixtures.map(async f => {
      const event = new f.window.Event("beforeinstallprompt", { cancelable: true });
      Object.assign(event, { prompt: () => Promise.reject(new Error("インストール非対応")) });
      f.window.dispatchEvent(event);
      installButton(f.element)!.click();
      await waitFor(() => f.element.querySelector<HTMLDialogElement>("dialog")!.open);
    }));
    assert(fixtures[0]!.element.querySelector("h2")!.id !== fixtures[1]!.element.querySelector("h2")!.id);
  } finally { await Promise.all(fixtures.map(f => f.close())); }
});
