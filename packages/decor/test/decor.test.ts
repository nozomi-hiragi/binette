import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import type { DomOp } from "@binette/core";
import { Window } from "happy-dom";
import { button, column, createUiDiffer, createUiDom, input, mount, row, show, text, type UiNode } from "../src/index.ts";

function node(kind: UiNode["kind"] = "text", key = "", children: UiNode[] = []): UiNode {
  return { kind, key, children, text: key, padding: 0, gap: 0, grow: false, label: "", enabled: true, handler: -1, minWidth: 0, heading: 0, list: false, shown: true, app: -1 };
}
Deno.test("Décor の差分は作成・更新・key による並べ替え・削除を最小限の操作で表す", () => {
  let ops: DomOp[] = [];
  const ui = createUiDiffer(op => ops.push(op));
  ui.render(node("column", "", [node("text", "a"), node("text", "b")]), 1);
  assertEquals(ops.filter(op => op.op === "ui-create").length, 3);
  const a = ui.find(2)!;
  ops = [];
  ui.render(node("column", "", [node("text", "b"), { ...node("text", "a"), text: "changed" }]), 2);
  assertStrictEquals(ui.find(2), a);
  assertEquals(ops.map(op => op.op), ["ui-update", "ui-insert"]);
  assertEquals(ui.find(2)?.node.text, "changed");
  ops = [];
  ui.render(node("column", "", [node("text", "b")]), 3);
  assertEquals(ops, [{ op: "ui-remove", handle: 2 }]);
  assertEquals(ui.find(2), undefined);
  ops = [];
  ui.render(node("row", "new"), 4);
  assertEquals(ops[0], { op: "ui-remove", handle: 1 });
  assert(ops.some(op => op.op === "ui-create" && op.kind === "row"));
});
Deno.test("Décor の入力版と隠れた木の検索は Worker に依存しない", () => {
  const ui = createUiDiffer(() => {});
  ui.render({ ...node("column"), shown: false, children: [node("input")] }, 1);
  ui.inputVersions.set(2, 9);
  assertEquals(ui.find(2), undefined);
  assertEquals(ui.findAny(2)?.node.kind, "input");
  const update = ui.update(2, ui.findAny(2)!.node, false);
  assert(update.op === "ui-update");
  assertEquals(update.inputVersion, 9);
  ui.render(node("row"), 2);
  assertEquals(ui.inputVersions.size, 0);
});
Deno.test("Décor DOM は差分の適用・ARIA・要素の再利用とリスナーの解除を行う", async () => {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  const events: number[] = [];
  const dom = createUiDom(host, { dispatchUi: handle => { events.push(handle); }, dispatchUiText() {} });
  const ui = createUiDiffer(op => dom.apply([op]));
  try {
    ui.render(node("column", "", [{ ...node("button", "a"), handler: 0, label: "押す" }, node("text", "b")]), 1);
    const button = host.querySelector("button")!;
    assertEquals(button.getAttribute("aria-label"), "押す");
    button.click();
    ui.render(node("column", "", [node("text", "b"), { ...node("button", "a"), handler: 0 }]), 2);
    assertStrictEquals(host.querySelector("button"), button);
    dom.stop(); button.click();
    assertEquals(events, [2]);
  } finally { dom.clear(); await window.happyDOM.close(); }
});
Deno.test("Décor mount は render 時だけ描き直し、key とイベントと unmount を扱う", async () => {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  const root = mount(host);
  let count = 0;
  let value = "";
  const draw = () => column([text(String(count)).heading(1), button("増やす", () => { count++; }).key("counter"), input(value, next => { value = next; }).label("名前")]);
  try {
    assertEquals(host.childNodes.length, 0);
    root.render(draw());
    const button = host.querySelector("button")!;
    button.click();
    assertEquals(count, 1);
    assertEquals(host.querySelector('[role="heading"]')?.textContent, "0");
    root.render(draw());
    assertEquals(host.querySelector('[role="heading"]')?.textContent, "1");
    assertStrictEquals(host.querySelector("button"), button);
    const field = host.querySelector("input")!;
    field.value = "テスト";
    field.dispatchEvent(new window.Event("input") as unknown as Event);
    assertEquals(value, "テスト");
    root.render(row([show(false, text("隠れる"))]));
    assertEquals(host.querySelector("span")?.hidden, true);
    root.unmount();
    assertEquals(host.childNodes.length, 0);
    button.click(); assertEquals(count, 1);
    root.unmount(); root.render(draw());
    assertEquals(host.childNodes.length, 0);
  } finally { root.unmount(); await window.happyDOM.close(); }
});
