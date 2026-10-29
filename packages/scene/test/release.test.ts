import { assertEquals } from "@std/assert";
import type { DomOp } from "@binette/core";
import type { Process } from "@binette/regie";
import { Window } from "happy-dom";
import { mountApp, mountCounts } from "../src/mount.ts";

Deno.test("解除と部分木の削除で DOM リスナーとハンドルを忘れる", async () => {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  let apply: (ops: DomOp[]) => void = () => {};
  const events: number[] = [];
  const process = { attach(sink: typeof apply) { apply = sink; }, dispatch(id: number) { events.push(id); } } as unknown as Process;
  const mounted = mountApp(host, '<div id="root"><button id="old"></button></div>', process);
  try {
    apply([{ op: "byId", handle: 1, id: "root" }, { op: "byId", handle: 2, id: "old" },
      { op: "listen", handle: 2, type: "click", listener: 10 }, { op: "unlisten", handle: 2, type: "click", listener: 10 }]);
    const old = host.querySelector<HTMLButtonElement>("#old")!;
    old.click(); assertEquals(events, []);
    apply([{ op: "create", handle: 3, tag: "button" }, { op: "append", parent: 1, child: 3 },
      { op: "listen", handle: 1, type: "click", listener: 11 }, { op: "listen", handle: 2, type: "click", listener: 12 },
      { op: "listen", handle: 3, type: "click", listener: 13 }]);
    const root = host.querySelector<HTMLElement>("#root")!;
    const made = root.querySelectorAll("button")[1]!;
    apply([{ op: "text", handle: 1, value: "cleared" }, { op: "append", parent: 1, child: 3 },
      { op: "text", handle: 2, value: "stale" }]);
    old.click(); made.click(); assertEquals(events, []);
    assertEquals(root.textContent, "cleared");
    root.click(); assertEquals(events, [11]);
    apply([{ op: "remove", handle: 1 }, { op: "text", handle: 1, value: "stale" }]);
    root.click(); assertEquals(events, [11]); assertEquals(root.textContent, "cleared");
  } finally { mounted.stop(); await window.happyDOM.close(); }
});

Deno.test("繰り返し解除したリスナーは停止時にも残らない", async () => {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  let apply: (ops: DomOp[]) => void = () => {};
  const process = { attach(sink: typeof apply) { apply = sink; }, dispatch() {} } as unknown as Process;
  const mounted = mountApp(host, '<div id="root"></div>', process);
  try {
    apply([{ op: "byId", handle: 1, id: "root" }]);
    const root = host.querySelector<HTMLElement>("#root")!;
    let active = 0;
    const add = root.addEventListener.bind(root), remove = root.removeEventListener.bind(root);
    root.addEventListener = (...args: Parameters<HTMLElement["addEventListener"]>) => { active++; add(...args); };
    root.removeEventListener = (...args: Parameters<HTMLElement["removeEventListener"]>) => { active--; remove(...args); };
    for (let i = 0; i < 1000; i++) {
      apply([{ op: "listen", handle: 1, type: "click", listener: i }, { op: "unlisten", handle: 1, type: "click", listener: i }]);
    }
    assertEquals(active, 0);
    for (let i = 0; i < 1000; i++) {
      const handle = i + 2;
      apply([{ op: "create", handle, tag: "button" }, { op: "append", parent: 1, child: handle },
        { op: "listen", handle, type: "click", listener: i }, { op: "remove", handle }]);
    }
    assertEquals(mountCounts(mounted), { ids: 1, created: 0, removers: 0 });
    apply([{ op: "byId", handle: 1002, id: "missing" }, { op: "remove", handle: 1002 }]);
    assertEquals(mountCounts(mounted), { ids: 1, created: 0, removers: 0 });
    mounted.stop(); assertEquals(active, 0);
    assertEquals(mountCounts(mounted), { ids: 0, created: 0, removers: 0 });
  } finally { mounted.stop(); await window.happyDOM.close(); }
});
