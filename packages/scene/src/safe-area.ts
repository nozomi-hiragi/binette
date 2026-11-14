import type { SafeArea } from "@binette/regie";

/** 画面上の箱。getBoundingClientRect と同じ向き（px） */
export interface Box {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** OS の枠（Décor の reserve）の置き場と、画面上の箱 */
export interface Frame {
  slot: string;
  box: Box;
}

/** {@link safeAreaOf} の設定 */
export interface SafeAreaOptions {
  /** 端末の切り欠きなど（env(safe-area-inset-*)）の幅 */
  device?: SafeArea;
  /** 前面のアプリがフルスクリーンなら、枠は数えない */
  fullscreen?: boolean;
  /** 枠とアプリの中身のあいだのすき間 */
  gap?: number;
}

/** 枠とアプリの中身のあいだのすき間の既定（px） */
export const SAFE_AREA_GAP = 8;

/** 置き場の名前から、セーフエリアに数える辺。角と上下中央は上か下、ml・mr だけが左右に効く */
export function sideOf(slot: string): keyof SafeArea | undefined {
  if (slot === "tl" || slot === "tc" || slot === "tr") return "top";
  if (slot === "bl" || slot === "bc" || slot === "br") return "bottom";
  if (slot === "ml") return "left";
  if (slot === "mr") return "right";
  return undefined;
}

/** 表示領域に重なる枠から、各辺のセーフエリアを求める。各辺は、その辺の枠のいちばん奥＋すき間と、端末の分の大きいほう */
export function safeAreaOf(area: Box, frames: readonly Frame[], options: SafeAreaOptions = {}): SafeArea {
  const device = options.device ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const gap = options.gap ?? SAFE_AREA_GAP;
  const result: SafeArea = { top: positive(device.top), right: positive(device.right), bottom: positive(device.bottom), left: positive(device.left) };
  if (options.fullscreen) return rounded(result);
  for (const { slot, box } of frames) {
    // 隠れている枠（display: none）は大きさが 0 になる
    if (!(box.right > box.left) || !(box.bottom > box.top)) continue;
    const side = sideOf(slot);
    if (!side) continue;
    const depth = side === "top" ? box.bottom - area.top : side === "bottom" ? area.bottom - box.top : side === "left" ? box.right - area.left : area.right - box.left;
    if (depth > 0) result[side] = Math.max(result[side], depth + gap);
  }
  return rounded(result);
}

function positive(value: number): number { return Number.isFinite(value) && value > 0 ? value : 0; }
function rounded(area: SafeArea): SafeArea {
  return { top: Math.ceil(area.top), right: Math.ceil(area.right), bottom: Math.ceil(area.bottom), left: Math.ceil(area.left) };
}

/** フルスクリーンのあいだ、辺の帯で枠を呼び出すときの時計。テストで差し替える */
export interface RevealTimers {
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(id: number): void;
}

/** {@link mountEdgeReveal} の設定 */
export interface EdgeRevealOptions {
  /** 今ある枠の要素 */
  frames(): HTMLElement[];
  /** 呼び出した枠を戻すまでの時間（ms） */
  delay?: number;
  timers?: RevealTimers;
}

/** フルスクリーンのとき、消えた辺の細い帯で枠を呼び出す仕組み */
export interface EdgeReveal {
  setFullscreen(on: boolean): void;
  /** 今出ている枠の置き場。無ければ undefined */
  readonly revealed: string | undefined;
  stop(): void;
}

/** 呼び出した枠を戻すまでの既定（ms） */
export const REVEAL_DELAY = 3000;
const edges = ["top", "right", "bottom", "left"] as const;
type Edge = typeof edges[number];

/** 辺から呼び出せる置き場。上の辺なら上の 3 つ、左右の辺なら ml・mr */
function slotsOf(edge: Edge): string[] {
  return edge === "top" ? ["tl", "tc", "tr"] : edge === "bottom" ? ["bl", "bc", "br"] : edge === "left" ? ["ml"] : ["mr"];
}
/** 線分 [from, to] から点までの距離 */
function distance(point: number, from: number, to: number): number { return point < from ? from - point : point > to ? point - to : 0; }

/**
 * 辺の帯（`.bina-shell-edge`）を root に置き、触った位置にいちばん近い置き場の枠だけを出す。出した枠は delay で戻し、
 * ポインタが枠の上にある・触っているあいだは戻さない。帯と出した枠は CSS（`data-bina-revealed`）で動かす
 */
export function mountEdgeReveal(root: HTMLElement, options: EdgeRevealOptions): EdgeReveal {
  const document = root.ownerDocument;
  const window = document.defaultView!;
  const timers: RevealTimers = options.timers ?? { setTimeout: (callback, delay) => window.setTimeout(callback, delay), clearTimeout: id => window.clearTimeout(id) };
  const delay = options.delay ?? REVEAL_DELAY;
  let fullscreen = false;
  let shown: HTMLElement | undefined;
  let timer: number | undefined;
  let hovering = false;
  let touching = false;
  const strips = edges.map(edge => {
    const strip = document.createElement("div");
    strip.className = "bina-shell-edge";
    strip.setAttribute("data-edge", edge);
    strip.setAttribute("aria-hidden", "true");
    strip.hidden = true;
    strip.addEventListener("pointerdown", event => { event.preventDefault(); reveal(edge, event); });
    root.append(strip);
    return strip;
  });

  const cancel = () => { if (timer !== undefined) { timers.clearTimeout(timer); timer = undefined; } };
  const hide = () => {
    cancel();
    shown?.removeAttribute("data-bina-revealed");
    shown = undefined;
    hovering = false;
    touching = false;
  };
  /** 枠の上にも触ってもいなければ、delay のあとで戻す */
  const schedule = () => {
    cancel();
    if (shown && !hovering && !touching) timer = timers.setTimeout(() => { timer = undefined; hide(); }, delay);
  };
  function reveal(edge: Edge, event: PointerEvent): void {
    if (!fullscreen) return;
    const slots = slotsOf(edge);
    const vertical = edge === "left" || edge === "right";
    const point = vertical ? event.clientY : event.clientX;
    let best: HTMLElement | undefined;
    let bestDistance = Infinity;
    for (const frame of options.frames()) {
      if (!slots.includes(frame.getAttribute("data-bina-reserve") ?? "")) continue;
      // 隠れている枠も、辺に沿った向きの位置は変わらない
      const box = frame.getBoundingClientRect();
      const d = vertical ? distance(point, box.top, box.bottom) : distance(point, box.left, box.right);
      if (d < bestDistance) { best = frame; bestDistance = d; }
    }
    if (!best) return;
    if (shown !== best) { hide(); shown = best; best.setAttribute("data-bina-revealed", ""); }
    schedule();
  }
  const inside = (target: EventTarget | null) => shown !== undefined && target instanceof window.Node && shown.contains(target as Node);
  const over = (event: Event) => { if (inside(event.target)) { hovering = true; cancel(); } };
  const out = (event: Event) => {
    if (!inside(event.target) || inside((event as MouseEvent).relatedTarget)) return;
    hovering = false;
    schedule();
  };
  const down = (event: Event) => { if (inside(event.target)) { touching = true; cancel(); } };
  const up = () => { if (!touching) return; touching = false; schedule(); };
  root.addEventListener("pointerover", over);
  root.addEventListener("pointerout", out);
  root.addEventListener("pointerdown", down);
  document.addEventListener("pointerup", up);
  document.addEventListener("pointercancel", up);

  return {
    setFullscreen(on) {
      if (fullscreen === on) return;
      fullscreen = on;
      for (const strip of strips) strip.hidden = !on;
      if (!on) hide();
    },
    get revealed() { return shown?.getAttribute("data-bina-reserve") ?? undefined; },
    stop() {
      hide();
      root.removeEventListener("pointerover", over);
      root.removeEventListener("pointerout", out);
      root.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      for (const strip of strips) strip.remove();
    },
  };
}

/** 端末の切り欠きの幅（env(safe-area-inset-*)）を読む。読めないブラウザでは 0 */
export function deviceInsets(probe: HTMLElement): SafeArea {
  const style = probe.ownerDocument.defaultView?.getComputedStyle(probe);
  const read = (name: string) => { const value = Number.parseFloat(style?.getPropertyValue(name) ?? ""); return Number.isFinite(value) && value > 0 ? value : 0; };
  return { top: read("padding-top"), right: read("padding-right"), bottom: read("padding-bottom"), left: read("padding-left") };
}
