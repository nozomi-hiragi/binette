import { appIcon, buttonOf, mount, row, show, text } from "@binette/decor";
import { startSystem, type SystemOptions, type SystemUi, type SystemView, type BinetteSystem } from "@binette/regie";
import { mountApp } from "./mount.ts";
import { mountLiveMode } from "./live.ts";

/** 表示の設定 */
export interface ShellUiOptions {
  installed?: boolean;
  onError?: (error: unknown) => void;
}
/** 枠の設定 */
export interface ShellOptions extends Omit<SystemOptions, "ui">, ShellUiOptions {}
/** 描画した枠 */
export interface MountedShell {
  requireInstall(reason: string): boolean;
  stop(): void;
}
/** システムにつなぐ表示 */
export interface ShellUi extends SystemUi, MountedShell {
  bind(system: BinetteSystem): void;
}

/** 線画のアイコンを CSS の mask にする。色は currentColor で塗るので、ダークでも文字と同じ色になる */
const lineIcon = (path: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`)}")`;
const homeIcon = lineIcon("M4 10.4 12 4l8 6.4V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z");
const installIcon = lineIcon("M12 4.5v13M6.5 12l5.5 5.5 5.5-5.5");
/** ホームバーの中の Décor の部品。key（data-bina-key）で選ぶ */
const bar = ".bina-shell-homebar";
const dock = `${bar} [data-bina-key="dock"]`;
const dockButton = `${dock} > .bina-ui-button`;
const home = `${bar} [data-bina-key="home"]`;
const install = `${bar} [data-bina-key="install"]`;
// 色は --bina-shell-* と Décor の OS の役割の色（--bina-ui-*）だけで決め、ライトとダークで同じ規則にする
const accent = "var(--bina-ui-accent, var(--bina-shell-focus, #3273b9))";
/** 淡いアクセントの面。下の面に透かして重ねるので、ダークの持ち上げた台の上でも沈まない */
const accentSoft = `color-mix(in srgb, ${accent} 14%, transparent)`;
/** ダークでは台と吹き出しを背景より少し明るくして持ち上げる。light-dark() の無いブラウザはライトの値のまま（@supports で分ける） */
const raised = (light: string, mix: number) => `light-dark(${light}, color-mix(in srgb, var(--bina-shell-color, #f5f6f8) ${mix}%, var(--bina-shell-background, #1a1c21)))`;
const dockBackground = "var(--bina-shell-surface, #fff)";
const tipBackground = "var(--bina-ui-dark, #16181d)";
const hover = "color-mix(in srgb, currentColor 8%, transparent)";
const muted = "var(--bina-ui-muted, color-mix(in srgb, var(--bina-shell-color, #16181d) 62%, transparent))";
const line = "var(--bina-ui-line, var(--bina-shell-border, #d5dae1))";

const css = `
:where(.bina-shell) { display: flex; flex-direction: column; flex: 1; min-height: 0; height: 100%; font: inherit; isolation: isolate; }
:where(.bina-shell) [hidden] { display: none; }
:where(.bina-shell-stage) { position: relative; display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; isolation: isolate; }
:where(.bina-shell-live) { position: absolute; z-index: 2147483647; pointer-events: none; right: max(var(--bina-shell-padding, 12px), env(safe-area-inset-right, 0px)); bottom: max(var(--bina-shell-padding, 12px), env(safe-area-inset-bottom, 0px)); color: var(--bina-shell-live-color, var(--bina-shell-color, #16181d)); opacity: var(--bina-shell-live-opacity, 0.35); font-size: var(--bina-shell-live-size, 0.875em); }
:where(.bina-shell-install-dialog) { z-index: 2147483647; max-width: min(28rem, 80vw); padding: var(--bina-shell-padding, 12px); border: 1px solid var(--bina-shell-border, #d5dae1); border-radius: var(--bina-shell-radius, 12px); background: var(--bina-shell-surface, #fff); color: var(--bina-shell-color, #16181d); font: inherit; overflow-wrap: anywhere; }
:where(.bina-shell-homebar) { display: block; flex-shrink: 0; margin-top: auto; padding: var(--bina-shell-homebar-padding-block, 4px) var(--bina-shell-padding, 12px); padding-bottom: max(var(--bina-shell-homebar-padding-block, 4px), env(safe-area-inset-bottom, 0px)); padding-left: max(var(--bina-shell-padding, 12px), env(safe-area-inset-left, 0px)); padding-right: max(var(--bina-shell-padding, 12px), env(safe-area-inset-right, 0px)); border-top: 1px solid var(--bina-shell-border, #d5dae1); background: var(--bina-shell-background, #f3f5f8); color: var(--bina-shell-color, #16181d); container: bina-shell-homebar / inline-size; }
/* 左にホーム、中央にドック、右にインストール。ドックが広いときは両端を縮めずドックの中だけをスクロールする */
${bar} > [data-bina-key="homebar"] { display: grid; grid-template-columns: minmax(max-content, 1fr) minmax(0, auto) minmax(max-content, 1fr); align-items: center; gap: var(--bina-shell-gap, 8px); min-height: 52px; padding: 0; }
${bar} .bina-ui-button { -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; user-select: none; }
${home}, ${install} { grid-row: 1; display: inline-flex; flex-direction: row; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box; min-width: 0; min-height: 0; height: 36px; padding: 0; border: 0; border-radius: 10px; background: transparent; color: inherit; font: inherit; line-height: 1; white-space: nowrap; }
${home}::before, ${install}::before { content: ""; flex: none; width: 20px; height: 20px; background: currentColor; -webkit-mask: var(--bina-shell-icon) center / contain no-repeat; mask: var(--bina-shell-icon) center / contain no-repeat; }
${home} { grid-column: 1; justify-self: start; width: 36px; --bina-shell-icon: ${homeIcon}; }
${home}:hover { background: ${hover}; }
${home}[aria-pressed="true"] { background: ${accentSoft}; color: var(--bina-ui-accent-text, ${accent}); }
${install} { grid-column: 3; justify-self: end; height: 32px; padding: 0 14px 0 10px; border-radius: 999px; background: ${accent}; color: var(--bina-ui-accent-content, var(--bina-shell-surface, #fff)); font-size: 13px; font-weight: 600; --bina-shell-icon: ${installIcon}; }
${install}::before { width: 16px; height: 16px; }
${install}:not(:disabled):hover { background: color-mix(in srgb, ${accent} 86%, var(--bina-shell-color, #16181d)); }
${install} > .bina-ui-text { padding: 0; }
${home}:focus-visible, ${install}:focus-visible { outline: 2px solid var(--bina-shell-focus, #3273b9); outline-offset: 2px; }
@container bina-shell-homebar (width < 720px) {
  ${install} { width: 36px; height: 36px; padding: 0; border-radius: 10px; background: transparent; color: inherit; }
  ${install}::before { width: 20px; height: 20px; }
  ${install}:not(:disabled):hover { background: ${hover}; }
  ${install} > .bina-ui-text { display: none; }
}
${dock} { grid-row: 1; grid-column: 2; justify-self: center; display: flex; align-items: center; gap: 2px; box-sizing: border-box; min-width: 0; max-width: 100%; padding: 6px; border-radius: 16px; background: var(--bina-shell-dock-background, ${dockBackground}); box-shadow: var(--bina-shell-dock-shadow, 0 0 0 1px color-mix(in srgb, currentColor 8%, transparent), 0 2px 8px color-mix(in srgb, var(--bina-shell-color, #16181d) 10%, transparent)); overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none; --bina-ui-icon-size: 26px; }
${dock}::-webkit-scrollbar { display: none; }
${dockButton} { position: relative; flex: none; display: grid; place-items: center; box-sizing: border-box; width: 40px; height: 40px; min-width: 0; min-height: 0; padding: 0; border: 0; border-radius: 12px; background: transparent; color: inherit; }
${dockButton}:hover { background: ${hover}; }
${dockButton}[aria-pressed="true"] { background: ${accentSoft}; }
${dockButton}[aria-pressed="true"]::after { content: ""; position: absolute; left: 50%; bottom: 2px; width: 4px; height: 4px; margin-left: -2px; border-radius: 50%; background: ${accent}; }
/* ドックはスクロールで外側を切るので、フォーカスの枠は内側に引く */
${dockButton}:focus-visible { outline: 2px solid var(--bina-shell-focus, #3273b9); outline-offset: -2px; }
${dockButton} > .bina-ui-appIcon { display: block; pointer-events: none; }
/* アイコンの無いアプリの頭文字の札 */
${dockButton} > .bina-ui-text { display: grid; place-items: center; box-sizing: border-box; width: 26px; height: 26px; padding: 0; border-radius: 8px; background: var(--bina-ui-sunken, var(--bina-shell-background, #f3f5f8)); box-shadow: inset 0 0 0 1px ${line}; font-size: 13px; font-weight: 600; line-height: 1; }
:where(.bina-shell-tooltip) { position: fixed; z-index: 2147483647; pointer-events: none; box-sizing: border-box; max-width: calc(100vw - 8px); padding: 4px 8px; border-radius: 6px; background: ${tipBackground}; color: var(--bina-ui-dark-content, #d7dae0); box-shadow: 0 0 0 1px var(--bina-ui-dark-line, #2e323a); font-size: 12px; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transform: translateY(-100%); }
:where(.bina-shell-menu) { position: fixed; z-index: 2147483647; box-sizing: border-box; min-width: 160px; max-width: calc(100vw - 16px); padding: 4px; border-radius: 12px; background: var(--bina-shell-surface, #fff); color: var(--bina-shell-color, #16181d); box-shadow: 0 0 0 1px ${line}, 0 8px 24px color-mix(in srgb, var(--bina-shell-color, #16181d) 16%, transparent); font-size: 14px; }
:where(.bina-shell-menu-title) { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; padding: 6px 10px 8px; border-bottom: 1px solid ${line}; color: ${muted}; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
:where(.bina-shell-menu-title img) { flex: none; width: 16px; height: 16px; }
:where(.bina-shell-menu-item) { display: block; box-sizing: border-box; width: 100%; padding: 8px 10px; border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit; text-align: start; cursor: pointer; }
:where(.bina-shell-menu-item:hover, .bina-shell-menu-item:focus) { background: ${accentSoft}; outline: none; }
:where(.bina-shell-menu-item:focus-visible) { outline: 2px solid var(--bina-shell-focus, #3273b9); outline-offset: -2px; }
@supports (color: light-dark(#fff, #000)) {
  ${dock} { background: var(--bina-shell-dock-background, ${raised(dockBackground, 9)}); }
  :where(.bina-shell-tooltip) { background: ${raised(tipBackground, 22)}; }
  :where(.bina-shell-menu) { background: ${raised("var(--bina-shell-surface, #fff)", 9)}; }
}
:where(.bina-shell-button) { font: inherit; color: inherit; cursor: pointer; border: 1px solid var(--bina-shell-border, #d5dae1); background: var(--bina-shell-surface, #fff); border-radius: var(--bina-shell-radius, 12px); padding: var(--bina-shell-button-padding, 12px); }
:where(.bina-shell-button):focus-visible { outline: 2px solid var(--bina-shell-focus, #3273b9); outline-offset: 2px; }
:where(.bina-shell-app) { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; }
:where(.bina-shell-apps) { display: flex; flex-direction: column; align-items: flex-start; flex: 1; min-height: 0; overflow: auto; gap: var(--bina-shell-gap, 8px); padding: var(--bina-shell-padding, 12px); background: var(--bina-shell-background, #f3f5f8); color: var(--bina-shell-color, #16181d); }
:where(.bina-shell-apps-link) { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; padding: 0; text-align: start; text-decoration: underline; overflow-wrap: anywhere; }
:where(.bina-shell-apps-link):focus-visible { outline: 2px solid var(--bina-shell-focus, #3273b9); outline-offset: 2px; }
:where(.bina-shell-status) { color: var(--bina-shell-error, #b3261e); }
`;

/** 長押しでメニューを開くまでの時間（ms） */
const LONG_PRESS = 500;
/** 長押しを取り消す指の移動（px） */
const LONG_PRESS_SLOP = 10;
const DOCK_KEY = "dock-";

/** 名前の最初の文字（書記素）。アイコンの無いアプリの札に使う */
function initial(name: string): string {
  const first = new Intl.Segmenter().segment(name.trim())[Symbol.iterator]().next();
  return first.done ? "?" : first.value.segment.toLocaleUpperCase();
}

/** システムの状態を描き、ボタンとページの知らせを渡す */
export function createShellUi(element: HTMLElement, options: ShellUiOptions = {}): ShellUi {
  const document = element.ownerDocument;
  const window = document.defaultView;
  const root = document.createElement("div");
  root.className = "bina-shell";
  const style = document.createElement("style");
  style.textContent = css;
  const toolbar = document.createElement("nav");
  toolbar.className = "bina-shell-homebar";
  toolbar.setAttribute("aria-label", "ホームバー");
  const status = document.createElement("p");
  status.className = "bina-shell-status";
  status.setAttribute("role", "status");
  status.hidden = true;
  const appsHost = document.createElement("div");
  appsHost.className = "bina-shell-apps";
  appsHost.hidden = true;
  const stage = document.createElement("div");
  stage.className = "bina-shell-stage";
  stage.append(appsHost, status);
  // 吹き出しとメニューは Décor の木の外に置く OS の重ね表示。アプリには公開しない
  const tooltip = document.createElement("div");
  tooltip.className = "bina-shell-tooltip";
  tooltip.setAttribute("aria-hidden", "true");
  tooltip.hidden = true;
  const menu = document.createElement("div");
  menu.className = "bina-shell-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  const live = mountLiveMode(stage, options.installed, () => render());
  root.append(style, stage, toolbar, tooltip, menu);
  element.replaceChildren(root);
  // ホームバーの並びは Décor の宣言の木で描く。appIcon(i) は icons[i] の SVG を描く
  const icons: { icon?: string }[] = [];
  const iconIndex = new Map<string, number>();
  const homebar = mount(toolbar, { apps: icons });
  let system: BinetteSystem | undefined;
  let stopped = false;
  let frozen = false;
  let view: SystemView = { instances: [], front: undefined, apps: [], clearError: false };
  const hosts = new Map<number, { host: HTMLElement; stop(): void }>();
  const reported = new WeakSet<object>();
  const iconOf = (icon: string) => {
    let index = iconIndex.get(icon);
    if (index === undefined) { index = icons.push({ icon }) - 1; iconIndex.set(icon, index); }
    return index;
  };
  function render(): void {
    if (stopped) return;
    const front = view.front;
    const homeInstance = view.instances.find(instance => instance.home);
    const docked = view.instances.filter(instance => !instance.home && !instance.closing);
    const dockButtons = docked.map(instance =>
      buttonOf([instance.icon === undefined ? text(initial(instance.name)) : appIcon(iconOf(instance.icon))], () => { void system?.open(instance.key); })
        .label(`${instance.name}を開く`).selected(front === instance.id).key(DOCK_KEY + instance.id));
    homebar.render(row([
      buttonOf([], () => { void system?.openHome(); }).label("ホームを開く").selected(homeInstance !== undefined && front === homeInstance.id).key("home"),
      // 開いているアプリが無いときは、空の台を見せずに隠す
      show(docked.length > 0, row(dockButtons).key("dock")),
      show(!live.installed, buttonOf([text("インストール")], () => { void live.install(); }).label("インストール").enabled(!live.busy).key("install")),
    ]).key("homebar"));
    // aria-haspopup は Décor の修飾に無いので、描いたボタンに OS が付ける
    for (const node of toolbar.querySelectorAll<HTMLElement>(`[data-bina-key^="${DOCK_KEY}"]`)) node.setAttribute("aria-haspopup", "menu");
  }
  const buttonAt = (target: EventTarget | null) => (target as Element | null)?.closest?.<HTMLElement>(".bina-ui-button[data-bina-key]") ?? null;
  const keyOf = (node: HTMLElement) => node.getAttribute("data-bina-key") ?? "";
  const instanceOf = (node: HTMLElement) => {
    const key = keyOf(node);
    if (!key.startsWith(DOCK_KEY)) return undefined;
    const id = Number(key.slice(DOCK_KEY.length));
    return view.instances.find(instance => instance.id === id && !instance.home && !instance.closing);
  };
  const homeButton = () => toolbar.querySelector<HTMLElement>('[data-bina-key="home"]');

  // 吹き出し。名前は aria-label で読み上げるので、吹き出し自体は読み上げに出さない
  let tipFor: HTMLElement | undefined;
  const hideTip = () => { tipFor = undefined; tooltip.hidden = true; };
  const showTip = (node: HTMLElement) => {
    const key = keyOf(node);
    const label = key === "home" ? "ホーム" : key === "install" ? "Binette をインストール" : instanceOf(node)?.name;
    if (label === undefined || !menu.hidden) return;
    tipFor = node;
    tooltip.textContent = label;
    tooltip.hidden = false;
    const rect = node.getBoundingClientRect();
    const width = tooltip.offsetWidth;
    const right = (window?.innerWidth ?? 0) - width - 4;
    tooltip.style.left = `${Math.max(4, Math.min(rect.left + rect.width / 2 - width / 2, right))}px`;
    // ドックのボタンは台の上に出し、台の縁に重ねない
    const top = (node.closest<HTMLElement>('[data-bina-key="dock"]') ?? node).getBoundingClientRect().top;
    tooltip.style.top = `${top - 6}px`;
  };

  // アプリのボタンのメニュー（開く・閉じる）
  let menuFor: HTMLElement | undefined;
  const items = () => [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  const closeMenu = (restore: HTMLElement | null | undefined) => {
    if (!menuFor) return;
    menuFor.removeAttribute("aria-expanded");
    menuFor = undefined;
    menu.hidden = true;
    menu.replaceChildren();
    document.removeEventListener("pointerdown", outside, true);
    if (restore?.isConnected) restore.focus();
  };
  function outside(event: Event): void {
    if (menuFor && !menu.contains(event.target as Node | null)) closeMenu(menuFor);
  }
  const openMenu = (node: HTMLElement) => {
    const instance = instanceOf(node);
    if (!instance || stopped || menuFor === node) return;
    closeMenu(undefined);
    hideTip();
    const title = document.createElement("div");
    title.className = "bina-shell-menu-title";
    title.id = `bina-menu-${crypto.randomUUID()}`;
    if (instance.icon !== undefined) {
      const image = document.createElement("img");
      image.alt = "";
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(instance.icon)}`;
      title.append(image);
    }
    title.append(instance.name);
    const item = (label: string, action: () => void, restore: () => HTMLElement | null) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "bina-shell-menu-item";
      button.setAttribute("role", "menuitem");
      button.tabIndex = -1;
      button.textContent = label;
      button.addEventListener("click", () => { const back = restore(); action(); closeMenu(back); });
      return button;
    };
    menu.replaceChildren(title,
      item("開く", () => { void system?.open(instance.key); }, () => node),
      // 閉じたアプリのボタンは消えるので、フォーカスはホームへ移す
      item("閉じる", () => { void system?.close(instance.id); }, homeButton));
    menu.setAttribute("aria-labelledby", title.id);
    menuFor = node;
    node.setAttribute("aria-expanded", "true");
    menu.hidden = false;
    const rect = node.getBoundingClientRect();
    const width = menu.offsetWidth, height = menu.offsetHeight;
    const right = (window?.innerWidth ?? 0) - width - 8;
    menu.style.left = `${Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, right))}px`;
    menu.style.top = `${rect.top - height - 8 >= 8 ? rect.top - height - 8 : rect.bottom + 8}px`;
    items()[0]!.focus();
    document.addEventListener("pointerdown", outside, true);
  };
  // メニューキーの keyup で届く contextmenu で、ブラウザのメニューを重ねない
  menu.addEventListener("contextmenu", event => event.preventDefault());
  menu.addEventListener("keydown", event => {
    const all = items();
    const index = all.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => { event.preventDefault(); all[(next + all.length) % all.length]!.focus(); };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index < 0 ? -1 : index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(-1);
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); all[index]?.click(); }
    else if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); closeMenu(menuFor); }
  });

  // 長押し。指が動いたら取り消し、開いたあとのクリックではアプリを開かない
  let press: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | undefined;
  let swallowClick = false;
  // ポインターで押して入ったフォーカスでは吹き出しを出さない（マウスは載せたときに出している）
  let pointing = false;
  const cancelPress = () => { if (press) clearTimeout(press.timer); press = undefined; };
  const listeners: [string, (event: Event) => void, AddEventListenerOptions?][] = [
    ["pointerover", event => {
      const node = buttonAt(event.target);
      if (node && (event as PointerEvent).pointerType !== "touch" && node !== tipFor) showTip(node);
    }],
    ["pointerout", event => {
      const node = buttonAt(event.target);
      if (node && node === tipFor && !node.contains((event as PointerEvent).relatedTarget as Node | null)) hideTip();
    }],
    ["focusin", event => { const node = buttonAt(event.target); if (node && !pointing) showTip(node); }],
    ["focusout", () => { pointing = false; hideTip(); }],
    ["pointerdown", event => {
      const pointer = event as PointerEvent;
      pointing = true;
      swallowClick = false;
      hideTip();
      cancelPress();
      const node = buttonAt(event.target);
      if (!node || !instanceOf(node) || (pointer.pointerType !== "touch" && pointer.pointerType !== "pen")) return;
      press = { x: pointer.clientX, y: pointer.clientY, timer: setTimeout(() => { press = undefined; swallowClick = true; openMenu(node); }, LONG_PRESS) };
    }],
    ["pointermove", event => {
      const pointer = event as PointerEvent;
      if (press && Math.hypot(pointer.clientX - press.x, pointer.clientY - press.y) > LONG_PRESS_SLOP) cancelPress();
    }],
    ["pointerup", cancelPress],
    ["pointercancel", cancelPress],
    ["click", event => { if (swallowClick) { swallowClick = false; event.preventDefault(); event.stopPropagation(); } }, { capture: true }],
    ["contextmenu", event => {
      const node = buttonAt(event.target);
      if (!node || !instanceOf(node)) return;
      event.preventDefault();
      cancelPress();
      openMenu(node);
    }],
    ["keydown", event => {
      const key = event as KeyboardEvent;
      pointing = false;
      if (key.key === "Escape") hideTip();
      const node = buttonAt(event.target);
      if (!node || !instanceOf(node)) return;
      if (key.key === "ContextMenu" || (key.shiftKey && key.key === "F10")) { event.preventDefault(); openMenu(node); }
    }],
    // 縦のホイールでドックを横にスクロールする
    ["wheel", event => {
      const wheel = event as WheelEvent;
      const row = (event.target as Element | null)?.closest?.<HTMLElement>('[data-bina-key="dock"]');
      if (!row || row.scrollWidth <= row.clientWidth || Math.abs(wheel.deltaY) <= Math.abs(wheel.deltaX)) return;
      event.preventDefault();
      row.scrollLeft += wheel.deltaY;
    }, { passive: false }],
  ];
  for (const [type, listener, options] of listeners) toolbar.addEventListener(type, listener, options);

  const setPage = () => system?.setPage({ visible: document.visibilityState === "visible", frozen });
  const freeze = () => { frozen = true; setPage(); };
  const resume = () => { frozen = false; setPage(); };
  document.addEventListener("visibilitychange", setPage);
  document.addEventListener("freeze", freeze);
  document.addEventListener("resume", resume);
  const ui: ShellUi = {
    bind(value) { if (!stopped) { system = value; setPage(); } },
    present(instance, process) {
      const host = document.createElement("div");
      host.className = "bina-shell-app";
      host.classList.toggle("bina-shell-content", !instance.home);
      host.hidden = view.front !== instance.id;
      stage.insertBefore(host, status);
      const mounted = mountApp(host, instance.app.html, process, { apps: instance.apps, onError: error => ui.report(error) });
      const remove = () => { mounted.stop(); host.remove(); hosts.delete(instance.id); };
      hosts.set(instance.id, { host, stop: remove });
      return { remove };
    },
    update(next) {
      if (stopped) return;
      if (next.clearError) status.hidden = true;
      view = next;
      const front = next.front;
      for (const [id, entry] of hosts) entry.host.hidden = id !== front;
      appsHost.hidden = front !== "apps";
      if (front === "apps" && !appsHost.hasChildNodes()) {
        for (const app of next.apps) {
          const link = document.createElement("button");
          link.type = "button";
          link.className = "bina-shell-apps-link";
          link.textContent = app.name;
          link.setAttribute("aria-label", `${app.name}を開く`);
          link.addEventListener("click", () => { void system?.open(app.key); });
          appsHost.append(link);
        }
      }
      render();
      // 閉じた・閉じかけのアプリのメニューと吹き出しは残さない
      if (menuFor && (!menuFor.isConnected || !instanceOf(menuFor))) closeMenu(menu.contains(document.activeElement) ? homeButton() : undefined);
      if (tipFor && (!tipFor.isConnected || tipFor.hidden || (keyOf(tipFor).startsWith(DOCK_KEY) && !instanceOf(tipFor)))) hideTip();
    },
    report(error) {
      if (stopped) return;
      status.textContent = error instanceof Error ? error.message : String(error);
      status.hidden = false;
      if (typeof error === "object" && error !== null) {
        if (reported.has(error)) return;
        reported.add(error);
      }
      options.onError?.(error);
    },
    requireInstall: live.requireInstall,
    stop() {
      if (stopped) return;
      closeMenu(undefined);
      cancelPress();
      stopped = true;
      system = undefined;
      for (const entry of hosts.values()) entry.stop();
      document.removeEventListener("visibilitychange", setPage);
      document.removeEventListener("freeze", freeze);
      document.removeEventListener("resume", resume);
      for (const [type, listener, options] of listeners) toolbar.removeEventListener(type, listener, options);
      live.stop();
      homebar.unmount();
      root.remove();
    },
  };
  ui.update(view);
  return ui;
}

/** システムと表示をつなぎ、ホームを開く */
export async function mountShell(element: HTMLElement, options: ShellOptions): Promise<MountedShell> {
  const previous = [...element.childNodes];
  const ui = createShellUi(element, options);
  try {
    const system = await startSystem({ ...options, ui });
    ui.bind(system);
    await system.openHome();
    return { requireInstall: ui.requireInstall, stop() { system.stop(); ui.stop(); } };
  } catch (error) {
    ui.stop();
    element.replaceChildren(...previous);
    throw error;
  }
}
