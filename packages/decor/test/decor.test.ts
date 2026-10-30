import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import type { DomOp } from "@binette/core";
import { Window } from "happy-dom";
import { button, column, createUiDiffer, createUiDom, input, mount, row, show, text, type UiNode } from "../src/index.ts";

function node(kind: UiNode["kind"] = "text", key = "", children: UiNode[] = []): UiNode {
  return { kind, key, children, text: key, padding: 0, gap: 0, grow: false, label: "", enabled: true, handler: -1, minWidth: 0, heading: 0, list: false, shown: true, app: -1, multiline: false };
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

Deno.test("Décor の段・標準の段・px と部品の未指定 padding を CSS に渡す", async () => {
  const { space } = await import("../src/index.ts");
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  const root = mount(host);
  try {
    root.render(column([text("px").padding(8), text("段").padding(space.xl), button("既定", () => {})]).gap().padding());
    const outer = host.querySelector(".bina-ui-column")! as HTMLElement;
    assertEquals(outer.style.getPropertyValue("--bina-ui-gap"), "var(--bina-ui-space-md, var(--bina-ui-default-space-md))");
    assertEquals(outer.style.getPropertyValue("--bina-ui-padding"), "var(--bina-ui-space-md, var(--bina-ui-default-space-md))");
    assertEquals((host.querySelectorAll("span")[0] as HTMLElement).style.getPropertyValue("--bina-ui-padding"), "8px");
    assertEquals((host.querySelectorAll("span")[1] as HTMLElement).style.getPropertyValue("--bina-ui-padding"), "var(--bina-ui-space-xl, var(--bina-ui-default-space-xl))");
    assert(host.querySelector("button")!.style.getPropertyValue("--bina-ui-padding").includes("--bina-ui-button-padding-md"));
  } finally { root.unmount(); await window.happyDOM.close(); }
});

Deno.test("Décor の theme は部分木だけに継承し、入れ子・合成・変更・削除を扱う", async () => {
  const { theme, space, radius, fontSize, component } = await import("../src/index.ts");
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  const root = mount(host);
  const make = (value: number) => column([
    theme({ space: { md: value }, button: { padding: space.md, radius: radius.sm, fontSize: fontSize.lg } }, column([
      button("外側", () => {}).key("outer"),
      theme({ space: { md: 30 }, button: { padding: 7 } }, column([button("内側", () => {})]).key("inner")),
    ]).key("scope")),
    button("範囲外", () => {}).key("sibling"),
  ]);
  try {
    root.render(make(20));
    const scope = host.querySelector('[data-bina-key="scope"]')! as HTMLElement;
    const inner = host.querySelector('[data-bina-key="inner"]')! as HTMLElement;
    const outside = host.querySelector('[data-bina-key="sibling"]')! as HTMLElement;
    assertEquals(scope.style.getPropertyValue("--bina-ui-space-md"), "20px");
    assertEquals(inner.style.getPropertyValue("--bina-ui-space-md"), "30px");
    assertEquals(inner.style.getPropertyValue("--bina-ui-button-padding-px"), "7px");
    assertEquals(outside.style.getPropertyValue("--bina-ui-space-md"), "");
    assert(outside.style.getPropertyValue("--bina-ui-padding").startsWith("calc("));
    assertEquals(scope.style.getPropertyValue("--bina-ui-button-radius-sm"), "1");
    root.render(make(24));
    assertStrictEquals(host.querySelector('[data-bina-key="scope"]'), scope);
    assertEquals(scope.style.getPropertyValue("--bina-ui-space-md"), "24px");
    root.render(column([column([]).key("scope")]));
    assertEquals(scope.style.getPropertyValue("--bina-ui-space-md"), "");
    root.render(theme({ space: { md: 18 } }, theme({ space: { sm: 6, md: 22 } }, component(() => text("関数"), {}))));
    const span = host.querySelector("span")!;
    assertEquals(span.style.getPropertyValue("--bina-ui-space-md"), "22px");
    assertEquals(span.style.getPropertyValue("--bina-ui-space-sm"), "6px");
  } finally { root.unmount(); await window.happyDOM.close(); }
});

Deno.test("親の padding は子に漏れず、部品の段は子のテーマで解決する", async () => {
  const { theme, space } = await import("../src/index.ts");
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  const root = mount(host);
  try {
    root.render(theme({ button: { padding: space.md }, input: { padding: space.sm } }, column([
      button("既定", () => {}), input("", () => {}), text("余白なし"),
      theme({ space: { md: 30, sm: 18 } }, column([button("入れ子", () => {}), input("", () => {})])),
      button("明示", () => {}).padding(3),
    ]).padding(8)));
    const outer = host.querySelector(".bina-ui-column")! as HTMLElement;
    assertEquals(outer.style.getPropertyValue("--bina-ui-padding"), "8px");
    assertEquals(outer.style.getPropertyValue("--bina-ui-button-padding-md"), "1");
    assertEquals(outer.style.getPropertyValue("--bina-ui-input-padding-sm"), "1");
    assertEquals(host.querySelector("span")!.style.getPropertyValue("--bina-ui-padding"), "0px");
    const buttons = host.querySelectorAll("button");
    assertEquals(buttons[0].style.getPropertyValue("--bina-ui-padding"), buttons[1].style.getPropertyValue("--bina-ui-padding"));
    assert(buttons[1].style.getPropertyValue("--bina-ui-padding").includes("var(--bina-ui-space-md, 12px)"));
    assertEquals(buttons[2].style.getPropertyValue("--bina-ui-padding"), "3px");
    assertEquals((buttons[1].parentElement as HTMLElement).style.getPropertyValue("--bina-ui-space-md"), "30px");
    assert(host.querySelector("input")!.style.getPropertyValue("--bina-ui-padding").includes("var(--bina-ui-space-sm, 8px)"));
  } finally { root.unmount(); await window.happyDOM.close(); }
});

Deno.test("部品の角丸は theme を優先し、未指定時は既存 CSS 変数を使う", async () => {
  const { theme, radius, uiCss } = await import("../src/index.ts");
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  host.style.setProperty("--bina-ui-button-radius", "12px");
  host.style.setProperty("--bina-ui-input-radius", "3px");
  const root = mount(host);
  try {
    root.render(theme({ button: { radius: radius.sm }, input: { radius: 6 } }, column([button("テーマ", () => {}), input("", () => {})])));
    const scope = host.querySelector(".bina-ui-column")! as HTMLElement;
    assertEquals(scope.style.getPropertyValue("--bina-ui-button-radius-px"), "0px");
    assertEquals(scope.style.getPropertyValue("--bina-ui-button-radius-sm"), "1");
    assertEquals(scope.style.getPropertyValue("--bina-ui-input-radius-px"), "6px");
    assert(uiCss.includes("calc(var(--bina-ui-button-radius-px, var(--bina-ui-button-radius, 8px))"));
    assert(uiCss.includes("calc(var(--bina-ui-input-radius-px, var(--bina-ui-input-radius, 0px))"));
    root.render(column([button("既定", () => {}), input("", () => {})]));
    assertEquals(scope.style.getPropertyValue("--bina-ui-button-radius-px"), "");
    assertEquals(host.style.getPropertyValue("--bina-ui-button-radius"), "12px");
  } finally { root.unmount(); await window.happyDOM.close(); }
});

Deno.test("theme の値は数だけを受け付け、ほかの CSS は書き込まない", async () => {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  const root = mount(host);
  try {
    const view = column([]);
    view.themeValue = "--bina-ui-space-md:url(https://example.com/x);--bina-ui-space-sm:6px;--bina-ui-button-padding-md:1;--color:red;";
    root.render(view);
    const node = host.querySelector(".bina-ui-column")! as HTMLElement;
    assertEquals(node.style.getPropertyValue("--bina-ui-space-md"), "");
    assertEquals(node.style.getPropertyValue("--bina-ui-space-sm"), "6px");
    assertEquals(node.style.getPropertyValue("--bina-ui-button-padding-md"), "1");
    assertEquals(node.style.getPropertyValue("--color"), "");
  } finally { root.unmount(); await window.happyDOM.close(); }
});

Deno.test("複数行入力は textarea を描画し、改行を往復して入力モードを切り替える", async () => {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  const root = mount(host);
  let value = "first\nsecond";
  const draw = () => input(value, next => { value = next; }).multiline().label("Code");
  try {
    root.render(draw());
    const field = host.querySelector("textarea")!;
    assert(field);
    assertEquals(field.value, value);
    assertEquals(field.getAttribute("aria-label"), "Code");
    field.value = "edited\nvalue\n";
    field.dispatchEvent(new window.Event("input") as unknown as Event);
    assertEquals(value, "edited\nvalue\n");
    root.render(draw());
    assertStrictEquals(host.querySelector("textarea"), field);
    assertEquals(field.value, value);
    root.render(input("single", () => {}));
    assertEquals(host.querySelector("textarea"), null);
    assertEquals(host.querySelector("input")!.value, "single");
    root.render(draw().enabled(false));
    assertEquals(host.querySelector("input"), null);
    assertEquals(host.querySelector("textarea")!.disabled, true);
    field.value = "detached";
    field.dispatchEvent(new window.Event("input") as unknown as Event);
    assertEquals(value, "edited\nvalue\n");
  } finally { root.unmount(); await window.happyDOM.close(); }
});

for (const multiline of [false, true]) {
  Deno.test(`入力欄は IME と版の扱いを共有する (multiline=${multiline})`, async () => {
    const window = new Window();
    const host = window.document.createElement("div") as unknown as HTMLElement;
    const events: [number, string, number][] = [];
    const dom = createUiDom(host, { dispatchUi() {}, dispatchUiText(handle, value, version) { events.push([handle, value, version]); } });
    const ui = createUiDiffer(op => dom.apply([op]));
    const model = { ...node("input"), multiline, text: "initial", handler: 0 };
    try {
      ui.render(model, 1);
      const field = host.querySelector(multiline ? "textarea" : "input")!;
      field.dispatchEvent(new window.Event("compositionstart") as unknown as Event);
      field.value = "composing";
      field.dispatchEvent(new window.Event("input") as unknown as Event);
      assertEquals(events, [[1, "composing", 1]]);
      ui.inputVersions.set(1, 1);
      ui.render({ ...model, text: "accepted" }, 2);
      assertEquals(field.value, "composing");
      field.dispatchEvent(new window.Event("compositionend") as unknown as Event);
      assertEquals(field.value, "accepted");
      assertEquals(events.length, 1);
      field.value = "newer";
      field.dispatchEvent(new window.Event("input") as unknown as Event);
      assertEquals(events[1], [1, "newer", 2]);
      ui.render({ ...model, text: "stale" }, 3);
      assertEquals(field.value, "newer");
      field.dispatchEvent(new window.Event("compositionstart") as unknown as Event);
      ui.inputVersions.set(1, 2);
      ui.render({ ...model, text: "pending" }, 4);
      field.value = "final";
      field.dispatchEvent(new window.Event("compositionend") as unknown as Event);
      assertEquals(field.value, "final");
      assertEquals(events[2], [1, "final", 3]);
      ui.inputVersions.set(1, 3);
      ui.render({ ...model, text: "final" }, 5);
      assertEquals(field.value, "final");
      dom.stop();
      field.value = "stopped";
      field.dispatchEvent(new window.Event("input") as unknown as Event);
      assertEquals(events.length, 3);
    } finally { dom.clear(); await window.happyDOM.close(); }
  });
}
