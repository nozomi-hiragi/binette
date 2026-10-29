import { createUiDiffer, type UiNode } from "./diff.ts";
import { createUiDom } from "./dom.ts";

/** 宣言 UI の部品。修飾はこの部品を変更して返す。 */
export class View {
  children: View[] = [];
  themeValue = "";
  value = "";
  paddingValue: number | null = null;
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
  componentFn: ((props: never) => View) | null = null;
  componentProps: unknown;
  constructor(readonly kind: UiNode["kind"]) {}
  padding(n: number = space.md): View { this.paddingValue = n; return this; }
  gap(n: number = space.md): View { this.gapValue = n; return this; }
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

/** 関数の部品を木に入れる。key は返された View ではなくこの View に付ける。 */
export function component<P>(fn: (props: P) => View, props: P): View {
  const view = new View("column");
  view.componentFn = fn as (props: never) => View;
  view.componentProps = props;
  return view;
}

type StateHook = { kind: "state"; value: unknown; set: (value: unknown) => void };
type EffectHook = { kind: "effect"; deps: readonly unknown[] | undefined; cleanup?: () => void; version: number };
type Hook = StateHook | EffectHook;
type Fiber = { type: UiNode["kind"] | ((props: never) => View); key: string; children: Fiber[]; hooks: Hook[]; live: boolean; schedule: () => void };
type HookContext = { fiber: Fiber; index: number; effects: (() => void)[] };
let current: HookContext | undefined;

/** 部品の状態と、その更新関数を返す。関数を渡すと現在値から更新する。 */
export function useState<T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void] {
  if (!current) throw new Error("useState は部品の描画中にだけ呼べます");
  const { fiber } = current;
  const index = current.index++;
  let hook = fiber.hooks[index];
  if (hook && hook.kind !== "state") throw new Error("フックの呼び出し順序が変わりました");
  if (!hook) {
    const state: StateHook = { kind: "state", value: typeof initial === "function" ? (initial as () => T)() : initial, set: () => {} };
    state.set = value => {
      if (!fiber.live) return;
      const next = typeof value === "function" ? (value as (previous: T) => T)(state.value as T) : value;
      if (Object.is(next, state.value)) return;
      state.value = next;
      fiber.schedule();
    };
    fiber.hooks[index] = hook = state;
  }
  return [hook.value as T, hook.set as (value: T | ((previous: T) => T)) => void];
}

/** 描画後に処理を実行し、依存値の変更や部品の削除時に片付ける。 */
export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void {
  if (!current) throw new Error("useEffect は部品の描画中にだけ呼べます");
  const index = current.index++;
  let hook = current.fiber.hooks[index];
  if (hook && hook.kind !== "effect") throw new Error("フックの呼び出し順序が変わりました");
  const changed = !hook || deps === undefined || hook.deps === undefined ||
    deps.length !== hook.deps.length || deps.some((value, i) => !Object.is(value, hook!.kind === "effect" ? hook.deps![i] : undefined));
  if (!hook) current.fiber.hooks[index] = hook = { kind: "effect", deps: undefined, version: 0 };
  if (changed) {
    const target = hook;
    const fiber = current.fiber;
    current.effects.push(() => {
      if (!fiber.live) return;
      const version = ++target.version;
      const previousCleanup = target.cleanup;
      target.cleanup = undefined;
      // A render started by the cleanup must see this effect as changed and supersede it.
      target.deps = undefined;
      previousCleanup?.();
      if (!fiber.live || target.version !== version) return;
      target.deps = deps?.slice();
      const cleanup = effect();
      if (typeof cleanup === "function") {
        if (fiber.live && target.version === version) target.cleanup = cleanup;
        else cleanup();
      }
    });
  }
}

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
  let tree: Fiber | undefined;
  let rootView: View | undefined;
  let scheduled = false;
  let revision = 0;
  const schedule = () => {
    if (scheduled || !active) return;
    scheduled = true;
    queueMicrotask(() => {
      if (!scheduled || !active) return;
      scheduled = false;
      if (rootView) draw(rootView);
    });
  };
  // Cleanups of removed fibers run after the commit, so user code never re-enters reconciliation.
  const cleanups: (() => void)[] = [];
  function dispose(fiber: Fiber): void {
    if (!fiber.live) return;
    fiber.live = false;
    for (const child of fiber.children) dispose(child);
    for (const hook of fiber.hooks) {
      if (hook.kind === "effect" && hook.cleanup) { cleanups.push(hook.cleanup); hook.cleanup = undefined; }
    }
  }
  function flushCleanups(): void {
    while (cleanups.length) cleanups.shift()!();
  }
  function same(fiber: Fiber, view: View): boolean {
    return fiber.type === (view.componentFn ?? view.kind) && fiber.key === view.keyValue;
  }
  function node(view: View, old: Fiber | undefined, effects: (() => void)[]): [UiNode, Fiber] {
    const fiber: Fiber = old ?? { type: view.componentFn ?? view.kind, key: view.keyValue, children: [], hooks: [], live: true, schedule };
    if (view.componentFn) {
      const previous = current;
      const previousHookCount = fiber.hooks.length;
      const context: HookContext = { fiber, index: 0, effects };
      current = context;
      let output: View;
      try { output = view.componentFn(view.componentProps as never); }
      finally { current = previous; }
      if (old && context.index !== previousHookCount) throw new Error("フックの呼び出し順序が変わりました");
      const child = fiber.children[0];
      const match = child && same(child, output) ? child : undefined;
      const [result, next] = node(output, match, effects);
      if (child && !match) dispose(child);
      fiber.children = [next];
      return [{ ...result, theme: view.themeValue + (result.theme ?? ""), key: view.keyValue || result.key, shown: view.shownValue && result.shown }, fiber];
    }
    const previous = fiber.children;
    const used = new Set<Fiber>();
    const children = view.children.map((child, i) => {
      const match = child.keyValue
        ? previous.find(item => !used.has(item) && same(item, child))
        : previous[i] && !used.has(previous[i]!) && !previous[i]!.key && same(previous[i]!, child) ? previous[i] : undefined;
      if (match) used.add(match);
      const [result, next] = node(child, match, effects);
      return { result, next };
    });
    for (const child of previous) if (!used.has(child)) dispose(child);
    fiber.children = children.map(child => child.next);
    const handler = view.callback || view.textCallback ? handlers.push(view) - 1 : -1;
    return [{ kind: view.kind, children: children.map(child => child.result), text: view.value,
      theme: view.themeValue, padding: view.paddingValue, gap: view.gapValue, grow: view.growValue,
      key: view.keyValue, label: view.labelValue, enabled: view.enabledValue,
      handler, minWidth: view.minWidthValue, heading: view.headingValue,
      list: view.listValue, shown: view.shownValue, app: view.appValue }, fiber];
  }
  function draw(view: View): void {
    const drawRevision = ++revision;
    handlers = [];
    const effects: (() => void)[] = [];
    const match = tree && same(tree, view) ? tree : undefined;
    const [result, next] = node(view, match, effects);
    if (tree && !match) dispose(tree);
    if (!active || revision !== drawRevision) { flushCleanups(); return; }
    tree = next;
    differ.render(result, ++build);
    flushCleanups();
    for (const effect of effects) {
      if (!active || revision !== drawRevision) break;
      effect();
    }
  }
  return {
    render(view) { if (!active) return; rootView = view; scheduled = false; draw(view); },
    unmount() { if (!active) return; active = false; scheduled = false; if (tree) dispose(tree); tree = undefined; rootView = undefined; dom.clear(); dom.stop(); handlers = []; flushCleanups(); },
  };
}

/** 名前付きの段。負の値は CSS 変数への参照を表す。 */
export class Scale {
  xs: number = -100;
  sm: number = -100;
  md: number = -100;
  lg: number = -100;
  xl: number = -100;
}
export const space: Scale = { xs: -1, sm: -2, md: -3, lg: -4, xl: -5 };
export const radius: Scale = { xs: -1, sm: -2, md: -3, lg: -4, xl: -5 };
export const fontSize: Scale = { xs: -1, sm: -2, md: -3, lg: -4, xl: -5 };
/** 部品の既定値。-100 は上書きしない。 */
export class ComponentTheme {
  padding: number = -100;
  radius: number = -100;
  fontSize: number = -100;
}
/** 部分木に適用するテーマ。省略した値は親から受け継ぐ。 */
export class Theme {
  space: Scale | null = null;
  radius: Scale | null = null;
  fontSize: Scale | null = null;
  button: ComponentTheme | null = null;
  input: ComponentTheme | null = null;
}
function componentLength(kind: string, field: string, value: number): string {
  const names = ["xs", "sm", "md", "lg", "xl"];
  const token = value >= -5 && value <= -1 && value == Math.floor(value);
  const prefix = "--bina-ui-" + kind + "-" + field;
  let result = prefix + "-px:" + (token ? "0" : Math.max(0, value).toString()) + "px;";
  for (let i = 0; i < names.length; i++) result += prefix + "-" + names[i] + ":" + (token && value == -i - 1 ? "1" : "0") + ";";
  return result;
}
function scaleDeclarations(group: string, scale: Partial<Scale> | null | undefined): string {
  if (scale == null) return "";
  const names = ["xs", "sm", "md", "lg", "xl"];
  const values = [scale.xs, scale.sm, scale.md, scale.lg, scale.xl];
  let result = "";
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== undefined && values[i] != -100) result += "--bina-ui-" + group + "-" + names[i] + ":" + Math.max(0, values[i]!).toString() + "px;";
  }
  return result;
}
function componentDeclarations(kind: string, value: Partial<ComponentTheme> | null | undefined): string {
  if (value == null) return "";
  let result = "";
  if (value.padding !== undefined && value.padding != -100) result += componentLength(kind, "padding", value.padding);
  if (value.radius !== undefined && value.radius != -100) result += componentLength(kind, "radius", value.radius);
  if (value.fontSize !== undefined && value.fontSize != -100) result += componentLength(kind, "font-size", value.fontSize);
  return result;
}
export type ThemeConfig = {
  space?: Partial<Scale> | null; radius?: Partial<Scale> | null; fontSize?: Partial<Scale> | null;
  button?: Partial<ComponentTheme> | null; input?: Partial<ComponentTheme> | null;
};
/** 要素を増やさず、この View を根とする部分木のテーマを設定する。 */
export function theme(config: ThemeConfig, view: View): View {
  view.themeValue = scaleDeclarations("space", config.space) + scaleDeclarations("radius", config.radius) +
    scaleDeclarations("font-size", config.fontSize) + componentDeclarations("button", config.button) + componentDeclarations("input", config.input) + view.themeValue;
  return view;
}
