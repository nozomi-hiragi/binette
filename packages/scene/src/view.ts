export function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(label: string, action: () => void) {
  const node = element("button", label);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

/** styles は Scene の決め打ちの見た目のあとに入れる全体の CSS */
export function renderView<T extends Node>(root: ShadowRoot, title: string, main: T, styles: string[] = []) {
  const style = element("style");
  style.textContent = `
    :host { display:block; color:var(--color-base-content); background:var(--color-base-100); font-family:inherit; }
    * { box-sizing:border-box; }
    main { max-width:48rem; margin:auto; padding:1rem; display:grid; gap:1rem; overflow-wrap:anywhere; }
    h1,h2,p { margin:0; } h1 { font-size:1.5rem; } h2 { font-size:1.1rem; }
    section { display:grid; gap:.75rem; padding:1rem; border-radius:var(--radius-box); background:var(--color-base-200); min-width:0; }
    button { min-height:44px; min-width:44px; padding:.5rem 1rem; font:inherit; white-space:normal; overflow-wrap:anywhere; border:1px solid var(--color-base-300); border-radius:var(--radius-field); color:var(--color-base-content); background:var(--color-base-100); cursor:pointer; }
    main.settings-layout { max-width:72rem; display:block; }
    .settings-page { display:grid; gap:1rem; min-width:0; align-content:start; }
    .settings-heading-row { display:flex; align-items:center; gap:.75rem; min-width:0; }
    .settings-heading-row h1 { flex:1 1 0%; min-width:0; overflow-wrap:anywhere; }
    .settings-details { min-width:0; }
    .settings-detail[hidden] { display:none; }
    .settings-has-detail .settings-overview { display:none; }
    .settings-back { justify-self:start; display:grid; place-items:center; padding:.5rem; }
    .settings-back::before { content:""; width:.55rem; height:.55rem; border-left:2px solid currentColor; border-bottom:2px solid currentColor; transform:translateX(2px) rotate(45deg); }
    .settings-row[aria-current="page"] { border-color:var(--color-primary); background:var(--color-base-300); }
    @media (min-width:768px) {
      main.settings-layout { display:grid; grid-template-columns:minmax(0, 20rem) minmax(0, 1fr); align-items:start; gap:1.5rem; }
      .settings-has-detail .settings-overview { display:grid; }
      .settings-back-top { display:none; }
    }
    .settings-list { margin:0; padding:0; list-style:none; display:grid; gap:.75rem; min-width:0; }
    .settings-row { display:flex; align-items:center; gap:.75rem; width:100%; min-width:0; min-height:44px; text-align:start; }
    div.settings-row { padding:.5rem 1rem; }
    .settings-row-start,.settings-row-end { flex:0 1 auto; min-width:0; }
    .settings-row-start:empty,.settings-row-end:empty { display:none; }
    .settings-row-label { flex:1 1 0%; min-width:0; }
    button:focus-visible { outline:2px solid var(--color-primary); outline-offset:2px; }
  `;
  root.replaceChildren(style, ...styles.map(css => element("style", css)), main);
  document.title = main instanceof HTMLElement ? main.querySelector("h1")?.textContent ?? title : title;
  return main;
}
