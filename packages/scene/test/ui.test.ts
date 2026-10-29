import { assertEquals, assertStrictEquals } from "@std/assert";
import type { DomOp } from "@binette/core";
import type { Process } from "@binette/regie";
import { Window } from "happy-dom";
import { mountApp } from "../src/mount.ts";

Deno.test("宣言 UI の移動と更新は既存の要素を使い、イベントには要素のハンドルを付ける", async () => {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  let apply: (ops: DomOp[]) => void = () => {};
  const events: number[] = [];
  const process = { attach(sink: typeof apply) { apply = sink; }, dispatchUi(handle: number) { events.push(handle); } } as unknown as Process;
  const mounted = mountApp(host, "", process);
  const update = (handle: number, text: string, clickable: boolean): DomOp => ({
    op: "ui-update", handle, text, clickable, padding: null, gap: null, grow: false, label: null, enabled: true,
  });
  try {
    apply([{ op: "ui-create", handle: 1, kind: "column" }, { op: "ui-insert", parent: null, child: 1, before: null },
      { op: "ui-create", handle: 2, kind: "button" }, update(2, "一", true), { op: "ui-insert", parent: 1, child: 2, before: null },
      { op: "ui-create", handle: 3, kind: "button" }, update(3, "二", true), { op: "ui-insert", parent: 1, child: 3, before: null }]);
    const [first, second] = [...host.querySelectorAll("button")];
    first!.click();
    apply([update(2, "変更", true), { op: "ui-insert", parent: 1, child: 3, before: 2 }]);
    assertStrictEquals(host.querySelectorAll("button")[0], second);
    assertStrictEquals(host.querySelectorAll("button")[1], first);
    assertEquals(first!.textContent, "変更");
    first!.click();
    assertEquals(events, [2, 2]);
    apply([update(2, "変更", false)]);
    first!.click();
    assertEquals(events, [2, 2]);
    apply([update(2, "変更", true), { op: "ui-remove", handle: 1 }]);
    first!.click();
    assertEquals(events, [2, 2]);
  } finally { mounted.stop(); await window.happyDOM.close(); }
});

Deno.test("入力は IME 中も毎回通知し、同値や変換中の value は書き換えない", async () => {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  let apply: (ops: DomOp[]) => void = () => {};
  const values: string[] = [];
  const process = { attach(sink: typeof apply) { apply = sink; }, dispatchUiText(_handle: number, value: string) { values.push(value); } } as unknown as Process;
  const mounted = mountApp(host, "", process);
  const update = (text: string): Extract<DomOp, { op: "ui-update" }> => ({ op: "ui-update", handle: 1, text, clickable: true, padding: null, gap: null, grow: false, label: "入力", enabled: true });
  try {
    apply([{ op: "ui-create", handle: 1, kind: "input" }, update("hello"), { op: "ui-insert", parent: null, child: 1, before: null }]);
    const input = host.querySelector("input")!;
    input.setSelectionRange(2, 2);
    apply([update("hello")]);
    assertEquals(input.selectionStart, 2);
    input.dispatchEvent(new window.Event("compositionstart") as unknown as Event);
    input.value = "に";
    input.dispatchEvent(new window.Event("input") as unknown as Event);
    apply([update("stale")]);
    assertEquals(input.value, "に");
    input.value = "日本";
    input.dispatchEvent(new window.Event("input") as unknown as Event);
    input.dispatchEvent(new window.Event("compositionend") as unknown as Event);
    input.dispatchEvent(new window.Event("input") as unknown as Event);
    assertEquals(values, ["に", "日本"]);
    apply([{ ...update("古い応答"), inputVersion: 1 }]);
    assertEquals(input.value, "日本");
    apply([{ ...update("日本語"), inputVersion: 2 }]);
    assertEquals(input.value, "日本語");
    mounted.stop();
    input.value = "後";
    input.dispatchEvent(new window.Event("input") as unknown as Event);
    assertEquals(values, ["に", "日本"]);
  } finally { mounted.stop(); await window.happyDOM.close(); }
});

Deno.test("見出しと一覧は役割で読み上げられ、OS の CSS はアプリの key を見ない", async () => {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  let apply: (ops: DomOp[]) => void = () => {};
  const process = { attach(sink: typeof apply) { apply = sink; }, dispatchUi() {} } as unknown as Process;
  const mounted = mountApp(host, "", process);
  const base = { padding: null, gap: null, grow: false, label: null, enabled: true, clickable: false };
  try {
    apply([
      { op: "ui-create", handle: 1, kind: "column" }, { op: "ui-insert", parent: null, child: 1, before: null },
      { op: "ui-create", handle: 2, kind: "text" }, { op: "ui-update", handle: 2, text: "設定", ...base, heading: 1, key: "settings-title" },
      { op: "ui-insert", parent: 1, child: 2, before: null },
      { op: "ui-create", handle: 3, kind: "column" }, { op: "ui-update", handle: 3, text: "", ...base, list: true },
      { op: "ui-insert", parent: 1, child: 3, before: null },
      { op: "ui-create", handle: 4, kind: "text" }, { op: "ui-update", handle: 4, text: "一", ...base, listItem: true, minWidth: 80 },
      { op: "ui-insert", parent: 3, child: 4, before: null },
    ]);
    const title = host.querySelector<HTMLElement>(".bina-ui-text")!;
    assertEquals([title.getAttribute("role"), title.getAttribute("aria-level")], ["heading", "1"]);
    assertEquals(host.querySelectorAll(".bina-ui-column")[1]!.getAttribute("role"), "list");
    const item = host.querySelectorAll<HTMLElement>(".bina-ui-text")[1]!;
    assertEquals(item.getAttribute("role"), "listitem");
    // text の minWidth は自分の幅で、子に受け継ぐ変数にはしない
    assertEquals([item.style.minWidth, item.style.getPropertyValue("--bina-ui-minWidth")], ["80px", ""]);
    apply([{ op: "ui-update", handle: 2, text: "設定", ...base }]);
    assertEquals([title.hasAttribute("role"), title.hasAttribute("aria-level")], [false, false]);
    const css = host.querySelector("style")?.textContent ?? "";
    assertEquals([css.includes("data-bina-key"), css.includes("settings-"), css.includes("bina-home")], [false, false, false]);
  } finally { mounted.stop(); await window.happyDOM.close(); }
});
