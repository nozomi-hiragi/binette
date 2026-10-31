import { assert, assertEquals } from "@std/assert";
import type { BinetteSystem, SystemView } from "@binette/regie";
import { Window } from "happy-dom";
import { createShellUi } from "../src/index.ts";
import { barLabels, chooseFromMenu } from "./homebar-helper.ts";

const gear = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>';
const instances: SystemView["instances"] = [
  { id: 1, key: "home", name: "ホーム", home: true, closing: false },
  { id: 2, key: "settings", name: "設定", icon: gear, home: false, closing: false },
  { id: 3, key: "designer", name: "デザイナー", home: false, closing: false },
  { id: 4, key: "closing", name: "閉じかけ", icon: gear, home: false, closing: true },
];

/** 偽のシステムにつないだホームバー。Worker は使わない */
function fixture(installed = true) {
  const window = new Window();
  const element = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.append(element as never);
  const calls: string[] = [];
  const system: BinetteSystem = {
    openHome() { calls.push("openHome"); return Promise.resolve(); },
    open(key) { calls.push(`open:${key}`); return Promise.resolve(); },
    close(id) { calls.push(`close:${id}`); return Promise.resolve(); },
    setPage() {}, stop() {},
  };
  const ui = createShellUi(element, { installed });
  ui.bind(system);
  const show = (front: SystemView["front"], list = instances) => ui.update({ instances: list, front, apps: [], clearError: false });
  const button = (label: string) => element.querySelector<HTMLButtonElement>(`.bina-shell-homebar [aria-label="${label}"]`)!;
  const menu = () => element.querySelector<HTMLElement>(".bina-shell-menu")!;
  const tooltip = () => element.querySelector<HTMLElement>(".bina-shell-tooltip")!;
  const active = () => window.document.activeElement as unknown as HTMLElement | null;
  const key = (target: HTMLElement, init: { key: string; shiftKey?: boolean }) =>
    target.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }) as unknown as Event);
  const pointer = (target: HTMLElement, type: string, init: { pointerType?: string; clientX?: number; clientY?: number } = {}) =>
    target.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, ...init }) as unknown as Event);
  return { window, element, ui, calls, show, button, menu, tooltip, active, key, pointer,
    async close() { ui.stop(); await window.happyDOM.close(); } };
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

Deno.test("ホームバーはホーム・開いているアプリ・インストールを並べ、前面に印を付けて × を出さない", async () => {
  const f = fixture(false);
  try {
    f.show(2);
    assertEquals(f.element.querySelector("nav")!.getAttribute("aria-label"), "ホームバー");
    // 閉じかけのアプリとホームはドックに並べない
    assertEquals(barLabels(f.element), ["ホームを開く", "設定を開く", "デザイナーを開く", "インストール"]);
    assertEquals(f.element.querySelectorAll(".bina-shell-homebar [aria-label$=を閉じる]").length, 0);
    assertEquals(f.button("設定を開く").getAttribute("aria-pressed"), "true");
    assertEquals(f.button("デザイナーを開く").getAttribute("aria-pressed"), "false");
    assertEquals(f.button("ホームを開く").getAttribute("aria-pressed"), "false");
    for (const name of ["設定", "デザイナー"]) assertEquals(f.button(`${name}を開く`).getAttribute("aria-haspopup"), "menu");
    assertEquals(f.button("ホームを開く").hasAttribute("aria-haspopup"), false);
    // ホームのボタンは文字を出さない
    assertEquals(f.button("ホームを開く").textContent, "");
    f.show(1);
    assertEquals(f.button("ホームを開く").getAttribute("aria-pressed"), "true");
    assertEquals(f.button("設定を開く").getAttribute("aria-pressed"), "false");
    // 押すとシステムを呼ぶ
    f.button("ホームを開く").click(); f.button("デザイナーを開く").click();
    assertEquals(f.calls, ["openHome", "open:designer"]);
  } finally { await f.close(); }
});

Deno.test("アプリのアイコンを描き、アイコンの無いアプリは頭文字の札にする", async () => {
  const f = fixture();
  try {
    f.show(2, [...instances, { id: 5, key: "lower", name: "binette", home: false, closing: false }]);
    const image = f.button("設定を開く").querySelector("img")!;
    assertEquals(image.getAttribute("src"), `data:image/svg+xml;charset=utf-8,${encodeURIComponent(gear)}`);
    assertEquals(image.getAttribute("alt"), "");
    assertEquals(f.button("設定を開く").textContent, "");
    assertEquals(f.button("デザイナーを開く").querySelector("img"), null);
    assertEquals(f.button("デザイナーを開く").textContent, "デ");
    assertEquals(f.button("binetteを開く").textContent, "B");
  } finally { await f.close(); }
});

Deno.test("開いているアプリが無いときはドックを隠す", async () => {
  const f = fixture();
  try {
    f.show(1, instances.slice(0, 1));
    const dock = f.element.querySelector<HTMLElement>('[data-bina-key="dock"]')!;
    assertEquals(dock.hidden, true);
    assertEquals(barLabels(f.element), ["ホームを開く"]);
    f.show(2);
    assertEquals(dock.hidden, false);
  } finally { await f.close(); }
});

Deno.test("インストールのボタンはライブモードだけに出し、押すと手順を開く", async () => {
  for (const installed of [false, true]) {
    const f = fixture(installed);
    try {
      f.show(1);
      const button = f.element.querySelector<HTMLButtonElement>('[data-bina-key="install"]')!;
      assertEquals(button.hidden, installed);
      assertEquals(button.getAttribute("aria-label"), "インストール");
      assertEquals(button.textContent, "インストール");
      if (!installed) {
        button.click();
        assertEquals(f.element.querySelector<HTMLDialogElement>("dialog")!.open, true);
      }
    } finally { await f.close(); }
  }
});

Deno.test("マウスを載せる・キーボードでフォーカスすると名前の吹き出しを出す", async () => {
  const f = fixture(false);
  try {
    f.show(2);
    const tooltip = f.tooltip();
    assertEquals(tooltip.hidden, true);
    assertEquals(tooltip.getAttribute("aria-hidden"), "true");
    f.pointer(f.button("デザイナーを開く"), "pointerover", { pointerType: "mouse" });
    assertEquals([tooltip.hidden, tooltip.textContent], [false, "デザイナー"]);
    f.pointer(f.button("デザイナーを開く"), "pointerout", { pointerType: "mouse" });
    assertEquals(tooltip.hidden, true);
    // 指では吹き出しを出さない
    f.pointer(f.button("設定を開く"), "pointerover", { pointerType: "touch" });
    assertEquals(tooltip.hidden, true);
    f.button("設定を開く").focus();
    assertEquals([tooltip.hidden, tooltip.textContent], [false, "設定"]);
    f.key(f.button("設定を開く"), { key: "Escape" });
    assertEquals(tooltip.hidden, true);
    f.button("ホームを開く").focus();
    assertEquals(tooltip.textContent, "ホーム");
    f.button("インストール").focus();
    assertEquals(tooltip.textContent, "Binette をインストール");
    f.button("インストール").blur();
    assertEquals(tooltip.hidden, true);
    // 押して入ったフォーカスでは出さない
    f.pointer(f.button("設定を開く"), "pointerdown", { pointerType: "mouse" });
    f.button("設定を開く").focus();
    assertEquals(tooltip.hidden, true);
  } finally { await f.close(); }
});

Deno.test("右クリックのメニューは名前と「開く」「閉じる」を出し、選ぶとシステムを呼んでフォーカスを戻す", async () => {
  const f = fixture();
  try {
    f.show(2);
    const designer = f.button("デザイナーを開く");
    const event = new f.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    designer.dispatchEvent(event as unknown as Event);
    assert(event.defaultPrevented);
    const menu = f.menu();
    assertEquals(menu.hidden, false);
    assertEquals(menu.getAttribute("role"), "menu");
    assertEquals(designer.getAttribute("aria-expanded"), "true");
    const title = menu.querySelector(".bina-shell-menu-title")!;
    assertEquals(title.textContent, "デザイナー");
    assertEquals(menu.getAttribute("aria-labelledby"), title.id);
    const items = [...menu.querySelectorAll<HTMLElement>("[role=menuitem]")];
    assertEquals(items.map(item => item.textContent), ["開く", "閉じる"]);
    assertEquals(f.active(), items[0]);
    items[0]!.click();
    assertEquals(f.calls, ["open:designer"]);
    assertEquals(menu.hidden, true);
    assertEquals(designer.hasAttribute("aria-expanded"), false);
    assertEquals(f.active(), designer);
    // 「閉じる」は close を呼び、フォーカスはホームへ移す
    chooseFromMenu(f.element, "設定", "閉じる");
    assertEquals(f.calls, ["open:designer", "close:2"]);
    assertEquals(f.active(), f.button("ホームを開く"));
    // ホームとインストールにはメニューを出さない
    const home = new f.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    f.button("ホームを開く").dispatchEvent(home as unknown as Event);
    assertEquals([home.defaultPrevented, menu.hidden], [false, true]);
  } finally { await f.close(); }
});

Deno.test("メニューは Shift+F10・メニューキーで開き、矢印で動き、Enter で選び、Escape と外側のクリックで閉じる", async () => {
  const f = fixture();
  try {
    f.show(2);
    const settings = f.button("設定を開く");
    const menu = f.menu();
    settings.focus();
    f.key(settings, { key: "F10", shiftKey: true });
    assertEquals(menu.hidden, false);
    const items = () => [...menu.querySelectorAll<HTMLElement>("[role=menuitem]")];
    assertEquals(f.active(), items()[0]);
    f.key(f.active()!, { key: "ArrowDown" }); assertEquals(f.active(), items()[1]);
    f.key(f.active()!, { key: "ArrowDown" }); assertEquals(f.active(), items()[0]);
    f.key(f.active()!, { key: "ArrowUp" }); assertEquals(f.active(), items()[1]);
    f.key(f.active()!, { key: "Home" }); assertEquals(f.active(), items()[0]);
    f.key(f.active()!, { key: "End" }); assertEquals(f.active(), items()[1]);
    f.key(f.active()!, { key: "Escape" });
    assertEquals(menu.hidden, true);
    assertEquals(f.active(), settings);
    assertEquals(f.calls, []);
    // F10 だけでは開かない
    f.key(settings, { key: "F10" });
    assertEquals(menu.hidden, true);
    f.key(settings, { key: "ContextMenu" });
    assertEquals(menu.hidden, false);
    f.key(f.active()!, { key: "ArrowDown" });
    f.key(f.active()!, { key: "Enter" });
    assertEquals(f.calls, ["close:2"]);
    assertEquals(menu.hidden, true);
    // 外側のクリックで閉じ、元のボタンにフォーカスを戻す
    f.key(settings, { key: "ContextMenu" });
    assertEquals(menu.hidden, false);
    f.pointer(f.element.querySelector<HTMLElement>(".bina-shell-stage")!, "pointerdown", { pointerType: "mouse" });
    assertEquals(menu.hidden, true);
    assertEquals(f.active(), settings);
    assertEquals(f.calls, ["close:2"]);
  } finally { await f.close(); }
});

Deno.test("メニューを開いたままアプリが閉じかけになったら、メニューを閉じる", async () => {
  const f = fixture();
  try {
    f.show(2);
    f.key(f.button("設定を開く"), { key: "ContextMenu" });
    assertEquals(f.menu().hidden, false);
    f.show(1, instances.map(instance => instance.id === 2 ? { ...instance, closing: true } : instance));
    assertEquals(f.menu().hidden, true);
    assertEquals(f.active(), f.button("ホームを開く"));
  } finally { await f.close(); }
});

Deno.test("長押しでメニューを開き、そのあとのクリックではアプリを開かない。指が動いたら取り消す", async () => {
  const f = fixture();
  try {
    f.show(2);
    const designer = f.button("デザイナーを開く");
    const menu = f.menu();
    // 短く押して離せば、ふつうのクリック
    f.pointer(designer, "pointerdown", { pointerType: "touch", clientX: 10, clientY: 10 });
    f.pointer(designer, "pointerup", { pointerType: "touch", clientX: 10, clientY: 10 });
    designer.click();
    await sleep(600);
    assertEquals([menu.hidden, f.calls], [true, ["open:designer"]]);
    // 指が動いたら開かない
    f.pointer(designer, "pointerdown", { pointerType: "touch", clientX: 10, clientY: 10 });
    f.pointer(designer, "pointermove", { pointerType: "touch", clientX: 10, clientY: 30 });
    await sleep(600);
    assertEquals(menu.hidden, true);
    // 長押し
    f.pointer(designer, "pointerdown", { pointerType: "touch", clientX: 10, clientY: 10 });
    f.pointer(designer, "pointermove", { pointerType: "touch", clientX: 12, clientY: 13 });
    await sleep(600);
    assertEquals(menu.hidden, false);
    assertEquals(menu.querySelector(".bina-shell-menu-title")!.textContent, "デザイナー");
    f.pointer(designer, "pointerup", { pointerType: "touch", clientX: 12, clientY: 13 });
    designer.click();
    assertEquals(f.calls, ["open:designer"]);
    // マウスの長押しではメニューを出さない
    f.key(f.active()!, { key: "Escape" });
    f.pointer(designer, "pointerdown", { pointerType: "mouse" });
    await sleep(600);
    assertEquals(menu.hidden, true);
    f.pointer(designer, "pointerup", { pointerType: "mouse" });
    designer.click();
    assertEquals(f.calls, ["open:designer", "open:designer"]);
  } finally { await f.close(); }
});

Deno.test("stop はホームバーと長押しの待ちを片付ける", async () => {
  const f = fixture();
  try {
    f.show(2);
    f.pointer(f.button("設定を開く"), "pointerdown", { pointerType: "touch" });
    f.ui.stop();
    await sleep(600);
    assertEquals(f.element.childNodes.length, 0);
    assertEquals(f.calls, []);
  } finally { await f.close(); }
});
