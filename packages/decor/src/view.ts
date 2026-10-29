import { createUiDiffer, type UiNode } from "./diff.ts";
import { createUiDom } from "./dom.ts";

/** 宣言 UI の部品。修飾はこの部品を変更して返す。 */
export class View {
  children: View[] = [];
  value = "";
  paddingValue = 0;
  gapValue = 0;
  growValue = false;
  keyValue = "";
  labelValue = "";
  enabledValue = true;
  argValue = 0;
  callback: ((arg: number) => void) | null = null;
  textCallback: ((value: string) => void) | null = null;
  minWidthValue = 0;
  headingValue = 0;
  listValue = false;
  shownValue = true;
  appValue = -1;
  constructor(readonly kind: UiNode["kind"]) {}
  padding(n: number): View { this.paddingValue = n; return this; }
  gap(n: number): View { this.gapValue = n; return this; }
  minWidth(n: number): View { this.minWidthValue = n; return this; }
  grow(): View { this.growValue = true; return this; }
  heading(level: number): View { this.headingValue = Math.max(1, Math.min(3, level)); return this; }
  list(): View { this.listValue = true; return this; }
  key(value: string): View { this.keyValue = value; return this; }
  label(value: string): View { this.labelValue = value; return this; }
  enabled(value: boolean): View { this.enabledValue = value; return this; }
  arg(value: number): View { this.argValue = value; return this; }
}
/** 子を縦に並べる。 */
export function column(children: View[]): View { const view = new View("column"); view.children = children; return view; }
/** 子を横に並べる。 */
export function row(children: View[]): View { const view = new View("row"); view.children = children; return view; }
/** 子を格子に並べる。 */
export function grid(children: View[]): View { const view = new View("grid"); view.children = children; return view; }
/** 文字を描く。 */
export function text(value: string): View { const view = new View("text"); view.value = value; return view; }
/** ボタンを作る。 */
export function button(label: string, callback: (arg: number) => void): View { const view = new View("button"); view.value = label; view.callback = callback; return view; }
/** 子を持つボタンを作る。 */
export function buttonOf(children: View[], callback: (arg: number) => void): View { const view = new View("button"); view.children = children; view.callback = callback; return view; }
/** 文字入力を作る。 */
export function input(value: string, callback: (value: string) => void): View { const view = new View("input"); view.value = value; view.textCallback = callback; return view; }
/** アプリのアイコンを描く。 */
export function appIcon(index: number): View { const view = new View("appIcon"); view.appValue = index; return view; }
/** 部品の表示を切り替える。 */
export function show(condition: boolean, view: View): View { view.shownValue = condition; return view; }

/** ページ上の描画先。 */
export interface Root {
  /** 明示的に渡した木で描き直す。 */
  render(view: View): void;
  /** DOM とリスナーを取り除く。 */
  unmount(): void;
}
/** 要素の中に宣言 UI を描く root を作る。 */
export function mount(element: HTMLElement): Root {
  let handlers: View[] = [];
  let build = 0;
  let active = true;
  const differ = createUiDiffer(op => dom.apply([op]));
  const dom = createUiDom(element, {
    dispatchUi(handle) {
      const target = differ.find(handle);
      if (target?.node.enabled && target.node.handler !== -1) {
        const view = handlers[target.node.handler];
        view?.callback?.(view.argValue);
      }
    },
    dispatchUiText(handle, value, version) {
      const target = differ.find(handle);
      if (!target) return;
      differ.inputVersions.set(handle, version);
      if (target.node.enabled) handlers[target.node.handler]?.textCallback?.(value);
    },
  });
  function node(view: View): UiNode {
    const handler = view.callback || view.textCallback ? handlers.push(view) - 1 : -1;
    return { kind: view.kind, children: view.children.map(node), text: view.value,
      padding: view.paddingValue, gap: view.gapValue, grow: view.growValue,
      key: view.keyValue, label: view.labelValue, enabled: view.enabledValue,
      handler, minWidth: view.minWidthValue, heading: view.headingValue,
      list: view.listValue, shown: view.shownValue, app: view.appValue };
  }
  return {
    render(view) { if (!active) return; handlers = []; differ.render(node(view), ++build); },
    unmount() { if (!active) return; active = false; dom.clear(); dom.stop(); handlers = []; },
  };
}
