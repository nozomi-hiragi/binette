import type { DomOp } from "@binette/core";
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
export const uiCss = `
:where([class^="bina-ui-"]) { ${themeDefaults.flatMap(([group, values]) => values.map((value, i) => `--bina-ui-default-${group}-${steps[i]}: ${value}px;`)).join(" ")} }

:where([class^="bina-ui-"])[hidden] { display: none !important; }
:where(.bina-ui-column) { display: flex; flex-direction: column; }
:where(.bina-ui-column > .bina-ui-button:not(.bina-ui-grow)) { align-self: flex-start; }
:where(.bina-ui-row) { display: flex; flex-direction: row; align-items: center; }
:where(.bina-ui-grid) { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--bina-ui-minWidth, 112px)), 1fr)); align-content: start; background: var(--bina-ui-grid-background, transparent); }
:where(.bina-ui-appIcon) { width: var(--bina-ui-icon-size, 56px); height: var(--bina-ui-icon-size, 56px); object-fit: contain; }
:where(.bina-ui-input) { font: inherit; font-size: ${componentLength("input", "font-size", "font-size", "1em")}; border-radius: ${componentLength("input", "radius", "radius", "var(--bina-ui-input-radius, 0px)")}; color: inherit; min-width: 0; }
:where(textarea.bina-ui-input) { min-height: 8lh; resize: vertical; }
:where(.bina-ui-column, .bina-ui-row, .bina-ui-grid) { gap: var(--bina-ui-gap, 0px); }
:where(.bina-ui-column, .bina-ui-row, .bina-ui-text, .bina-ui-button, .bina-ui-grid, .bina-ui-input) { padding: var(--bina-ui-padding, 0px); }
:where(.bina-ui-button) { padding: var(--bina-ui-padding, ${componentLength("button", "padding", "space", "0px")}); }
:where(.bina-ui-input) { padding: var(--bina-ui-padding, ${componentLength("input", "padding", "space", "0px")}); }
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
`;

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
        if (node.classList.contains("bina-ui-text") || node.classList.contains("bina-ui-button")) {
          if (op.text && !entry.textNode) {
            entry.textNode = element.ownerDocument.createTextNode(op.text);
            node.insertBefore(entry.textNode, node.firstChild);
          } else if (!op.text && entry.textNode) {
            entry.textNode.remove();
            entry.textNode = null;
          } else if (entry.textNode && entry.textNode.data !== op.text) entry.textNode.data = op.text;
        }
        // grid は列の最小幅として変数で渡す。ほかの部品は自分の min-width にし、子に受け継がせない
        const isGrid = node.classList.contains("bina-ui-grid");
        const minWidth = op.minWidth ? `${Math.max(0, op.minWidth)}px` : "";
        if (!isGrid && node.style.minWidth !== minWidth) node.style.minWidth = minWidth;
        const level = op.heading ?? 0;
        const role = level > 0 ? "heading" : op.list ? "list" : op.listItem ? "listitem" : null;
        if (role === null) { if (node.hasAttribute("role")) node.removeAttribute("role"); }
        else if (node.getAttribute("role") !== role) node.setAttribute("role", role);
        if (level > 0) { if (node.getAttribute("aria-level") !== String(level)) node.setAttribute("aria-level", String(level)); }
        else if (node.hasAttribute("aria-level")) node.removeAttribute("aria-level");
        for (const n of [1, 2, 3]) if (node.classList.contains(`bina-ui-heading-${n}`) !== (level === n)) node.classList.toggle(`bina-ui-heading-${n}`, level === n);
        if (node.classList.contains("bina-ui-list") !== !!op.list) node.classList.toggle("bina-ui-list", !!op.list);
        if (node.classList.contains("bina-ui-listitem") !== !!op.listItem) node.classList.toggle("bina-ui-listitem", !!op.listItem);
        for (const [name, value] of [["padding", op.padding], ["gap", op.gap], ["minWidth", isGrid && op.minWidth ? op.minWidth : null]] as const) {
          const property = `--bina-ui-${name}`;
          const fallback = name === "padding" ? node.classList.contains("bina-ui-button") ? componentLength("button", "padding", "space", "0px") : node.classList.contains("bina-ui-input") ? componentLength("input", "padding", "space", "0px") : "0px" : "";
          const next = value === null ? fallback : name === "minWidth" ? `${Math.max(0, value)}px` : length(value);
          if (node.style.getPropertyValue(property) !== next) {
            if (next) node.style.setProperty(property, next);
            else node.style.removeProperty(property);
          }
        }
        if (node.classList.contains("bina-ui-grow") !== op.grow) node.classList.toggle("bina-ui-grow", op.grow);
        if (op.label === null || op.label === "") {
          if (node.hasAttribute("aria-label")) node.removeAttribute("aria-label");
        } else if (node.getAttribute("aria-label") !== op.label) node.setAttribute("aria-label", op.label);
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
