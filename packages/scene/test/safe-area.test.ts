import { assert, assertEquals } from "@std/assert";
import { Window } from "happy-dom";
import { createShellUi } from "../src/index.ts";
import { mountEdgeReveal, safeAreaOf, type RevealTimers } from "../src/safe-area.ts";

const screen = { top: 0, right: 1000, bottom: 800, left: 0 };
const box = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height });

Deno.test("セーフエリアは辺ごとの枠のいちばん奥にすき間を足し、角の枠は上下にだけ数える", () => {
  const frames = [
    { slot: "tl", box: box(8, 8, 200, 60) },
    { slot: "tc", box: box(400, 8, 200, 52) },
    { slot: "bl", box: box(8, 732, 60, 60) },
    { slot: "br", box: box(900, 740, 92, 52) },
    { slot: "mr", box: box(932, 300, 60, 200) },
  ];
  assertEquals(safeAreaOf(screen, frames), { top: 76, right: 76, bottom: 76, left: 0 });
});

Deno.test("セーフエリアは端末の切り欠きを下回らず、隠れた枠とフルスクリーンでは端末の分だけ残る", () => {
  const device = { top: 44, right: 0, bottom: 34, left: 20 };
  const frames = [{ slot: "bc", box: box(400, 700, 200, 52) }, { slot: "ml", box: box(0, 0, 0, 0) }, { slot: "tc", box: box(400, 4, 200, 20) }];
  assertEquals(safeAreaOf(screen, frames, { device }), { top: 44, right: 0, bottom: 108, left: 20 });
  assertEquals(safeAreaOf(screen, frames, { device, fullscreen: true }), device);
});

/** 手で進める時計 */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const timers: RevealTimers = {
    setTimeout(callback, delay) { const id = next++; pending.set(id, { at: now + delay, callback }); return id; },
    clearTimeout(id) { pending.delete(id); },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, entry] of [...pending]) if (entry.at <= now) { pending.delete(id); entry.callback(); }
  };
  return { timers, advance };
}

function revealFixture() {
  const window = new Window();
  const document = window.document;
  const root = document.createElement("div") as unknown as HTMLElement;
  document.body.append(root as never);
  const frames = (["tl", "tc", "tr", "mr"] as const).map(slot => {
    const frame = document.createElement("div") as unknown as HTMLElement;
    frame.setAttribute("data-bina-reserve", slot);
    const rect = slot === "tl" ? box(8, -70, 200, 60) : slot === "tc" ? box(400, -70, 200, 52) : slot === "tr" ? box(800, -70, 192, 52) : box(1070, 300, 60, 200);
    frame.getBoundingClientRect = () => rect as DOMRect;
    root.append(frame);
    return frame;
  });
  const clock = fakeTimers();
  const reveal = mountEdgeReveal(root, { frames: () => frames, timers: clock.timers });
  const strip = (edge: string) => root.querySelector<HTMLElement>(`.bina-shell-edge[data-edge=${edge}]`)!;
  const pointer = (target: HTMLElement, type: string, init: Record<string, unknown> = {}) =>
    target.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, ...init }) as unknown as Event);
  return { window, root, frames, reveal, strip, pointer, ...clock };
}

Deno.test("フルスクリーンの辺の帯を押すと、近い置き場の枠だけが出て 3 秒で戻る", () => {
  const { reveal, strip, pointer, frames, advance } = revealFixture();
  assert(strip("top").hidden, "フルスクリーンでないときは帯を出さない");
  reveal.setFullscreen(true);
  assert(!strip("top").hidden);
  pointer(strip("top"), "pointerdown", { clientX: 60, clientY: 2 });
  assertEquals(reveal.revealed, "tl");
  assertEquals(frames.filter(frame => frame.hasAttribute("data-bina-revealed")).map(frame => frame.getAttribute("data-bina-reserve")), ["tl"]);
  pointer(strip("right"), "pointerdown", { clientX: 996, clientY: 420 });
  assertEquals(reveal.revealed, "mr", "別の帯を押すと、前の枠は戻る");
  advance(2999);
  assertEquals(reveal.revealed, "mr");
  advance(1);
  assertEquals(reveal.revealed, undefined);
  assert(!frames.some(frame => frame.hasAttribute("data-bina-revealed")));
});

Deno.test("呼び出した枠は、ポインタが上にある・触っているあいだは戻さない", () => {
  const { reveal, strip, pointer, frames, advance, root } = revealFixture();
  reveal.setFullscreen(true);
  pointer(strip("top"), "pointerdown", { clientX: 500, clientY: 2 });
  assertEquals(reveal.revealed, "tc");
  const tc = frames[1]!;
  pointer(tc, "pointerover");
  advance(10000);
  assertEquals(reveal.revealed, "tc");
  pointer(tc, "pointerout", { relatedTarget: root });
  advance(2000);
  pointer(tc, "pointerdown");
  advance(10000);
  assertEquals(reveal.revealed, "tc", "触っているあいだは戻さない");
  pointer(tc, "pointerup");
  advance(3000);
  assertEquals(reveal.revealed, undefined);
  pointer(strip("top"), "pointerdown", { clientX: 900, clientY: 2 });
  assertEquals(reveal.revealed, "tr");
  reveal.setFullscreen(false);
  assertEquals(reveal.revealed, undefined, "フルスクリーンが終われば、出した枠も戻す");
  assert(strip("top").hidden);
});

Deno.test("前面のアプリのフルスクリーンで、表示は枠を退ける印と辺の帯を出す", () => {
  const window = new Window();
  const element = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.append(element as never);
  const ui = createShellUi(element, { installed: true });
  const shell = element.querySelector<HTMLElement>(".bina-shell")!;
  const view = { instances: [], front: undefined, apps: [], clearError: false, cadreUnavailable: false };
  ui.update({ ...view, fullscreen: true });
  assert(shell.classList.contains("bina-shell-fullscreen"));
  assert([...element.querySelectorAll<HTMLElement>(".bina-shell-edge")].every(strip => !strip.hidden));
  ui.update({ ...view, fullscreen: false });
  assert(!shell.classList.contains("bina-shell-fullscreen"));
  assert([...element.querySelectorAll<HTMLElement>(".bina-shell-edge")].every(strip => strip.hidden));
  ui.update({ ...view, fullscreen: true, cadreUnavailable: true });
  assert(!shell.classList.contains("bina-shell-fullscreen"), "Cadre が落ちて最低限の大枠を出しているときは退けない");
  ui.stop();
});
