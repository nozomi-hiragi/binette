import type { DomOp } from "@binette/core";
import { dividerSides, surfaces, tones, variants } from "./parts.ts";
/** DOM からアプリに届くイベント。 */
export interface UiEvents {
  dispatchUi(handle: number): void;
  dispatchUiText(handle: number, value: string, version: number): void;
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
:where(.bina-ui-column > .bina-ui-button:not(.bina-ui-grow)) { align-self: flex-start; }
:where(.bina-ui-row) { display: flex; flex-direction: row; align-items: center; }
:where(.bina-ui-grid) { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--bina-ui-minWidth, 112px)), 1fr)); align-content: start; background: var(--bina-ui-grid-background, transparent); }
:where(.bina-ui-appIcon) { width: var(--bina-ui-icon-size, 56px); height: var(--bina-ui-icon-size, 56px); object-fit: contain; }
:where(.bina-ui-input) { font: inherit; font-size: ${componentLength("input", "font-size", "font-size", "1em")}; border-radius: ${componentLength("input", "radius", "radius", "var(--bina-ui-input-radius, 0px)")}; color: inherit; min-width: 0; }
:where(.bina-ui-column, .bina-ui-row, .bina-ui-grid) { gap: var(--bina-ui-gap, 0px); }
:where(.bina-ui-column, .bina-ui-row, .bina-ui-text, .bina-ui-button, .bina-ui-grid, .bina-ui-input) { padding: var(--bina-ui-padding, 0px); }
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
${lookCss}`;

type UiUpdate = Extract<DomOp, { op: "ui-update" }>;
const lookFlags = ["mono", "small", "bold", "truncate", "center", "scroll", "fill", "collapse", "wrap", "highlight"] as const;
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
  for (const name of surfaces) setClass(node, `bina-ui-surface-${name}`, op.surface === name);
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
  const field = ["INPUT", "TEXTAREA"].includes(node.tagName.toUpperCase());
  setAttribute(node, "placeholder", field && op.placeholder ? op.placeholder : null);
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
  const uiNodes = new Map<number, { node: HTMLElement; clickable: boolean; textNode: Text | null; inputVersion: number; composing: boolean; theme: string[]; lastText: string | null; pending: { text: string; version: number } | null; remove: () => void }>();
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
  return {
    apply(ops: DomOp[]): void { for (const op of ops) {
      if (op.op === "ui-create") {
        if (!uiStyle) {
          uiStyle = element.ownerDocument.createElement("style");
          uiStyle.textContent = uiCss;
          element.appendChild(uiStyle);
        }
        const tag = op.kind === "input" ? (op.multiline ? "textarea" : "input") : op.kind === "appIcon" ? "img" : op.kind === "button" ? "button" : op.kind === "text" ? "span" : "div";
        const node = element.ownerDocument.createElement(tag);
        node.className = `bina-ui-${op.kind}`;
        if (tag === "button") node.setAttribute("type", "button");
        const entry = { node, clickable: false, textNode: null as Text | null, inputVersion: 0, composing: false, theme: [] as string[], lastText: null as string | null, pending: null as { text: string; version: number } | null, remove: () => {} };
        if (tag === "button") {
          const listener = () => { if (entry.clickable) process.dispatchUi(op.handle); };
          node.addEventListener("click", listener);
          entry.remove = () => node.removeEventListener("click", listener);
        }
        if (tag === "img") node.setAttribute("alt", "");
        if (tag === "input" || tag === "textarea") {
          if (tag === "input") node.setAttribute("type", "text");
          const field = node as TextField;
          const notify = () => { const value = field.value; if (entry.clickable && !field.disabled && value !== entry.lastText) { entry.lastText = value; process.dispatchUiText(op.handle, value, ++entry.inputVersion); } };
          const input = () => { notify(); };
          const start = () => { entry.composing = true; };
          const end = () => {
            entry.composing = false;
            notify();
            // 変換中に届いた描き直しを、新しい入力が無ければここで反映する
            const pending = entry.pending;
            entry.pending = null;
            if (pending && pending.version >= entry.inputVersion && field.value !== pending.text) { field.value = pending.text; entry.lastText = pending.text; }
          };
          node.addEventListener("input", input);
          node.addEventListener("compositionstart", start);
          node.addEventListener("compositionend", end);
          entry.remove = () => { node.removeEventListener("input", input); node.removeEventListener("compositionstart", start); node.removeEventListener("compositionend", end); };
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
        if (["input", "textarea"].includes(node.tagName.toLowerCase())) {
          const field = node as TextField;
          const version = op.inputVersion ?? 0;
          if (version >= entry.inputVersion) {
            if (entry.composing) entry.pending = { text: op.text, version };
            else if (field.value !== op.text) { field.value = op.text; entry.lastText = op.text; }
          }
        }
        if (node.tagName.toLowerCase() === "img") {
          const icon = options.apps?.[op.app ?? -1]?.icon;
          if (icon === undefined) node.removeAttribute("src");
          else {
            const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(icon)}`;
            if (node.getAttribute("src") !== src) node.setAttribute("src", src);
          }
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
        if (node.classList.contains("bina-ui-text") || isButton) {
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
        const role = toggle ? "switch" : level > 0 ? "heading" : op.list ? "list" : op.listItem ? "listitem" : null;
        if (role === null) { if (node.hasAttribute("role")) node.removeAttribute("role"); }
        else if (node.getAttribute("role") !== role) node.setAttribute("role", role);
        if (level > 0) { if (node.getAttribute("aria-level") !== String(level)) node.setAttribute("aria-level", String(level)); }
        else if (node.hasAttribute("aria-level")) node.removeAttribute("aria-level");
        for (const n of [1, 2, 3]) if (node.classList.contains(`bina-ui-heading-${n}`) !== (level === n)) node.classList.toggle(`bina-ui-heading-${n}`, level === n);
        if (node.classList.contains("bina-ui-list") !== !!op.list) node.classList.toggle("bina-ui-list", !!op.list);
        if (node.classList.contains("bina-ui-listitem") !== !!op.listItem) node.classList.toggle("bina-ui-listitem", !!op.listItem);
        for (const [name, value] of [["padding", op.padding], ["gap", op.gap], ["minWidth", isGrid && op.minWidth ? op.minWidth : null]] as const) {
          const property = `--bina-ui-${name}`;
          const fallback = name === "padding" ? isButton ? buttonPadding(op) : node.classList.contains("bina-ui-input") ? inputPadding : "0px" : "";
          const next = value === null ? fallback : name === "minWidth" ? `${Math.max(0, value)}px` : length(value);
          if (node.style.getPropertyValue(property) !== next) {
            if (next) node.style.setProperty(property, next);
            else node.style.removeProperty(property);
          }
        }
        if (node.classList.contains("bina-ui-grow") !== op.grow) node.classList.toggle("bina-ui-grow", op.grow);
        setAttribute(node, "aria-label", op.label || (toggle && op.text) || null);
        applyLook(node, op, isButton, toggle);
        if (["button", "input", "textarea"].includes(node.tagName.toLowerCase()) && (node as HTMLButtonElement).disabled === op.enabled) {
          (node as HTMLButtonElement).disabled = !op.enabled;
        }
        entry.clickable = op.clickable;
        continue;
      }
      if (op.op === "ui-insert") {
        const parent = op.parent === null ? element : uiNodes.get(op.parent)?.node;
        const child = uiNodes.get(op.child)?.node;
        const before = op.before === null ? null : uiNodes.get(op.before)?.node;
        if (parent && child && parent !== child && !child.contains(parent) && (before === null || before?.parentNode === parent)) {
          parent.insertBefore(child, before);
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
