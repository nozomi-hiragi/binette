export type Child = Node | string | number | boolean | null | undefined | readonly Child[];

/** {@link h} で付けられる属性 */
export interface Props {
  class?: string;
  type?: "button" | "submit" | "reset";
  "aria-label"?: string;
  onClick?: (event: MouseEvent) => void;
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

// Scene 内の静的な DOM を作るだけで、状態管理や再描画は行わない。
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props?.class !== undefined) node.className = props.class;
  if (props?.type !== undefined) node.setAttribute("type", props.type);
  if (props?.["aria-label"] !== undefined) node.setAttribute("aria-label", props["aria-label"]);
  if (props?.onClick) (node as HTMLElement).addEventListener("click", props.onClick);
  append(node, children);
  return node;
}

/** 子をまとめた DocumentFragment を作る */
export function fragment(...children: Child[]): DocumentFragment {
  const node = document.createDocumentFragment();
  append(node, children);
  return node;
}
