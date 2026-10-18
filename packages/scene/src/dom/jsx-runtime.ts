export type Child = Node | string | number | boolean | null | undefined | readonly Child[];
type Props = {
  children?: Child;
  class?: string;
  type?: "button" | "submit" | "reset";
  "aria-label"?: string;
  onClick?: (event: MouseEvent) => void;
};

export namespace JSX {
  export type Element = HTMLElement | DocumentFragment;
  export interface ElementChildrenAttribute { children: unknown }
  export interface IntrinsicElements {
    main: Props;
    h1: Props;
    h2: Props;
    section: Props;
    div: Props;
    span: Props;
    ul: Props;
    li: Props;
    button: Props;
  }
}

function append(parent: Node, child: Child): void {
  if (Array.isArray(child)) {
    for (const item of child) append(parent, item);
  } else if (child instanceof Node) {
    parent.appendChild(child);
  } else if (typeof child === "string" || typeof child === "number") {
    parent.appendChild(document.createTextNode(String(child)));
  }
}

export const Fragment = Symbol("Fragment");

// Scene 内の静的な DOM を作るだけで、状態管理や再描画は行わない。
export function jsx(tag: typeof Fragment, props: Props): DocumentFragment;
export function jsx(tag: keyof JSX.IntrinsicElements, props: Props): HTMLElement;
export function jsx(tag: keyof JSX.IntrinsicElements | typeof Fragment, props: Props): HTMLElement | DocumentFragment {
  if (tag === Fragment) {
    const fragment = document.createDocumentFragment();
    append(fragment, props.children);
    return fragment;
  }
  const node: HTMLElement = document.createElement(tag);
  if (props.class !== undefined) node.className = props.class;
  if (props.type !== undefined) node.setAttribute("type", props.type);
  if (props["aria-label"] !== undefined) node.setAttribute("aria-label", props["aria-label"]);
  if (props.onClick) node.addEventListener("click", props.onClick);
  append(node, props.children);
  return node;
}

export const jsxs = jsx;
