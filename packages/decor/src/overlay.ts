/** 宣言 UI のボタンに付ける吹き出しとメニューの重ね表示。描画と操作（位置決め、キーボード、長押し、外側のクリック）をメインスレッドで持つ。
 *
 * 重ね表示は部品の木の外にある 2 つの要素（吹き出しとメニュー）で、アプリの描画領域の中に置く。アプリには要素を公開せず、
 * 宣言（`tip()`・`menu()`）だけを受け取る。 */

/** 長押しでメニューを開くまでの時間（ms） */
const LONG_PRESS = 500;
/** 長押しを取り消す指の移動（px） */
const LONG_PRESS_SLOP = 10;
/** 吹き出しをボタンの上端から離す距離（px）。CSS の変数 `--bina-ui-tip-gap` で変えられる */
const TIP_GAP = 6;

/** 重ね表示が部品の木から読む内容 */
export interface OverlayHost {
  /** ボタンの吹き出しの文字。無ければ undefined */
  tip(node: HTMLElement): string | undefined;
  /** ボタンのメニューの項目。メニューが無ければ空 */
  items(node: HTMLElement): HTMLElement[];
}

/** 吹き出しとメニュー */
export interface Overlay {
  /** DOM を変えたあとに呼ぶ。消えた・隠れた・内容を失ったボタンの吹き出しとメニューを片付ける */
  sync(): void;
  /** root を DOM から外す前に呼ぶ。メニューを開いている・選んだばかりのボタンが消えるとき、フォーカスを残りの最初のボタンへ移す */
  release(root: HTMLElement): void;
  /** リスナーと長押しの待ちを外し、重ね表示の要素を消す */
  stop(): void;
}

/** ボタンの吹き出しとメニューを動かす。リスナーは element に委譲して付ける */
export function createOverlay(element: HTMLElement, host: OverlayHost): Overlay {
  const document = element.ownerDocument;
  const window = document.defaultView;
  let tooltip: HTMLElement | undefined;
  let menu: HTMLElement | undefined;
  const buttonAt = (target: EventTarget | null) => (target as Element | null)?.closest?.<HTMLElement>(".bina-ui-button") ?? null;
  const tipOf = (node: HTMLElement) => host.tip(node);
  const hasMenu = (node: HTMLElement) => !node.matches(":disabled") && host.items(node).length > 0;
  /** 見えている部品か */
  const visible = (node: HTMLElement) => node.isConnected && element.contains(node) && !node.closest("[hidden]");
  /** 一番上の要素の左上を原点にそろえる。部品の領域が fixed の基準になっていても、画面の座標で置ける */
  const place = (target: HTMLElement, left: number, top: number) => {
    target.style.left = "0px";
    target.style.top = "0px";
    const origin = target.getBoundingClientRect();
    target.style.left = `${left - origin.left}px`;
    target.style.top = `${top - origin.top}px`;
  };
  const width = () => window?.innerWidth ?? 0;

  // 吹き出し。名前は aria-label で読み上げるので、吹き出し自体は読み上げに出さない
  let tipFor: HTMLElement | undefined;
  const hideTip = () => {
    tipFor = undefined;
    if (tooltip) tooltip.hidden = true;
  };
  const showTip = (node: HTMLElement) => {
    const label = tipOf(node);
    if (label === undefined || (menu && !menu.hidden)) return;
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "bina-ui-tip";
      tooltip.setAttribute("aria-hidden", "true");
      element.append(tooltip);
    }
    tipFor = node;
    tooltip.textContent = label;
    tooltip.hidden = false;
    const rect = node.getBoundingClientRect();
    const size = tooltip.getBoundingClientRect();
    const gap = Number.parseFloat(window?.getComputedStyle(node).getPropertyValue("--bina-ui-tip-gap") ?? "");
    const right = width() - size.width - 4;
    place(tooltip, Math.max(4, Math.min(rect.left + rect.width / 2 - size.width / 2, right)), rect.top - (Number.isFinite(gap) ? gap : TIP_GAP) - size.height);
  };

  // メニュー（項目はアプリの木の menuItem。開いている間だけ、メニューの中に移す）
  let menuFor: HTMLElement | undefined;
  /** 項目を選んだばかりのボタン。アプリが閉じて消すときに、フォーカスの行き場を作る */
  let chosen: HTMLElement | undefined;
  const items = () => menu ? [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled):not([hidden])')] : [];
  /** root の外にある最初のボタン。フォーカスの行き場 */
  const firstButton = (root: HTMLElement) => [...element.querySelectorAll<HTMLButtonElement>(".bina-ui-button")]
    .find(button => !root.contains(button) && !button.disabled && visible(button));
  const closeMenu = (restore: HTMLElement | null | undefined) => {
    if (!menuFor || !menu) return;
    menuFor.removeAttribute("aria-expanded");
    menuFor = undefined;
    menu.hidden = true;
    menu.replaceChildren();
    document.removeEventListener("pointerdown", outside, true);
    if (restore?.isConnected) restore.focus();
  };
  function outside(event: Event): void {
    if (menuFor && !menu?.contains(event.target as Node | null)) closeMenu(menuFor);
  }
  const openMenu = (node: HTMLElement) => {
    const list = host.items(node);
    if (!visible(node) || !hasMenu(node) || !list.length || menuFor === node) return;
    closeMenu(undefined);
    hideTip();
    if (!menu) {
      menu = document.createElement("div");
      menu.className = "bina-ui-menu";
      menu.setAttribute("role", "menu");
      // メニューキーの keyup で届く contextmenu で、ブラウザのメニューを重ねない
      menu.addEventListener("contextmenu", event => event.preventDefault());
      menu.addEventListener("keydown", menuKey);
      // 項目のハンドラーは項目自身が持つ。選んだら閉じる
      menu.addEventListener("click", event => {
        if (!menuFor || !(event.target as Element | null)?.closest?.(".bina-ui-menuItem")) return;
        const back = menuFor;
        chosen = back;
        closeMenu(back);
      });
      element.append(menu);
    }
    const title = document.createElement("div");
    title.className = "bina-ui-menuTitle";
    title.id = `bina-menu-${crypto.randomUUID()}`;
    const icon = node.querySelector<HTMLElement>("img[src]")?.getAttribute("src");
    if (icon) {
      const image = document.createElement("img");
      image.alt = "";
      image.src = icon;
      title.append(image);
    }
    title.append(tipOf(node) ?? node.getAttribute("aria-label") ?? "");
    menu.replaceChildren(title, ...list);
    menu.setAttribute("aria-labelledby", title.id);
    menuFor = node;
    node.setAttribute("aria-expanded", "true");
    menu.hidden = false;
    const rect = node.getBoundingClientRect();
    const size = menu.getBoundingClientRect();
    const right = width() - size.width - 8;
    place(menu, Math.max(8, Math.min(rect.left + rect.width / 2 - size.width / 2, right)), rect.top - size.height - 8 >= 8 ? rect.top - size.height - 8 : rect.bottom + 8);
    items()[0]?.focus();
    document.addEventListener("pointerdown", outside, true);
  };
  function menuKey(event: KeyboardEvent): void {
    const all = items();
    const index = all.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => { event.preventDefault(); all[(next + all.length) % all.length]?.focus(); };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index < 0 ? -1 : index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(-1);
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); all[index]?.click(); }
    else if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); closeMenu(menuFor); }
  }

  // 長押し。指が動いたら取り消し、開いたあとのクリックではボタンを押さない
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
      chosen = undefined;
      hideTip();
      cancelPress();
      const node = buttonAt(event.target);
      if (!node || !hasMenu(node) || (pointer.pointerType !== "touch" && pointer.pointerType !== "pen")) return;
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
      if (!node || !hasMenu(node)) return;
      event.preventDefault();
      cancelPress();
      openMenu(node);
    }],
    ["keydown", event => {
      const key = event as KeyboardEvent;
      pointing = false;
      chosen = undefined;
      if (key.key === "Escape") hideTip();
      const node = buttonAt(event.target);
      if (!node || !hasMenu(node)) return;
      if (key.key === "ContextMenu" || (key.shiftKey && key.key === "F10")) { event.preventDefault(); openMenu(node); }
    }],
  ];
  for (const [type, listener, options] of listeners) element.addEventListener(type, listener, options);

  return {
    sync() {
      // 消えた・隠れた・メニューを失ったボタンのメニューと吹き出しは残さない
      if (menuFor && (!visible(menuFor) || !hasMenu(menuFor))) closeMenu(menu?.contains(document.activeElement) ? firstButton(menuFor) : undefined);
      if (tipFor && (!visible(tipFor) || tipOf(tipFor) === undefined)) hideTip();
    },
    release(root) {
      const lost = (menuFor !== undefined && root.contains(menuFor)) || (chosen !== undefined && root.contains(chosen));
      if (!lost) return;
      const active = document.activeElement;
      const focused = root.contains(active) || (menu?.contains(active) ?? false);
      if (menuFor && root.contains(menuFor)) closeMenu(undefined);
      chosen = undefined;
      if (focused) firstButton(root)?.focus();
    },
    stop() {
      closeMenu(undefined);
      cancelPress();
      for (const [type, listener, options] of listeners) element.removeEventListener(type, listener, options);
      tooltip?.remove();
      menu?.remove();
      tooltip = menu = undefined;
    },
  };
}
