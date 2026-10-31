import type { DomOp } from "@binette/core";
import { alignments, dividerSides, surfaces, tones, variants } from "./parts.ts";
/** DOM からアプリに届くイベント。 */
export interface UiEvents {
  dispatchUi(handle: number): void;
  dispatchUiText(handle: number, value: string, version: number): void;
  /** 値を返す部品（checkbox・radio・slider・picker・segmented・tabs）の操作。無いときはその操作を届けない */
  dispatchUiValue?(handle: number, value: number, version: number): void;
}
/** 宣言 UI の DOM 設定。 */
export interface UiDomOptions { apps?: { icon?: string }[]; }
type TextField = HTMLInputElement | HTMLTextAreaElement;
const steps = ["xs", "sm", "md", "lg", "xl"];
const length = (value: number): string => value <= -1 && value >= -5 && Number.isInteger(value)
  ? `var(--bina-ui-space-${steps[-value - 1]}, var(--bina-ui-default-space-${steps[-value - 1]}))` : `${Math.max(0, value)}px`;
const themeDefaults = [
  ["space", [4, 8, 12, 16, 24]], ["radius", [2, 4, 8, 12, 16]], ["font-size", [12, 14, 16, 20, 24]],
] as const;
// 段の選択だけを継承し、長さの参照は使用する部品で解決する。
function componentLength(kind: string, field: string, group: string, fallback: string): string {
  const prefix = `--bina-ui-${kind}-${field}`;
  const defaults = themeDefaults.find(([name]) => name === group)![1];
  return `calc(var(${prefix}-px, ${fallback}) + ${steps.map((step, i) => `var(${prefix}-${step}, 0) * var(--bina-ui-${group}-${step}, ${defaults[i]}px)`).join(" + ")})`;
}
// OS の役割の色。ホストが変数を与えないときは白地のライトテーマの値を使う
const colors: Record<string, string> = {
  accent: "var(--bina-ui-accent, #3273b9)",
  accentContent: "var(--bina-ui-accent-content, #fff)",
  accentSoft: "var(--bina-ui-accent-soft, #e6eef8)",
  accentText: "var(--bina-ui-accent-text, var(--bina-ui-accent, #3273b9))",
  surface: "var(--bina-ui-surface, #fff)",
  sunken: "var(--bina-ui-sunken, #eceef1)",
  subtle: "var(--bina-ui-subtle, #f3f5f8)",
  line: "var(--bina-ui-line, #e3e6ea)",
  muted: "var(--bina-ui-muted, #6b7280)",
  danger: "var(--bina-ui-danger, #c4352b)",
  success: "var(--bina-ui-success, #2e7d4f)",
  focus: "var(--bina-ui-focus, #3273b9)",
};
// variant 付きのボタンは小さめの道具の形にする。角丸は theme を優先する
const controlRadius: string = componentLength("button", "radius", "radius", "var(--bina-ui-control-radius, 6px)");
const variantPadding = (block: string, inline: string): string => `${componentLength("button", "padding", "space", block)} ${componentLength("button", "padding", "space", inline)}`;
// surface("dark") と surface("field") の中の入力欄は、それぞれの面の見た目にする
const plainInput = ".bina-ui-input:not(.bina-ui-surface-dark *, .bina-ui-surface-field > *)";
/** 入力欄の未指定の padding。既定の入力欄は CSS の変数で余白を持ち、theme の値があればそちらを使う */
const inputPadding = `var(--bina-ui-input-default-padding, ${componentLength("input", "padding", "space", "0px")})`;
/** 選択肢を持つ部品（picker・segmented・tabs） */
const choiceKinds = ["picker", "segmented", "tabs"];
/** Scene の document 方式の sanitize と同じく、画像は base64 のラスターの data URL だけを描く */
const rasterDataUrl = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]+={0,2}$/i;
/** align の名前ごとの縦と横の位置 */
const alignParts: Record<string, [string, string]> = {
  topStart: ["start", "start"], top: ["start", "center"], topEnd: ["start", "end"],
  start: ["center", "start"], center: ["center", "center"], end: ["center", "end"],
  bottomStart: ["end", "start"], bottom: ["end", "center"], bottomEnd: ["end", "end"],
};
const flexPosition = (value: string): string => value === "center" ? "center" : `flex-${value}`;
const alignCss: string = alignments.map(name => {
  const [vertical, horizontal] = alignParts[name]!;
  return `:where(.bina-ui-stack > .bina-ui-align-${name}) { align-self: ${vertical}; justify-self: ${horizontal}; }
:where(.bina-ui-column > .bina-ui-align-${name}) { align-self: ${flexPosition(horizontal)}; }
:where(.bina-ui-row > .bina-ui-align-${name}) { align-self: ${flexPosition(vertical)}; }`;
}).join("\n");
// チェックの印。アクセントの塗りの上に白で描く
const checkMark = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.5l3 3 6-7' fill='none' stroke='white' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`;
/** よくある部品の見た目。どれも OS の役割の色を使い、ライトとダークで同じ規則にする */
const partCss: string = `
:where(.bina-ui-spacer) { flex: 1 1 0; min-width: 0; min-height: 0; }
:where(.bina-ui-separator) { box-sizing: border-box; flex: none; align-self: stretch; height: 1px; margin: 0; border: 0; background: ${colors.line}; }
:where(.bina-ui-row > .bina-ui-separator) { width: 1px; height: auto; min-height: 1em; }
:where(.bina-ui-stack) { display: grid; grid-template: minmax(0, auto) / minmax(0, 1fr); place-items: start; }
:where(.bina-ui-stack > *) { grid-area: 1 / 1; }
:where(.bina-ui-stack.bina-ui-center) { place-items: center; }
:where(.bina-ui-stack > .bina-ui-fill) { place-self: stretch; }
${alignCss}
:where(.bina-ui-checkbox, .bina-ui-radio) { appearance: none; box-sizing: border-box; flex: none; width: 18px; height: 18px; margin: 0; border: 1.5px solid color-mix(in srgb, ${colors.muted} 80%, transparent); background: ${colors.surface} no-repeat center / 100%; cursor: pointer; transition: background-color 0.12s, border-color 0.12s; }
:where(.bina-ui-checkbox) { border-radius: 4px; }
:where(.bina-ui-radio) { border-radius: 50%; }
:where(.bina-ui-checkbox:checked) { border-color: ${colors.accent}; background-color: ${colors.accent}; background-image: ${checkMark}; }
:where(.bina-ui-radio:checked) { border-color: ${colors.accent}; background-image: radial-gradient(circle, ${colors.accent} 0 4px, transparent 4.5px); }
:where(.bina-ui-slider) { appearance: none; box-sizing: border-box; min-width: 96px; height: 24px; margin: 0; background: transparent; accent-color: ${colors.accent}; cursor: pointer; }
:where(.bina-ui-slider)::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: linear-gradient(${colors.accent}, ${colors.accent}) 0 0 / var(--bina-ui-slider-fill, 0%) 100% no-repeat, color-mix(in srgb, ${colors.accent} 18%, transparent); }
:where(.bina-ui-slider)::-moz-range-track { height: 4px; border-radius: 2px; background: color-mix(in srgb, ${colors.accent} 18%, transparent); }
:where(.bina-ui-slider)::-moz-range-progress { height: 4px; border-radius: 2px; background: ${colors.accent}; }
:where(.bina-ui-slider)::-webkit-slider-thumb { appearance: none; box-sizing: border-box; width: 18px; height: 18px; margin-top: -7px; border: 2px solid ${colors.surface}; border-radius: 50%; background: ${colors.accent}; box-shadow: 0 1px 3px rgb(0 0 0 / 30%); }
:where(.bina-ui-slider)::-moz-range-thumb { box-sizing: border-box; width: 18px; height: 18px; border: 2px solid ${colors.surface}; border-radius: 50%; background: ${colors.accent}; box-shadow: 0 1px 3px rgb(0 0 0 / 30%); }
:where(.bina-ui-picker) { appearance: none; box-sizing: border-box; min-width: 0; max-width: 100%; padding: 6px 30px 6px 10px; font: inherit; color: inherit; border: 1px solid ${colors.line}; border-radius: var(--bina-ui-input-radius, var(--bina-ui-control-radius, 6px)); cursor: pointer;
  background: linear-gradient(45deg, transparent 50%, ${colors.muted} 50%) calc(100% - 15px) 50% / 5px 5px no-repeat, linear-gradient(135deg, ${colors.muted} 50%, transparent 50%) calc(100% - 10px) 50% / 5px 5px no-repeat, ${colors.surface}; }
:where(.bina-ui-picker option) { color: CanvasText; background: Canvas; }
:where(.bina-ui-checkbox, .bina-ui-radio, .bina-ui-slider):focus-visible { outline: 2px solid ${colors.focus}; outline-offset: 2px; }
:where(.bina-ui-picker:focus-visible) { outline: 2px solid ${colors.focus}; outline-offset: -1px; }
:where(.bina-ui-checkbox, .bina-ui-radio, .bina-ui-slider, .bina-ui-picker):disabled { cursor: default; opacity: var(--bina-ui-disabled-opacity, 0.5); }
:where(.bina-ui-option) { margin: 0; border: 0; background: transparent; font: inherit; color: inherit; cursor: pointer; white-space: nowrap; }
:where(.bina-ui-option):focus-visible { outline: 2px solid ${colors.focus}; outline-offset: -2px; }
:where(.bina-ui-option:disabled) { cursor: default; opacity: var(--bina-ui-disabled-opacity, 0.5); }
:where(.bina-ui-segmented) { display: inline-flex; align-items: stretch; box-sizing: border-box; max-width: 100%; border: 1px solid ${colors.line}; border-radius: ${controlRadius}; background: ${colors.surface}; overflow: hidden; }
:where(.bina-ui-segmented > .bina-ui-option) { flex: 1 1 0; min-width: 0; min-height: 32px; padding: 4px 14px; overflow: hidden; text-overflow: ellipsis; }
:where(.bina-ui-segmented > .bina-ui-option + .bina-ui-option) { border-inline-start: 1px solid ${colors.line}; }
:where(.bina-ui-segmented > .bina-ui-option:not(:disabled):hover) { background: ${colors.subtle}; }
:where(.bina-ui-segmented > .bina-ui-option[aria-checked="true"]) { background: ${colors.accentSoft}; color: ${colors.accentText}; font-weight: 600; }
:where(.bina-ui-tabs) { display: flex; align-items: stretch; gap: 4px; min-width: 0; overflow-x: auto; scrollbar-width: none; box-shadow: inset 0 -1px 0 ${colors.line}; }
:where(.bina-ui-tabs > .bina-ui-option) { flex: none; min-height: 40px; padding: 8px 12px; color: ${colors.muted}; }
:where(.bina-ui-tabs > .bina-ui-option:not(:disabled):hover) { color: inherit; }
:where(.bina-ui-tabs > .bina-ui-option[aria-selected="true"]) { color: ${colors.accentText}; font-weight: 600; box-shadow: inset 0 -2px 0 ${colors.accent}; }
:where(.bina-ui-progress) { position: relative; box-sizing: border-box; height: 4px; min-width: 48px; border-radius: 2px; background: color-mix(in srgb, ${colors.accent} 18%, transparent); overflow: hidden; }
:where(.bina-ui-row > .bina-ui-progress) { flex: 1 1 120px; }
:where(.bina-ui-progress)::before { content: ""; position: absolute; inset: 0 auto 0 0; width: var(--bina-ui-progress, 0%); border-radius: inherit; background: ${colors.accent}; transition: width 0.2s; }
:where(.bina-ui-progress.bina-ui-indeterminate)::before { width: 40%; transition: none; animation: bina-ui-indeterminate 1.4s ease-in-out infinite; }
@keyframes bina-ui-indeterminate { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
:where(.bina-ui-spinner) { box-sizing: border-box; flex: none; width: 20px; aspect-ratio: 1; border: 2.5px solid color-mix(in srgb, ${colors.accent} 20%, transparent); border-top-color: ${colors.accent}; border-radius: 50%; animation: bina-ui-spin 0.8s linear infinite; }
@keyframes bina-ui-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  :where(.bina-ui-spinner) { animation-duration: 2.4s; }
  :where(.bina-ui-progress.bina-ui-indeterminate)::before { animation-duration: 4s; }
  :where(.bina-ui-progress)::before, :where(.bina-ui-checkbox, .bina-ui-radio) { transition: none; }
}
:where(.bina-ui-image) { display: block; max-width: 100%; height: auto; object-fit: cover; }
:where(.bina-ui-listTile) { display: flex; align-items: center; box-sizing: border-box; min-height: 48px; text-align: start; }
:where(.bina-ui-listTile.bina-ui-listitem) { display: flex; list-style: none; }
:where(.bina-ui-listTile > .bina-ui-grow) { min-width: 0; overflow-wrap: anywhere; }
:where(.bina-ui-chip) { display: inline-flex; align-items: center; box-sizing: border-box; flex: none; max-width: 100%; min-height: 24px; border: 1px solid ${colors.line}; border-radius: 999px; background: ${colors.surface}; font-size: var(--bina-ui-small, 12.5px); line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
:where(.bina-ui-chip.bina-ui-tone-muted) { color: ${colors.muted}; background: ${colors.subtle}; border-color: transparent; }
:where(.bina-ui-chip.bina-ui-tone-accent) { color: ${colors.accentText}; background: ${colors.accentSoft}; border-color: transparent; }
:where(.bina-ui-chip.bina-ui-tone-danger) { color: ${colors.danger}; background: color-mix(in srgb, ${colors.danger} 12%, transparent); border-color: transparent; }
:where(.bina-ui-chip.bina-ui-tone-success) { color: ${colors.success}; background: color-mix(in srgb, ${colors.success} 12%, transparent); border-color: transparent; }
:where(.bina-ui-badge) { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; flex: none; min-width: 18px; height: 18px; border-radius: 9px; background: ${colors.accent}; color: ${colors.accentContent}; font-size: 11px; font-weight: 600; line-height: 1; white-space: nowrap; font-variant-numeric: tabular-nums; }
:where(.bina-ui-badge.bina-ui-tone-muted) { background: ${colors.subtle}; color: ${colors.muted}; }
:where(.bina-ui-badge.bina-ui-tone-danger) { background: ${colors.danger}; color: ${colors.surface}; }
:where(.bina-ui-badge.bina-ui-tone-success) { background: ${colors.success}; color: ${colors.surface}; }
/* align() を付けた子は、既定の左寄せより align() を優先する */
:where(.bina-ui-column > :is(.bina-ui-chip, .bina-ui-badge, .bina-ui-segmented, .bina-ui-image):not(.bina-ui-grow):not([class*="bina-ui-align-"])) { align-self: flex-start; }
`;
const lookCss: string = `
:where(.bina-ui-button[class*="bina-ui-variant-"]) { display: inline-flex; align-items: center; justify-content: center; border-radius: ${controlRadius}; }
:where(.bina-ui-button.bina-ui-variant-ghost:has(> *), .bina-ui-button.bina-ui-variant-subtle:has(> *)) { align-items: stretch; text-align: start; }
:where(.bina-ui-button.bina-ui-variant-primary) { background: ${colors.accent}; border-color: ${colors.accent}; color: ${colors.accentContent}; }
:where(.bina-ui-button.bina-ui-variant-primary:not(:disabled):hover) { background: color-mix(in srgb, ${colors.accent} 86%, #000); }
:where(.bina-ui-button.bina-ui-variant-ghost, .bina-ui-button.bina-ui-variant-danger) { background: transparent; border-color: transparent; color: ${colors.muted}; }
:where(.bina-ui-button.bina-ui-variant-ghost:not(:disabled):hover) { background: ${colors.subtle}; color: inherit; }
:where(.bina-ui-button.bina-ui-variant-danger) { color: ${colors.danger}; }
:where(.bina-ui-button.bina-ui-variant-danger:not(:disabled):hover) { background: color-mix(in srgb, ${colors.danger} 12%, transparent); }
:where(.bina-ui-button.bina-ui-variant-subtle) { background: ${colors.subtle}; border-color: transparent; }
:where(.bina-ui-button.bina-ui-variant-subtle:not(:disabled):hover) { background: color-mix(in srgb, ${colors.subtle} 90%, currentColor); }
:where(.bina-ui-button.bina-ui-variant-dashed) { background: transparent; border: 1px dashed color-mix(in srgb, ${colors.muted} 50%, transparent); }
:where(.bina-ui-button.bina-ui-variant-dashed:not(:disabled):hover) { background: ${colors.subtle}; border-color: ${colors.accent}; }
:where(.bina-ui-text.bina-ui-tone-muted) { color: ${colors.muted}; }
:where(.bina-ui-text.bina-ui-tone-accent) { color: ${colors.accentText}; }
:where(.bina-ui-text.bina-ui-tone-danger) { color: ${colors.danger}; }
:where(.bina-ui-text.bina-ui-tone-success) { color: ${colors.success}; }
:where(.bina-ui-surface-surface) { background: ${colors.surface}; }
:where(.bina-ui-surface-sunken) { background: ${colors.sunken}; }
:where(.bina-ui-surface-card) { background: ${colors.surface}; border-radius: var(--bina-ui-card-radius, 14px); box-shadow: var(--bina-ui-shadow, 0 1px 2px rgb(0 0 0 / 6%), 0 8px 24px rgb(0 0 0 / 8%)); }
:where(.bina-ui-surface-dark) {
  background: var(--bina-ui-dark, #16181d); color: var(--bina-ui-dark-content, #d7dae0); color-scheme: dark;
  --bina-ui-muted: var(--bina-ui-dark-muted, #9aa0aa); --bina-ui-line: var(--bina-ui-dark-line, #2e323a);
  --bina-ui-subtle: var(--bina-ui-dark-subtle, rgb(255 255 255 / 8%)); --bina-ui-surface: rgb(255 255 255 / 4%);
  --bina-ui-accent-text: var(--bina-ui-dark-accent, #82aaff); --bina-ui-accent-soft: rgb(130 170 255 / 16%);
  --bina-ui-danger: var(--bina-ui-dark-danger, #ff8a80); --bina-ui-success: var(--bina-ui-dark-success, #7ec699);
  --bina-ui-button-background: rgb(255 255 255 / 6%); --bina-ui-button-border: var(--bina-ui-dark-line, #2e323a);
}
:where(.bina-ui-surface-dark .bina-ui-input) { background: transparent; border: 0; color: inherit; }
:where(.bina-ui-surface-dark .bina-ui-input:focus-visible) { outline: 1px solid ${colors.line}; outline-offset: 0; }
:where(.bina-ui-surface-field) { align-items: stretch; border: 1px solid ${colors.line}; border-radius: ${controlRadius}; background: ${colors.surface}; overflow: hidden; }
:where(.bina-ui-surface-field > .bina-ui-input) { flex: 1 1 0; min-width: 0; border: 0; border-radius: 0; background: transparent; outline: none; }
:where(.bina-ui-surface-field > .bina-ui-button + .bina-ui-input) { text-align: center; }
:where(.bina-ui-surface-field > .bina-ui-button) { border: 0; border-radius: 0; }
:where(.bina-ui-surface-field > .bina-ui-button:not([class*="bina-ui-variant-"])) { background: ${colors.subtle}; }
:where(.bina-ui-surface-field > .bina-ui-button):focus-visible { outline-offset: -2px; }
:where(.bina-ui-surface-field > * + *) { border-inline-start: 1px solid ${colors.line}; }
:where(.bina-ui-surface-field:has(> .bina-ui-input:focus-visible)) { outline: 2px solid ${colors.focus}; outline-offset: -1px; }
:where(.bina-ui-divider-top) { border-top: 1px solid ${colors.line}; }
:where(.bina-ui-divider-right) { border-right: 1px solid ${colors.line}; }
:where(.bina-ui-divider-bottom) { border-bottom: 1px solid ${colors.line}; }
:where(.bina-ui-divider-left) { border-left: 1px solid ${colors.line}; }
:where(.bina-ui-mono) { font-family: var(--bina-ui-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); }
:where(.bina-ui-small) { font-size: var(--bina-ui-small, 12.5px); }
:where(.bina-ui-bold) { font-weight: 600; }
:where(.bina-ui-text.bina-ui-truncate) { display: block; min-width: 0; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
:where(.bina-ui-button.bina-ui-variant-ghost, .bina-ui-button.bina-ui-variant-subtle, .bina-ui-button.bina-ui-variant-dashed, .bina-ui-surface-field > .bina-ui-button, .bina-ui-button.bina-ui-small) { min-width: 0; min-height: 0; }
:where(.bina-ui-column > .bina-ui-button.bina-ui-grow) { flex-grow: 0; align-self: stretch; }
:where(.bina-ui-width) { box-sizing: border-box; width: var(--bina-ui-width); max-width: 100%; flex-shrink: 0; }
:where(.bina-ui-height) { box-sizing: border-box; height: var(--bina-ui-height); min-height: 0; flex-shrink: 0; }
:where(.bina-ui-wrap) { flex-wrap: wrap; }
:where(.bina-ui-center) { justify-content: safe center; align-items: safe center; }
:where(.bina-ui-scroll) { overflow: auto; min-height: 0; min-width: 0; }
:where(.bina-ui-button.bina-ui-selected) { background: ${colors.accentSoft}; color: inherit; }
:where(.bina-ui-highlight:not(:focus-visible), .bina-ui-selected:not(.bina-ui-button):not(:focus-visible)) { outline: 1.5px solid ${colors.accent}; outline-offset: 2px; }
:where(${plainInput}) { border: 1px solid ${colors.line}; border-radius: ${componentLength("input", "radius", "radius", "var(--bina-ui-input-radius, var(--bina-ui-control-radius, 6px))")}; background: ${colors.surface}; --bina-ui-input-default-padding: ${componentLength("input", "padding", "space", "6px")} ${componentLength("input", "padding", "space", "8px")}; }
:where(${plainInput}:focus) { outline: 2px solid ${colors.focus}; outline-offset: -1px; }
:where(${plainInput}:disabled) { opacity: var(--bina-ui-disabled-opacity, 0.5); }
:where(.bina-ui-toggle) { position: relative; flex: none; box-sizing: border-box; width: 32px; height: 18px; min-width: 32px; min-height: 18px; padding: 0; border: 0; border-radius: 9px; background: color-mix(in srgb, ${colors.muted} 55%, transparent); }
:where(.bina-ui-toggle)::before { content: ""; position: absolute; inset: -13px -6px; }
:where(.bina-ui-toggle)::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgb(0 0 0 / 20%); transition: transform 0.15s; }
:where(.bina-ui-toggle[aria-checked="true"]) { background: ${colors.accent}; }
:where(.bina-ui-toggle[aria-checked="true"])::after { transform: translateX(14px); }
@media (prefers-reduced-motion: reduce) { :where(.bina-ui-toggle)::after { transition: none; } }
:where(:not([class^="bina-ui-"]):has(> .bina-ui-collapse, > [class^="bina-ui-"] .bina-ui-collapse)) { container: bina-ui / inline-size; }
@container bina-ui (width < 720px) {
  :where(.bina-ui-collapse) { flex-direction: column; align-items: stretch; }
  :where(.bina-ui-collapse > *) { width: auto; align-self: stretch; }
  :where(.bina-ui-collapse > .bina-ui-divider-left, .bina-ui-collapse > .bina-ui-divider-right) { border-left: 0; border-right: 0; }
  :where(.bina-ui-collapse > .bina-ui-divider-right) { border-bottom: 1px solid ${colors.line}; }
  :where(.bina-ui-collapse > .bina-ui-divider-left) { border-top: 1px solid ${colors.line}; }
  :where(.bina-ui-collapse > .bina-ui-separator) { width: auto; height: 1px; min-height: 0; }
  :where(.bina-ui-collapse > .bina-ui-divider-right + .bina-ui-divider-left:not(.bina-ui-divider-top)) { border-top: 0; }
  :where(.bina-ui-fill:has(.bina-ui-collapse), .bina-ui-collapse, .bina-ui-collapse .bina-ui-fill, .bina-ui-collapse .bina-ui-scroll) { flex: none; min-height: auto; overflow: visible; }
}
`;
// highlight と button 以外の selected の角丸 4px は先頭に置き、角丸を持つ部品（button・input・card など）は自分の角丸を保つ
export const uiCss = `
:where([class^="bina-ui-"]) { ${themeDefaults.flatMap(([group, values]) => values.map((value, i) => `--bina-ui-default-${group}-${steps[i]}: ${value}px;`)).join(" ")} }

:where([class^="bina-ui-"])[hidden] { display: none !important; }
:where(.bina-ui-highlight, .bina-ui-selected:not(.bina-ui-button)) { border-radius: 4px; }
:where(.bina-ui-column) { display: flex; flex-direction: column; }
:where(.bina-ui-column > .bina-ui-button:not(.bina-ui-grow):not([class*="bina-ui-align-"])) { align-self: flex-start; }
/* center() を付けた column では、ボタンも中央に置く */
:where(.bina-ui-column.bina-ui-center > .bina-ui-button:not(.bina-ui-grow):not([class*="bina-ui-align-"])) { align-self: auto; }
:where(.bina-ui-row) { display: flex; flex-direction: row; align-items: center; }
:where(.bina-ui-grid) { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--bina-ui-minWidth, 112px)), 1fr)); align-content: start; background: var(--bina-ui-grid-background, transparent); }
:where(.bina-ui-appIcon) { width: var(--bina-ui-icon-size, 56px); height: var(--bina-ui-icon-size, 56px); object-fit: contain; }
:where(.bina-ui-input) { font: inherit; font-size: ${componentLength("input", "font-size", "font-size", "1em")}; border-radius: ${componentLength("input", "radius", "radius", "var(--bina-ui-input-radius, 0px)")}; color: inherit; min-width: 0; }
:where(textarea.bina-ui-input:not(.bina-ui-height)) { min-height: 8lh; }
:where(textarea.bina-ui-input) { resize: vertical; }
:where(.bina-ui-column, .bina-ui-row, .bina-ui-grid, .bina-ui-listTile) { gap: var(--bina-ui-gap, 0px); }
:where(.bina-ui-column, .bina-ui-row, .bina-ui-text, .bina-ui-button, .bina-ui-grid, .bina-ui-input, .bina-ui-stack, .bina-ui-listTile, .bina-ui-chip, .bina-ui-badge) { padding: var(--bina-ui-padding, 0px); }
:where(.bina-ui-button) { padding: var(--bina-ui-padding, ${componentLength("button", "padding", "space", "0px")}); }
:where(.bina-ui-input) { padding: var(--bina-ui-padding, ${inputPadding}); }
:where(.bina-ui-fill) { flex: 1 1 0; min-height: 0; align-self: stretch; }
:where(.bina-ui-row > .bina-ui-fill) { flex: 0 1 auto; }
:where(.bina-ui-grow) { flex-grow: 1; }
:where(.bina-ui-button) { font: inherit; font-size: ${componentLength("button", "font-size", "font-size", "1em")}; color: var(--bina-ui-button-color, inherit); background: var(--bina-ui-button-background, #fff); border: 1px solid var(--bina-ui-button-border, #d5dae1); border-radius: ${componentLength("button", "radius", "radius", "var(--bina-ui-button-radius, 8px)")}; cursor: pointer; min-width: 44px; min-height: 44px; overflow-wrap: anywhere; }
:where(.bina-ui-button:has(> *)) { display: flex; flex-direction: column; align-items: center; gap: var(--bina-ui-gap, 0px); }
:where(.bina-ui-button):focus-visible { outline: 2px solid var(--bina-ui-focus, #3273b9); outline-offset: 2px; }
:where(.bina-ui-button):disabled { cursor: default; opacity: var(--bina-ui-disabled-opacity, 0.5); }
:where(.bina-ui-heading-1) { font-size: 2em; font-weight: bold; }
:where(.bina-ui-heading-2) { font-size: 1.5em; font-weight: bold; }
:where(.bina-ui-heading-3) { font-size: 1.17em; font-weight: bold; }
:where(.bina-ui-list) { padding-inline-start: 1.5em; }
:where(.bina-ui-listitem) { display: list-item; list-style: disc; }
${partCss}
${lookCss}`;

type UiUpdate = Extract<DomOp, { op: "ui-update" }>;
const lookFlags = ["mono", "small", "bold", "truncate", "center", "scroll", "fill", "collapse", "wrap", "highlight"] as const;
/** 部品ごとの未指定の padding。ほかの部品は 0 */
const kindPadding: Record<string, string> = { listTile: `${length(-2)} ${length(-3)}`, chip: "2px 10px", badge: "0 5px" };
/** 部品が自分で持つ role。値を持つ部品のうちネイティブの要素はその role のままにする */
const kindRoles: Record<string, string> = { segmented: "radiogroup", tabs: "tablist", progress: "progressbar", spinner: "progressbar" };
const nativeKinds = ["checkbox", "radio", "slider", "picker", "image", "separator"];
/** 文字を自分の子として描く部品 */
const textKinds = ["text", "button", "chip", "badge"];
// 値が変わるときだけ書き換え、描き直しで DOM を無駄に触らない
function setClass(node: HTMLElement, name: string, on: boolean): void {
  if (node.classList.contains(name) !== on) node.classList.toggle(name, on);
}
function setAttribute(node: HTMLElement, name: string, value: string | null): void {
  if (value === null) { if (node.hasAttribute(name)) node.removeAttribute(name); }
  else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}
function setLength(node: HTMLElement, property: string, value: number | undefined): boolean {
  const next = value !== undefined && Number.isFinite(value) && value > 0 ? `${value}px` : "";
  if (node.style.getPropertyValue(property) !== next) {
    if (next) node.style.setProperty(property, next);
    else node.style.removeProperty(property);
  }
  return next !== "";
}
/** 未指定の padding。variant 付きのボタンは小さめの道具の余白にし、theme の値があればそちらを使う */
function buttonPadding(op: UiUpdate): string {
  if (!op.variant || !variants.includes(op.variant) || op.toggle !== undefined) return componentLength("button", "padding", "space", "0px");
  return op.variant === "dashed" ? variantPadding("2px", "8px") : variantPadding("4px", "10px");
}
/** 見た目の修飾をクラスと属性にする。名前はアプリから届くので、知っているものだけをクラスにする */
function applyLook(node: HTMLElement, op: UiUpdate, isButton: boolean, toggle: boolean): void {
  for (const name of variants) setClass(node, `bina-ui-variant-${name}`, op.variant === name);
  for (const name of tones) setClass(node, `bina-ui-tone-${name}`, op.tone === name);
  // 面は column・row・grid だけに効く
  const layout = ["bina-ui-column", "bina-ui-row", "bina-ui-grid"].some(name => node.classList.contains(name));
  for (const name of surfaces) setClass(node, `bina-ui-surface-${name}`, layout && op.surface === name);
  const sides = (op.divider ?? "").split(" ");
  for (const side of dividerSides) setClass(node, `bina-ui-divider-${side}`, sides.includes(side));
  for (const name of lookFlags) setClass(node, `bina-ui-${name}`, op[name] === true);
  setClass(node, "bina-ui-width", setLength(node, "--bina-ui-width", op.width));
  setClass(node, "bina-ui-height", setLength(node, "--bina-ui-height", op.height));
  setLength(node, "min-height", op.minHeight);
  setClass(node, "bina-ui-selected", op.selected === true);
  setAttribute(node, "aria-pressed", isButton && !toggle && op.selected !== undefined ? String(op.selected) : null);
  setClass(node, "bina-ui-toggle", toggle);
  setAttribute(node, "aria-checked", toggle ? String(op.toggle) : null);
  setAttribute(node, "placeholder", node.classList.contains("bina-ui-input") && op.placeholder ? op.placeholder : null);
  for (const name of alignments) setClass(node, `bina-ui-align-${name}`, op.align === name);
}

/** スライダーの塗る長さ。WebKit 系の track は進んだ部分を持たないので、割合を変数で渡す */
function fillSlider(field: HTMLInputElement): void {
  const min = Number(field.min), max = Number(field.max), value = Number(field.value);
  const ratio = max > min && Number.isFinite(value) ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  const next = `${ratio * 100}%`;
  if (field.style.getPropertyValue("--bina-ui-slider-fill") !== next) field.style.setProperty("--bina-ui-slider-fill", next);
}
/** 宣言 UI の DOM 操作の適用先。 */
export interface UiDom {
  apply(ops: DomOp[]): void;
  stop(): void;
  clear(): void;
}
/** 宣言 UI の操作を DOM に反映する。 */
export function createUiDom(element: HTMLElement, process: UiEvents, options: UiDomOptions = {}): UiDom {
  // 宣言 UI は document API のハンドルと独立して管理する。
  type Entry = { node: HTMLElement; kind: string; clickable: boolean; enabled: boolean; textNode: Text | null; inputVersion: number; composing: boolean; theme: string[]; lastText: string | null;
    pending: { text: string; version: number } | null; options: string[] | null; index: number; remove: () => void };
  const uiNodes = new Map<number, Entry>();
  let uiStyle: HTMLStyleElement | undefined;
  const removeUi = (root: HTMLElement) => {
    for (const [handle, entry] of uiNodes) {
      if (root === entry.node || root.contains(entry.node)) {
        entry.remove();
        uiNodes.delete(handle);
      }
    }
    root.remove();
  };
  /** 選択肢のボタン（segmented・tabs）の選択中の印と、Tab で入る 1 つを決める */
  const markChoice = (entry: Entry, index: number): void => {
    entry.index = index;
    const items = [...entry.node.children] as HTMLElement[];
    const attribute = entry.kind === "tabs" ? "aria-selected" : "aria-checked";
    const focusable = index >= 0 && index < items.length ? index : 0;
    items.forEach((item, i) => {
      setAttribute(item, attribute, String(i === index));
      setAttribute(item, "tabindex", i === focusable ? "0" : "-1");
    });
  };
  /** 選択肢が変わったときだけ作り直す。フォーカスのあった位置は保つ */
  const setChoices = (entry: Entry, next: string[]): boolean => {
    const current = entry.options;
    if (current && current.length === next.length && current.every((option, i) => option === next[i])) return false;
    const document = element.ownerDocument;
    const items = [...entry.node.children];
    const focused = items.findIndex(item => item === document.activeElement);
    entry.options = next.slice();
    if (entry.kind === "picker") {
      entry.node.replaceChildren(...next.map(label => { const option = document.createElement("option"); option.textContent = label; return option; }));
      return true;
    }
    entry.node.replaceChildren(...next.map(label => {
      const option = document.createElement("button");
      option.setAttribute("type", "button");
      option.className = "bina-ui-option";
      option.setAttribute("role", entry.kind === "tabs" ? "tab" : "radio");
      option.textContent = label;
      return option;
    }));
    if (focused >= 0) (entry.node.children[Math.min(focused, next.length - 1)] as HTMLElement | undefined)?.focus();
    return true;
  };
  return {
    apply(ops: DomOp[]): void { for (const op of ops) {
      if (op.op === "ui-create") {
        if (!uiStyle) {
          uiStyle = element.ownerDocument.createElement("style");
          uiStyle.textContent = uiCss;
          element.appendChild(uiStyle);
        }
        const kind: string = op.kind;
        const tags: Record<string, string> = { appIcon: "img", image: "img", button: "button", text: "span", chip: "span", badge: "span",
          checkbox: "input", radio: "input", slider: "input", picker: "select", separator: "hr" };
        const tag = kind === "input" ? (op.multiline ? "textarea" : "input") : Object.hasOwn(tags, kind) ? tags[kind]! : "div";
        const node = element.ownerDocument.createElement(tag);
        node.className = `bina-ui-${kind}`;
        if (tag === "button") node.setAttribute("type", "button");
        const entry: Entry = { node, kind, clickable: false, enabled: true, textNode: null, inputVersion: 0, composing: false, theme: [], lastText: null, pending: null, options: null, index: -1, remove: () => {} };
        const listen = (type: string, listener: (event: Event) => void) => {
          node.addEventListener(type, listener);
          const previous = entry.remove;
          entry.remove = () => { previous(); node.removeEventListener(type, listener); };
        };
        /** 値を返す部品の操作を送る。版を進め、古い描き直しで DOM の値を戻さないようにする */
        const send = (value: number) => { process.dispatchUiValue?.(op.handle, value, ++entry.inputVersion); };
        if (tag === "button") listen("click", () => { if (entry.clickable) process.dispatchUi(op.handle); });
        if (tag === "img") node.setAttribute("alt", "");
        if (kind === "checkbox" || kind === "radio" || kind === "slider") {
          const field = node as HTMLInputElement;
          field.setAttribute("type", kind === "slider" ? "range" : kind);
          if (kind === "slider") listen("input", () => { fillSlider(field); if (entry.clickable && !field.disabled) send(Number(field.value)); });
          // ラジオは選ばれたときだけ change が来る
          else listen("change", () => { if (entry.clickable && !field.disabled) send(field.checked ? 1 : 0); });
        }
        if (kind === "picker") {
          const field = node as HTMLSelectElement;
          listen("change", () => { if (entry.clickable && !field.disabled) send(field.selectedIndex); });
        }
        if (kind === "segmented" || kind === "tabs") {
          const items = () => [...node.children] as HTMLButtonElement[];
          const pick = (index: number, focus: boolean) => {
            const item = items()[index];
            if (!item || item.disabled) return;
            if (focus) item.focus();
            if (!entry.clickable || index === entry.index) return;
            markChoice(entry, index);
            send(index);
          };
          listen("click", event => {
            const item = (event.target as Element | null)?.closest?.(".bina-ui-option");
            if (item && item.parentNode === node) pick(items().indexOf(item as HTMLButtonElement), false);
          });
          // 矢印で隣へ移って選ぶ。Home・End で端へ（WAI-ARIA の radiogroup と、自動で切り替える tablist の操作）
          listen("keydown", event => {
            const key = (event as KeyboardEvent).key;
            const all = items();
            if (!all.length) return;
            const focused = all.findIndex(item => item === element.ownerDocument.activeElement);
            const from = focused >= 0 ? focused : Math.max(0, entry.index);
            const next = key === "ArrowRight" || key === "ArrowDown" ? (from + 1) % all.length : key === "ArrowLeft" || key === "ArrowUp" ? (from - 1 + all.length) % all.length
              : key === "Home" ? 0 : key === "End" ? all.length - 1 : -1;
            if (next < 0) return;
            event.preventDefault();
            pick(next, true);
          });
        }
        if (kind === "input") {
          if (tag === "input") node.setAttribute("type", "text");
          const field = node as TextField;
          const notify = () => { const value = field.value; if (entry.clickable && !field.disabled && value !== entry.lastText) { entry.lastText = value; process.dispatchUiText(op.handle, value, ++entry.inputVersion); } };
          listen("input", () => { notify(); });
          listen("compositionstart", () => { entry.composing = true; });
          listen("compositionend", () => {
            entry.composing = false;
            notify();
            // 変換中に届いた描き直しを、新しい入力が無ければここで反映する
            const pending = entry.pending;
            entry.pending = null;
            if (pending && pending.version >= entry.inputVersion && field.value !== pending.text) { field.value = pending.text; entry.lastText = pending.text; }
          });
        }
        const previous = uiNodes.get(op.handle);
        if (previous) removeUi(previous.node);
        uiNodes.set(op.handle, entry);
        continue;
      }
      if (op.op === "ui-update") {
        const entry = uiNodes.get(op.handle);
        if (!entry) continue;
        const node = entry.node;
        const kind = entry.kind;
        const version = op.inputVersion ?? 0;
        // 値を返す部品は、利用者の新しい操作より古い描き直しでは値を戻さない
        const current = version >= entry.inputVersion;
        if (kind === "input") {
          const field = node as TextField;
          if (current) {
            if (entry.composing) entry.pending = { text: op.text, version };
            else if (field.value !== op.text) { field.value = op.text; entry.lastText = op.text; }
          }
        }
        if (kind === "checkbox" || kind === "radio") {
          const field = node as HTMLInputElement;
          if (current && field.checked !== (op.checked === true)) field.checked = op.checked === true;
        }
        if (kind === "slider") {
          const field = node as HTMLInputElement;
          // 値は範囲に丸められるので、範囲を先に書く
          for (const [name, value] of [["min", op.min ?? 0], ["max", op.max ?? 1]] as const) setAttribute(field, name, Number.isFinite(value) ? String(value) : null);
          setAttribute(field, "step", op.step !== undefined && Number.isFinite(op.step) && op.step > 0 ? String(op.step) : "any");
          const value = op.value ?? 0;
          if (current && Number.isFinite(value) && Number(field.value) !== value) field.value = String(value);
          fillSlider(field);
        }
        if (choiceKinds.includes(kind)) {
          const changed = setChoices(entry, Array.isArray(op.options) ? op.options.map(String) : []);
          const index = op.index ?? -1;
          if (kind === "picker") {
            const field = node as HTMLSelectElement;
            if ((changed || current) && field.selectedIndex !== index) field.selectedIndex = index;
            entry.index = index;
          } else if (changed || current) markChoice(entry, index);
          for (const item of node.children) if (item.tagName.toLowerCase() === "button" && (item as HTMLButtonElement).disabled === op.enabled) (item as HTMLButtonElement).disabled = !op.enabled;
        }
        if (kind === "progress") {
          const value = op.value ?? -1;
          const indeterminate = !(value >= 0);
          const ratio = Math.min(1, Math.max(0, value));
          setClass(node, "bina-ui-indeterminate", indeterminate);
          const width = indeterminate ? "" : `${ratio * 100}%`;
          if (node.style.getPropertyValue("--bina-ui-progress") !== width) {
            if (width) node.style.setProperty("--bina-ui-progress", width);
            else node.style.removeProperty("--bina-ui-progress");
          }
          setAttribute(node, "aria-valuemin", "0");
          setAttribute(node, "aria-valuemax", "100");
          setAttribute(node, "aria-valuenow", indeterminate ? null : String(Math.round(ratio * 100)));
        }
        if (kind === "appIcon") {
          const icon = options.apps?.[op.app ?? -1]?.icon;
          if (icon === undefined) node.removeAttribute("src");
          else {
            const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(icon)}`;
            if (node.getAttribute("src") !== src) node.setAttribute("src", src);
          }
        }
        if (kind === "image") {
          // 外部 URL やほかの形式は読み込まない。代替テキストは label
          setAttribute(node, "src", rasterDataUrl.test(op.text) ? op.text : null);
          setAttribute(node, "alt", op.label ?? "");
        }
        for (const property of entry.theme) node.style.removeProperty(property);
        entry.theme = [];
        for (const declaration of (op.theme ?? "").split(";")) {
          const colon = declaration.indexOf(":");
          if (colon === -1) continue;
          const property = declaration.slice(0, colon);
          const value = declaration.slice(colon + 1);
          if (!/^--bina-ui-(?:(?:space|radius|font-size)-(?:xs|sm|md|lg|xl)|(?:button|input)-(?:padding|radius|font-size)-(?:px|xs|sm|md|lg|xl))$/.test(property)) continue;
          // Only plain numbers reach the page, so a theme from the app cannot inject other CSS values.
          if (!/^\d+(?:\.\d+)?(?:px)?$/.test(value)) continue;
          node.style.setProperty(property, value);
          entry.theme.push(property);
        }
        node.hidden = op.shown === false;
        if (op.key) node.setAttribute("data-bina-key", op.key);
        else node.removeAttribute("data-bina-key");
        // ラベルは独立したテキストノードにし、ボタンの子を消さずに更新する。
        const isButton = node.classList.contains("bina-ui-button");
        // スイッチは文字を見せず、読み上げの名前にだけ使う
        const toggle = isButton && op.toggle !== undefined;
        const shownText = toggle ? "" : op.text;
        if (textKinds.includes(kind)) {
          if (shownText && !entry.textNode) {
            entry.textNode = element.ownerDocument.createTextNode(shownText);
            node.insertBefore(entry.textNode, node.firstChild);
          } else if (!shownText && entry.textNode) {
            entry.textNode.remove();
            entry.textNode = null;
          } else if (entry.textNode && entry.textNode.data !== shownText) entry.textNode.data = shownText;
        }
        // grid は列の最小幅として変数で渡す。ほかの部品は自分の min-width にし、子に受け継がせない
        const isGrid = node.classList.contains("bina-ui-grid");
        const minWidth = op.minWidth ? `${Math.max(0, op.minWidth)}px` : "";
        if (!isGrid && node.style.minWidth !== minWidth) node.style.minWidth = minWidth;
        const level = op.heading ?? 0;
        const own = Object.hasOwn(kindRoles, kind) ? kindRoles[kind]! : null;
        const role = own ?? (nativeKinds.includes(kind) ? null : toggle ? "switch" : level > 0 ? "heading" : op.list ? "list" : op.listItem ? "listitem" : null);
        if (role === null) { if (node.hasAttribute("role")) node.removeAttribute("role"); }
        else if (node.getAttribute("role") !== role) node.setAttribute("role", role);
        if (level > 0) { if (node.getAttribute("aria-level") !== String(level)) node.setAttribute("aria-level", String(level)); }
        else if (node.hasAttribute("aria-level")) node.removeAttribute("aria-level");
        for (const n of [1, 2, 3]) if (node.classList.contains(`bina-ui-heading-${n}`) !== (level === n)) node.classList.toggle(`bina-ui-heading-${n}`, level === n);
        if (node.classList.contains("bina-ui-list") !== !!op.list) node.classList.toggle("bina-ui-list", !!op.list);
        if (node.classList.contains("bina-ui-listitem") !== !!op.listItem) node.classList.toggle("bina-ui-listitem", !!op.listItem);
        for (const [name, value] of [["padding", op.padding], ["gap", op.gap], ["minWidth", isGrid && op.minWidth ? op.minWidth : null]] as const) {
          const property = `--bina-ui-${name}`;
          const fallback = name === "padding" ? isButton ? buttonPadding(op) : kind === "input" ? inputPadding : Object.hasOwn(kindPadding, kind) ? kindPadding[kind]! : "0px" : "";
          const next = value === null ? fallback : name === "minWidth" ? `${Math.max(0, value)}px` : length(value);
          if (node.style.getPropertyValue(property) !== next) {
            if (next) node.style.setProperty(property, next);
            else node.style.removeProperty(property);
          }
        }
        if (node.classList.contains("bina-ui-grow") !== op.grow) node.classList.toggle("bina-ui-grow", op.grow);
        // 画像の名前は alt で渡す
        setAttribute(node, "aria-label", kind === "image" ? null : op.label || (toggle && op.text) || null);
        applyLook(node, op, isButton, toggle);
        if (["button", "input", "textarea", "select"].includes(node.tagName.toLowerCase()) && (node as HTMLButtonElement).disabled === op.enabled) {
          (node as HTMLButtonElement).disabled = !op.enabled;
        }
        entry.enabled = op.enabled;
        entry.clickable = op.clickable;
        continue;
      }
      if (op.op === "ui-insert") {
        const parent = op.parent === null ? element : uiNodes.get(op.parent)?.node;
        const child = uiNodes.get(op.child)?.node;
        const before = op.before === null ? null : uiNodes.get(op.before)?.node;
        if (parent && child && parent !== child && !child.contains(parent) && (before === null || before?.parentNode === parent)) {
          parent.insertBefore(child, before);
          // row の中の区切り線は縦の線として読み上げる
          if (child.classList.contains("bina-ui-separator")) setAttribute(child, "aria-orientation", parent.classList.contains("bina-ui-row") ? "vertical" : null);
        }
        continue;
      }
      if (op.op === "ui-remove") {
        const entry = uiNodes.get(op.handle);
        if (entry) removeUi(entry.node);
        continue;
      }
    } },
    stop(): void { for (const entry of uiNodes.values()) entry.remove(); uiNodes.clear(); },
    clear(): void { for (const entry of [...uiNodes.values()]) removeUi(entry.node); uiStyle?.remove(); uiStyle = undefined; },
  };
}
