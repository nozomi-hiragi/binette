import { assertEquals, assertStrictEquals } from "@std/assert";
import type { DomOp } from "@binette/core";
import type { Process } from "@binette/regie";
import { Window } from "happy-dom";
import { mountApp } from "../src/mount.ts";

Deno.test("宣言 UI の移動と更新は既存の要素を使い、イベントには build を付ける", async () => {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  let apply: (ops: DomOp[]) => void = () => {};
  const events: number[][] = [];
  const process = { attach(sink: typeof apply) { apply = sink; }, dispatchUi(id: number, build: number) { events.push([id, build]); } } as unknown as Process;
  const mounted = mountApp(host, "", process);
  const update = (handle: number, text: string, listener: number | null, build: number): DomOp => ({
    op: "ui-update", handle, text, listener, build, padding: null, gap: null, grow: false, label: null, enabled: true,
  });
  try {
    apply([{ op: "ui-create", handle: 1, kind: "column" }, { op: "ui-insert", parent: null, child: 1, before: null },
      { op: "ui-create", handle: 2, kind: "button" }, update(2, "一", 4, 1), { op: "ui-insert", parent: 1, child: 2, before: null },
      { op: "ui-create", handle: 3, kind: "button" }, update(3, "二", 5, 1), { op: "ui-insert", parent: 1, child: 3, before: null }]);
    const [first, second] = [...host.querySelectorAll("button")];
    first!.click();
    apply([update(2, "変更", 4, 2), { op: "ui-insert", parent: 1, child: 3, before: 2 }]);
    assertStrictEquals(host.querySelectorAll("button")[0], second);
    assertStrictEquals(host.querySelectorAll("button")[1], first);
    assertEquals(first!.textContent, "変更");
    first!.click();
    assertEquals(events, [[4, 1], [4, 2]]);
    apply([{ op: "ui-remove", handle: 1 }]);
    first!.click();
    assertEquals(events, [[4, 1], [4, 2]]);
  } finally { mounted.stop(); await window.happyDOM.close(); }
});
