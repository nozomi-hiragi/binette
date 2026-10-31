import { createUiDiffer, type UiNode } from "./diff.ts";
import { createUiDom } from "./dom.ts";

export * from "./parts.ts";
import { View, UiCallback, Theme, Scale, ComponentTheme, theme as sharedTheme, choice } from "./parts.ts";

class FunctionUiCallback extends UiCallback {
  constructor(private callback: (arg: number) => void) { super(); }
  call(arg: number): void { this.callback(arg); }
}
/** ボタンを作る。 */
export function button(label: string, callback: (arg: number) => void): View {
  const view = new View("button"); view.value = label; view.callback = new FunctionUiCallback(callback); return view;
}
/** 子を持つボタンを作る。 */
export function buttonOf(children: View[], callback: (arg: number) => void): View {
  const view = new View("button"); view.children = children; view.callback = new FunctionUiCallback(callback); return view;
}
/** ラジオボタンを作る。押すと onSelect を arg(i) の値で呼ぶ。 */
export function radio(selected: boolean, onSelect: (arg: number) => void): View {
  const view = new View("radio"); view.checkedValue = selected; view.callback = new FunctionUiCallback(onSelect); return view;
}
/** 選択肢から一つを選ぶ欄（ネイティブの select）を作る。onChange は選んだ番号を受け取る。 */
export function picker(options: string[], index: number, onChange: (index: number) => void): View {
  return choice("picker", options, index, new FunctionUiCallback(onChange));
}
/** つながったボタンで一つを選ぶ部品を作る。onChange は選んだ番号を受け取る。 */
export function segmented(options: string[], index: number, onChange: (index: number) => void): View {
  return choice("segmented", options, index, new FunctionUiCallback(onChange));
}
/** タブの見出しの並びを作る。onChange は選んだ番号を受け取る。 */
export function tabs(options: string[], index: number, onChange: (index: number) => void): View {
  return choice("tabs", options, index, new FunctionUiCallback(onChange));
}
/** 値を返すイベントで、受け取った数を選択肢の番号として渡す部品か。 */
function indexed(kind: string): boolean { return kind === "picker" || kind === "segmented" || kind === "tabs"; }
type Component = { fn: (props: never) => View; props: unknown };
const components = new WeakMap<View, Component>();

/** 関数の部品を木に入れる。key は返された View ではなくこの View に付ける。 */
export function component<P>(fn: (props: P) => View, props: P): View {
  const view = new View("column");
  components.set(view, { fn: fn as (props: never) => View, props });
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
        view?.callback?.call(view.argValue);
      }
    },
    dispatchUiText(handle, value, version) {
      const target = differ.find(handle);
      if (!target) return;
      differ.inputVersions.set(handle, version);
      if (target.node.enabled) handlers[target.node.handler]?.textCallback?.(value);
    },
    dispatchUiValue(handle, value, version) {
      const target = differ.find(handle);
      if (!target) return;
      differ.inputVersions.set(handle, version);
      const view = target.node.enabled ? handlers[target.node.handler] : undefined;
      if (!view || !Number.isFinite(value)) return;
      if (view.numberCallback) view.numberCallback(Math.min(view.maxValue, Math.max(view.minValue, value)));
      else if (view.checkCallback) view.checkCallback(value !== 0);
      else if (!indexed(view.kind)) view.callback?.call(view.argValue);
      else if (Number.isInteger(value) && value >= 0 && value < view.optionsValue.length) view.callback?.call(value);
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
    return fiber.type === (components.get(view)?.fn ?? view.kind as UiNode["kind"]) && fiber.key === view.keyValue;
  }
  function node(view: View, old: Fiber | undefined, effects: (() => void)[]): [UiNode, Fiber] {
    const fiber: Fiber = old ?? { type: components.get(view)?.fn ?? view.kind as UiNode["kind"], key: view.keyValue, children: [], hooks: [], live: true, schedule };
    const component = components.get(view);
    if (component) {
      const previous = current;
      const previousHookCount = fiber.hooks.length;
      const context: HookContext = { fiber, index: 0, effects };
      current = context;
      let output: View;
      try { output = component.fn(component.props as never); }
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
    const handler = view.callback || view.textCallback || view.numberCallback || view.checkCallback ? handlers.push(view) - 1 : -1;
    return [{ kind: view.kind as UiNode["kind"], children: children.map(child => child.result), text: view.value,
      theme: view.themeValue, padding: view.paddingValue === -100 ? null : view.paddingValue, gap: view.gapValue, grow: view.growValue,
      key: view.keyValue, label: view.labelValue, enabled: view.enabledValue,
      handler, minWidth: view.minWidthValue, heading: view.headingValue,
      list: view.listValue, shown: view.shownValue, app: view.appValue, multiline: view.multilineValue,
      variant: view.variantValue, tone: view.toneValue, surface: view.surfaceValue,
      divider: view.dividerValue, mono: view.monoValue, small: view.smallValue, bold: view.boldValue, truncate: view.truncateValue,
      width: view.widthValue, center: view.centerValue, selected: view.selectedValue, toggle: view.toggleValue,
      scroll: view.scrollValue, fill: view.fillValue, collapse: view.collapseValue,
      placeholder: view.placeholderValue, height: view.heightValue, minHeight: view.minHeightValue, wrap: view.wrapValue, highlight: view.highlightValue,
      checked: view.checkedValue, value: view.numberValue, min: view.minValue, max: view.maxValue, step: view.stepValue,
      options: view.optionsValue.slice(), index: view.indexValue, align: view.alignValue }, fiber];
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

export type ThemeConfig = {
  space?: Partial<Scale> | null; radius?: Partial<Scale> | null; fontSize?: Partial<Scale> | null;
  button?: Partial<ComponentTheme> | null; input?: Partial<ComponentTheme> | null;
};
function fill<T extends object>(base: T, config: Partial<T>): T {
  for (const [field, value] of Object.entries(config)) if (value !== undefined) Object.assign(base, { [field]: value });
  return base;
}
/** 要素を増やさず、この View を根とする部分木のテーマを設定する。省略した項目は親から受け継ぐ。 */
export function theme(config: ThemeConfig, view: View): View {
  const full = new Theme();
  if (config.space) full.space = fill(new Scale(), config.space);
  if (config.radius) full.radius = fill(new Scale(), config.radius);
  if (config.fontSize) full.fontSize = fill(new Scale(), config.fontSize);
  if (config.button) full.button = fill(new ComponentTheme(), config.button);
  if (config.input) full.input = fill(new ComponentTheme(), config.input);
  return sharedTheme(full, view);
}
