import { assert, assertEquals } from "@std/assert";
import { Window } from "happy-dom";
import { button, column, menuItem, mount, show, text } from "../src/index.ts";

function fixture() {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.append(host as never);
  const root = mount(host);
  const calls: string[] = [];
  const draw = (show = true, enabled = true) => root.render(column([
    button("ホーム", () => {}).key("home").tip("ホーム"),
    ...(show ? [button("設定", () => calls.push("button")).key("app").tip("設定").label("設定を開く").menu([
      menuItem("開く", i => calls.push(`open:${i}`)).arg(2),
      menuItem("無効", () => calls.push("disabled")).enabled(false),
      menuItem("閉じる", () => { calls.push("close"); draw(false); }),
    ]).enabled(enabled)] : []),
    text("外側"),
  ]));
  draw();
  const app = () => host.querySelector<HTMLButtonElement>('[data-bina-key="app"]')!;
  const home = () => host.querySelector<HTMLButtonElement>('[data-bina-key="home"]')!;
  const menu = () => host.querySelector<HTMLElement>(".bina-ui-menu")!;
  const tip = () => host.querySelector<HTMLElement>(".bina-ui-tip")!;
  const active = () => window.document.activeElement as unknown as HTMLElement;
  const key = (node: HTMLElement, key: string, shiftKey = false) => node.dispatchEvent(new window.KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }) as unknown as Event);
  const pointer = (node: HTMLElement, type: string, pointerType = "touch", clientX = 10, clientY = 10) => node.dispatchEvent(new window.PointerEvent(type, { pointerType, clientX, clientY, bubbles: true, cancelable: true }) as unknown as Event);
  const context = (node: HTMLElement) => {
    const event = new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    node.dispatchEvent(event as unknown as Event);
    return event;
  };
  return { window, host, root, calls, draw, app, home, menu, tip, active, key, pointer, context,
    async close() { root.unmount(); await window.happyDOM.close(); } };
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

Deno.test("吹き出しはマウスとキーボードで名前を出し、指・クリックのフォーカスでは出さない", async () => {
  const f = fixture();
  try {
    f.pointer(f.app(), "pointerover", "mouse");
    assertEquals([f.tip().hidden, f.tip().textContent, f.tip().getAttribute("aria-hidden")], [false, "設定", "true"]);
    f.pointer(f.app(), "pointerout", "mouse");
    assert(f.tip().hidden);
    f.pointer(f.app(), "pointerover");
    assert(f.tip().hidden);
    f.app().focus();
    assertEquals([f.tip().hidden, f.tip().textContent], [false, "設定"]);
    f.key(f.app(), "Escape");
    assert(f.tip().hidden);
    f.home().focus();
    assertEquals(f.tip().textContent, "ホーム");
    f.home().blur();
    assert(f.tip().hidden);
    f.pointer(f.app(), "pointerdown", "mouse");
    f.app().focus();
    assert(f.tip().hidden);
    f.draw(false);
    assert(f.tip().hidden);
  } finally { await f.close(); }
});

Deno.test("右クリックのメニューは題と項目を持ち、通常描画には項目を混ぜず、選択後にフォーカスを戻す", async () => {
  const f = fixture();
  try {
    assertEquals(f.app().textContent, "設定");
    assertEquals(f.host.querySelectorAll('[role="menuitem"]').length, 0);
    assertEquals(f.app().getAttribute("aria-haspopup"), "menu");
    assert(f.context(f.app()).defaultPrevented);
    const title = f.menu().querySelector(".bina-ui-menuTitle")!;
    assertEquals([f.menu().getAttribute("role"), title.textContent, f.menu().getAttribute("aria-labelledby")], ["menu", "設定", title.id]);
    assertEquals(f.app().getAttribute("aria-expanded"), "true");
    assertEquals(f.active().textContent, "開く");
    f.active().click();
    assertEquals(f.calls, ["open:2"]);
    assert(f.menu().hidden);
    assertEquals(f.active(), f.app());
    assertEquals(f.app().hasAttribute("aria-expanded"), false);
    assertEquals(f.context(f.home()).defaultPrevented, false);
    f.context(f.app());
    f.menu().querySelectorAll<HTMLButtonElement>("button")[2]!.click();
    assertEquals(f.calls, ["open:2", "close"]);
    assert(f.menu().hidden);
    assertEquals(f.active(), f.home());
  } finally { await f.close(); }
});

Deno.test("メニューキーと Shift+F10 で開き、無効項目を飛ばして循環し、選択・中断・外側の操作を扱う", async () => {
  const f = fixture();
  try {
    f.key(f.app(), "F10");
    assertEquals(f.menu(), null);
    f.key(f.app(), "F10", true);
    f.key(f.active(), "ArrowDown");
    assertEquals(f.active().textContent, "閉じる");
    f.key(f.active(), "ArrowDown");
    assertEquals(f.active().textContent, "開く");
    f.key(f.active(), "ArrowUp");
    assertEquals(f.active().textContent, "閉じる");
    f.key(f.active(), "Home");
    assertEquals(f.active().textContent, "開く");
    f.key(f.active(), "End");
    assertEquals(f.active().textContent, "閉じる");
    f.key(f.active(), "Escape");
    assert(f.menu().hidden);
    assertEquals(f.active(), f.app());
    f.key(f.app(), "ContextMenu");
    f.key(f.active(), "Enter");
    assertEquals(f.calls, ["open:2"]);
    f.key(f.app(), "ContextMenu");
    f.key(f.active(), "Tab");
    assert(f.menu().hidden);
    f.key(f.app(), "ContextMenu");
    f.pointer(f.host, "pointerdown", "mouse");
    assert(f.menu().hidden);
    assertEquals(f.active(), f.app());
    f.key(f.app(), "ContextMenu");
    f.draw(false);
    assert(f.menu().hidden);
    assertEquals(f.active(), f.home());
  } finally { await f.close(); }
});

Deno.test("ボタンが隠れる・無効になるとメニューを閉じ、無効なボタンからは開かない", async () => {
  const f = fixture();
  try {
    f.key(f.app(), "ContextMenu");
    f.draw(true, false);
    assert(f.menu().hidden);
    assertEquals(f.context(f.app()).defaultPrevented, false);
    f.key(f.app(), "ContextMenu");
    assert(f.menu().hidden);
    f.draw();
    f.key(f.app(), "ContextMenu");
    f.root.render(column([button("ホーム", () => {}).key("home"), show(false, button("設定", () => {}).key("app").menu([menuItem("開く", () => {})]))]));
    assert(f.menu().hidden);
    assertEquals(f.active(), f.home());
  } finally { await f.close(); }
});

Deno.test("長押しは移動・解放で取り消し、成立後のクリックを抑え、unmount は待ちを片付ける", async () => {
  const f = fixture();
  try {
    f.pointer(f.app(), "pointerdown");
    f.pointer(f.app(), "pointerup");
    f.app().click();
    f.pointer(f.app(), "pointerdown");
    f.pointer(f.app(), "pointermove", "touch", 10, 30);
    await sleep(550);
    assertEquals(f.menu(), null);
    assertEquals(f.calls, ["button"]);
    f.pointer(f.app(), "pointerdown");
    f.pointer(f.app(), "pointermove", "touch", 12, 13);
    await sleep(550);
    assertEquals(f.menu().hidden, false);
    f.pointer(f.app(), "pointerup");
    f.app().click();
    assertEquals(f.calls, ["button"]);
    f.key(f.active(), "Escape");
    f.pointer(f.app(), "pointerdown", "mouse");
    await sleep(550);
    assert(f.menu().hidden);
    f.pointer(f.app(), "pointerup", "mouse");
    f.pointer(f.app(), "pointerdown");
    f.root.unmount();
    await sleep(550);
    assertEquals(f.host.childNodes.length, 0);
  } finally { await f.close(); }
});
