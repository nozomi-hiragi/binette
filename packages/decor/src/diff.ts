import type { DomOp } from "@binette/core";

/** core と共有する宣言 UI の操作。 */
export type UiOp = Extract<DomOp, { op: `ui-${string}` }>;

/** 描画する木。操作の kind は core の型を使う。 */
export type UiNode = { kind: Extract<UiOp, { op: "ui-create" }>["kind"]; children: UiNode[]; text: string; theme?: string; padding: number | null; gap: number; grow: boolean; key: string; label: string; enabled: boolean; handler: number; minWidth: number; heading: number; list: boolean; shown: boolean; app: number; multiline: boolean } & UiLook;
/** 見た目の修飾。古いアプリは送らないので省略でき、省略は既定を表す。selected と toggle は -1 が指定なし、0 が偽、1 が真 */
export type UiLook = { tone?: string; divider?: string; mono?: boolean; small?: boolean; bold?: boolean; truncate?: boolean; width?: number; center?: boolean; selected?: number; toggle?: number; scroll?: boolean; fill?: boolean; collapse?: boolean; placeholder?: string; height?: number; minHeight?: number; wrap?: boolean };
export type Mounted = { handle: number; node: UiNode; children: Mounted[]; build: number; listItem: boolean };

/** 差分エンジンの状態と操作。 */
export interface UiDiffer {
  render(root: UiNode, build: number): void;
  find(handle: number): Mounted | undefined;
  findAny(handle: number): Mounted | undefined;
  inputVersions: Map<number, number>;
  update(handle: number, node: UiNode, listItem: boolean): DomOp;
}

/** 差分エンジン。DOM や Worker に依存せず、操作を emit に渡す。 */
export function createUiDiffer(emit: (op: DomOp) => void, validateApp: (index: number) => void = () => {}): UiDiffer {
  // Worker には関数の本文だけを送るので、補助も関数の中に置く
  const looks = ["tone", "divider", "mono", "small", "bold", "truncate", "width", "center", "selected", "toggle", "scroll", "fill", "collapse", "placeholder", "height", "minHeight", "wrap"] as const;
  /** 見た目の修飾のうち既定でないものだけを操作に載せる。 */
  function lookFields(node: UiNode): Partial<Extract<UiOp, { op: "ui-update" }>> {
    const fields: Partial<Extract<UiOp, { op: "ui-update" }>> = {};
    if (node.tone) fields.tone = node.tone;
    if (node.divider) fields.divider = node.divider;
    for (const name of ["mono", "small", "bold", "truncate", "center", "scroll", "fill", "collapse", "wrap"] as const) if (node[name]) fields[name] = true;
    if (node.placeholder) fields.placeholder = node.placeholder;
    for (const name of ["width", "height", "minHeight"] as const) { const value = node[name]; if (value && value > 0) fields[name] = value; }
    if (node.selected !== undefined && node.selected >= 0) fields.selected = node.selected > 0;
    if (node.toggle !== undefined && node.toggle >= 0) fields.toggle = node.toggle > 0;
    return fields;
  }
  function sameInputMode(a: UiNode, b: UiNode): boolean {
    return a.kind !== "input" || a.multiline === b.multiline;
  }
  let uiRoot: Mounted | undefined;
  let nextUiHandle = 1;
  const inputVersions = new Map<number, number>();
  const forgetInput = (mounted: Mounted): void => { inputVersions.delete(mounted.handle); for (const child of mounted.children) forgetInput(child); };
  const uiUpdate = (handle: number, node: UiNode, listItem: boolean): DomOp => ({ op: "ui-update", handle, text: node.text, theme: node.theme, padding: node.padding, gap: node.gap,
    grow: node.grow, label: node.label || null, enabled: node.enabled,
    inputVersion: inputVersions.get(handle) ?? 0, key: node.key, minWidth: node.minWidth, heading: node.heading, list: node.list, listItem, shown: node.shown, app: node.app, clickable: node.handler !== -1, ...lookFields(node) });
  // 木を照合し、実際に変わった操作だけを渡す。
  const updateUi = (node: UiNode, old: Mounted | undefined, build: number, listItem = false): Mounted => {
    if (node.kind === "appIcon") validateApp(node.app);
    const mounted: Mounted = old ?? { handle: nextUiHandle++, node, children: [], build, listItem };
    if (!old) {
      emit({ op: "ui-create", handle: mounted.handle, kind: node.kind, multiline: node.multiline });
    }
    const prev = old?.node;
    if (node.kind === "input" || !prev || prev.theme !== node.theme || prev.text !== node.text || prev.padding !== node.padding || prev.gap !== node.gap ||
      prev.key !== node.key || prev.minWidth !== node.minWidth || prev.heading !== node.heading || prev.list !== node.list || old?.listItem !== listItem || prev.shown !== node.shown || prev.app !== node.app || prev.grow !== node.grow || prev.label !== node.label || prev.enabled !== node.enabled ||
      (prev.handler !== -1) !== (node.handler !== -1) || looks.some(name => prev[name] !== node[name])) {
      emit(uiUpdate(mounted.handle, node, listItem));
    }
    const previous = mounted.children;
    const used = new Set<Mounted>();
    const children = node.children.map((child, i) => {
      const match = child.key
        ? previous.find(item => !used.has(item) && item.node.key === child.key && item.node.kind === child.kind && sameInputMode(item.node, child))
        : previous[i] && !used.has(previous[i]!) && !previous[i]!.node.key && previous[i]!.node.kind === child.kind && sameInputMode(previous[i]!.node, child) ? previous[i] : undefined;
      if (match) used.add(match);
      return updateUi(child, match, build, node.list);
    });
    for (const child of previous) if (!used.has(child)) { forgetInput(child); emit({ op: "ui-remove", handle: child.handle }); }
    const order = previous.filter(child => used.has(child));
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      if (order[i] === child) continue;
      const index = order.indexOf(child);
      if (index !== -1) order.splice(index, 1);
      emit({ op: "ui-insert", parent: mounted.handle, child: child.handle, before: order[i]?.handle ?? null });
      order.splice(i, 0, child);
    }
    mounted.node = node;
    mounted.children = children;
    mounted.build = build;
    mounted.listItem = listItem;
    return mounted;
  };
  const renderUi = (root: UiNode, build: number) => {
    const old = uiRoot;
    if (old && (old.node.kind !== root.kind || old.node.key !== root.key || !sameInputMode(old.node, root))) {
      forgetInput(old);
      emit({ op: "ui-remove", handle: old.handle });
      uiRoot = undefined;
    }
    uiRoot = updateUi(root, uiRoot, build);
    if (!old || old !== uiRoot) emit({ op: "ui-insert", parent: null, child: uiRoot.handle, before: null });
  };
  const findAnyUi = (mounted: Mounted | undefined, handle: number): Mounted | undefined => {
    if (!mounted) return undefined;
    if (mounted.handle === handle) return mounted;
    for (const child of mounted.children) {
      const found = findAnyUi(child, handle);
      if (found) return found;
    }
    return undefined;
  };
  const findUi = (mounted: Mounted | undefined, handle: number): Mounted | undefined => {
    if (!mounted || mounted.node.shown === false) return undefined;
    if (mounted.handle === handle) return mounted;
    for (const child of mounted.children) {
      const found = findUi(child, handle);
      if (found) return found;
    }
    return undefined;
  };
  return { render: renderUi, find: (handle: number) => findUi(uiRoot, handle), findAny: (handle: number) => findAnyUi(uiRoot, handle), inputVersions, update: uiUpdate };
}
