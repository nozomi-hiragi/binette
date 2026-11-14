import { assert, assertEquals } from "@std/assert";
import { Window } from "happy-dom";
import { button, column, dropArea, mount, row, text, type View } from "../src/index.ts";

const box = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top }) as DOMRect;

/** 置き場 a（横並び、左上）・b（縦並び、右）・c（空、下）と、a の部品 1・2、b の部品 3 を描く */
function fixture() {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.appendChild(host as never);
  const drops: string[] = [];
  const clicks: number[] = [];
  const root = mount(host);
  const draw = (): View => dropArea([
    row([button("1", () => clicks.push(1)).draggable("one").key("one"), text("2").draggable("two").key("two")]).dropZone("a").key("a"),
    column([text("3").draggable("three").key("three")]).dropZone("b").key("b"),
    row([]).dropZone("c").key("c"),
  ], value => drops.push(value));
  root.render(draw());
  const rects: Record<string, DOMRect> = { a: box(0, 0, 200, 50), one: box(0, 0, 100, 50), two: box(100, 0, 100, 50), b: box(900, 300, 60, 200), three: box(900, 300, 60, 60), c: box(400, 700, 200, 50) };
  for (const [key, rect] of Object.entries(rects)) host.querySelector<HTMLElement>(`[data-bina-key=${key}]`)!.getBoundingClientRect = () => rect;
  const node = (key: string) => host.querySelector<HTMLElement>(`[data-bina-key=${key}]`)!;
  const pointer = (target: Element, type: string, x: number, y: number) =>
    target.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", button: 0 }) as unknown as Event);
  const dragTo = (key: string, from: [number, number], to: [number, number], drop = true) => {
    pointer(node(key), "pointerdown", ...from);
    pointer(window.document as unknown as Element, "pointermove", from[0] + 10, from[1] + 10);
    pointer(window.document as unknown as Element, "pointermove", ...to);
    if (drop) pointer(window.document as unknown as Element, "pointerup", ...to);
  };
  return { window, host, root, drops, clicks, node, pointer, dragTo };
}

Deno.test("ドラッグで、吸い付いた置き場と並びの何番目に入るかがアプリに届き、続くクリックは押したことにしない", async () => {
  const { root, drops, clicks, node, dragTo, pointer, window } = fixture();
  try {
    assertEquals(node("one").getAttribute("data-bina-drag"), "one");
    assertEquals(node("a").getAttribute("data-bina-drop"), "a");
    // 部品 1 を 2 の右半分へ。並び（1 を除く）の 2 の後ろなので 1 番目
    dragTo("one", [50, 25], [160, 25], false);
    assert(node("one").classList.contains("bina-ui-dragging"));
    assert(node("a").classList.contains("bina-ui-drop-target"));
    assert(node("two").classList.contains("bina-ui-drop-after"), "入る位置を見せる");
    pointer(window.document as unknown as Element, "pointerup", 160, 25);
    node("one").click();
    assertEquals(clicks, [], "ドラッグの終わりのクリックはボタンを押さない");
    assert(!node("one").classList.contains("bina-ui-dragging") && !node("a").classList.contains("bina-ui-drop-target"));
    // 縦の置き場 b の 3 より上、空の置き場 c の近く（中でなくても、いちばん近い置き場に吸い付く）
    dragTo("two", [150, 25], [930, 310]);
    dragTo("three", [930, 330], [500, 790]);
    assertEquals(drops.map(value => JSON.parse(value)), [
      { type: "drop", item: "one", zone: "a", index: 1 },
      { type: "drop", item: "two", zone: "b", index: 0 },
      { type: "drop", item: "three", zone: "c", index: 0 },
    ]);
    // 動かさずに離せば、ただのクリック
    await new Promise(resolve => setTimeout(resolve, 0));
    node("one").click();
    assertEquals(clicks, [1]);
  } finally { root.unmount(); }
});

Deno.test("dropArea は、ドラッグ中の Escape でドラッグをやめ、ドラッグしていない Escape を知らせる", () => {
  const { root, drops, node, dragTo, pointer, window } = fixture();
  const escape = () => (window.document as unknown as Document).dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as unknown as Event);
  try {
    dragTo("one", [50, 25], [500, 720], false);
    escape();
    assert(!node("one").classList.contains("bina-ui-dragging"));
    pointer(window.document as unknown as Element, "pointerup", 500, 720);
    assertEquals(drops, []);
    escape();
    assertEquals(drops.map(value => JSON.parse(value)), [{ type: "escape" }]);
  } finally { root.unmount(); }
});
