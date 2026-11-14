import { startSystem, type SafeArea, type SystemOptions, type SystemUi, type SystemView, type BinetteSystem } from "@binette/regie";
import { mountApp } from "./mount.ts";
import { mountLiveMode } from "./live.ts";
import { mountOpenUrl } from "./open-url.ts";
import { mountNetConfirm } from "./confirm-net.ts";
import { mountInstallConfirm } from "./confirm.ts";
import { deviceInsets, mountEdgeReveal, safeAreaOf, type RevealTimers } from "./safe-area.ts";

/** 表示の設定 */
export interface ShellUiOptions {
  installed?: boolean;
  onError?: (error: unknown) => void;
  /** フルスクリーンで呼び出した枠を戻す時計。テストで差し替える */
  revealTimers?: RevealTimers;
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

const css = `
:where(.bina-shell) { display: flex; flex-direction: column; flex: 1; min-height: 0; height: 100%; font: inherit; isolation: isolate; position: relative; }
:where(.bina-shell) [hidden] { display: none !important; }
:where(.bina-shell-host) { display: flex; flex-direction: column; flex: 1; min-height: 0; height: 100%; position: relative; overflow: hidden; isolation: isolate; }
:where(.bina-shell-fallback) { display: flex; flex-direction: column; flex: 1; min-height: 0; height: 100%; position: relative; overflow: hidden; isolation: isolate; }
:where(.bina-shell-fallback-area) { display: flex; flex-direction: column; flex: 1; min-height: 0; position: relative; overflow: hidden; isolation: isolate; }
:where(.bina-shell-fallback-bar) { display: flex; align-items: center; justify-content: flex-start; flex-shrink: 0; margin-top: auto; padding: var(--bina-shell-homebar-padding-block, 4px) var(--bina-shell-padding, 12px); padding-bottom: max(var(--bina-shell-homebar-padding-block, 4px), env(safe-area-inset-bottom, 0px)); padding-left: max(var(--bina-shell-padding, 12px), env(safe-area-inset-left, 0px)); padding-right: max(var(--bina-shell-padding, 12px), env(safe-area-inset-right, 0px)); border-top: 1px solid var(--bina-shell-border, #d5dae1); background: var(--bina-shell-background, #f3f5f8); color: var(--bina-shell-color, #16181d); min-height: 52px; }
:where(.bina-shell-fallback-home) { display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box; min-width: 0; min-height: 0; height: 36px; padding: 0 12px; border: 1px solid var(--bina-shell-border, #d5dae1); border-radius: 10px; background: var(--bina-shell-surface, #fff); color: inherit; font: inherit; cursor: pointer; }
:where(.bina-shell-fallback-home):hover { background: color-mix(in srgb, currentColor 8%, transparent); }
:where(.bina-shell-fallback-home):focus-visible { outline: 2px solid var(--bina-shell-focus, #3273b9); outline-offset: 2px; }
:where(.bina-shell-live) { position: absolute; z-index: 2147483647; pointer-events: none; right: max(var(--bina-shell-padding, 12px), env(safe-area-inset-right, 0px)); bottom: max(var(--bina-shell-padding, 12px), env(safe-area-inset-bottom, 0px)); color: var(--bina-shell-live-color, var(--bina-shell-color, #16181d)); opacity: var(--bina-shell-live-opacity, 0.35); font-size: var(--bina-shell-live-size, 0.875em); }
:where(.bina-shell-install-dialog) { z-index: 2147483647; max-width: min(28rem, 80vw); padding: var(--bina-shell-padding, 12px); border: 1px solid var(--bina-shell-border, #d5dae1); border-radius: var(--bina-shell-radius, 12px); background: var(--bina-shell-surface, #fff); color: var(--bina-shell-color, #16181d); font: inherit; overflow-wrap: anywhere; }
/* Cadre の木の根は表示領域より大きくならず、アプリの中身は領域の中でスクロールする */
:where(.bina-shell-host > *) { min-height: 0; min-width: 0; }
:where(.bina-shell-app) { display: flex; flex-direction: column; flex: 1; box-sizing: border-box; min-height: 0; width: 100%; height: 100%; overflow: auto; overscroll-behavior: contain; }
:where(.bina-shell-apps) { display: flex; flex-direction: column; align-items: flex-start; flex: 1; box-sizing: border-box; min-height: 0; width: 100%; height: 100%; overflow: auto; gap: var(--bina-shell-gap, 8px); padding: var(--bina-shell-padding, 12px); background: var(--bina-shell-background, #f3f5f8); color: var(--bina-shell-color, #16181d); }
:where(.bina-shell-apps-link) { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; padding: 0; text-align: start; text-decoration: underline; overflow-wrap: anywhere; }
:where(.bina-shell-apps-link):focus-visible { outline: 2px solid var(--bina-shell-focus, #3273b9); outline-offset: 2px; }
:where(.bina-shell-confirm-source) { margin-top: 0; color: var(--bina-shell-muted, #5b6472); }
:where(.bina-shell-confirm-permissions) { padding-inline-start: 1.25em; }
:where(.bina-shell-confirm-reason) { color: var(--bina-shell-muted, #5b6472); }
:where(.bina-shell-confirm-actions) { display: flex; justify-content: flex-end; gap: var(--bina-shell-gap, 8px); }
:where(.bina-shell-status) { color: var(--bina-shell-error, #b3261e); margin: var(--bina-shell-padding, 12px); }
/* OS の枠（Décor の reserve）。フルスクリーンでは画面の外へすべらせ、辺の帯で呼び出した枠だけを戻す。Cadre の transform と重ならないよう translate で動かす */
.bina-shell-host [data-bina-reserve] { transition: translate 200ms ease-out; }
.bina-shell-fullscreen .bina-shell-host [data-bina-reserve]:not([data-bina-revealed]) { pointer-events: none; }
.bina-shell-fullscreen .bina-shell-host :is([data-bina-reserve="tl"], [data-bina-reserve="tc"], [data-bina-reserve="tr"]):not([data-bina-revealed]) { translate: 0 calc(-100% - 64px); }
.bina-shell-fullscreen .bina-shell-host :is([data-bina-reserve="bl"], [data-bina-reserve="bc"], [data-bina-reserve="br"]):not([data-bina-revealed]) { translate: 0 calc(100% + 64px); }
.bina-shell-fullscreen .bina-shell-host [data-bina-reserve="ml"]:not([data-bina-revealed]) { translate: calc(-100% - 64px) 0; }
.bina-shell-fullscreen .bina-shell-host [data-bina-reserve="mr"]:not([data-bina-revealed]) { translate: calc(100% + 64px) 0; }
@media (prefers-reduced-motion: reduce) { .bina-shell-host [data-bina-reserve] { transition: none; } }
:where(.bina-shell-edge) { position: absolute; z-index: 2147483646; touch-action: none; }
:where(.bina-shell-edge[data-edge="top"]) { top: 0; left: 0; right: 0; height: 8px; }
:where(.bina-shell-edge[data-edge="bottom"]) { bottom: 0; left: 0; right: 0; height: 8px; }
:where(.bina-shell-edge[data-edge="left"]) { top: 0; bottom: 0; left: 0; width: 8px; }
:where(.bina-shell-edge[data-edge="right"]) { top: 0; bottom: 0; right: 0; width: 8px; }
/* 端末の切り欠きの幅を読むための見えない箱 */
:where(.bina-shell-insets) { position: absolute; visibility: hidden; pointer-events: none; width: 0; height: 0; padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px); }
:where(.bina-shell-progress) { color: var(--bina-shell-color, #16181d); }
`;

export function createShellUi(element: HTMLElement, options: ShellUiOptions = {}): ShellUi {
  const document = element.ownerDocument;
  const root = document.createElement("div");
  root.className = "bina-shell";
  const style = document.createElement("style");
  style.textContent = css;

  const cadreHost = document.createElement("div");
  cadreHost.className = "bina-shell-host";

  const fallback = document.createElement("div");
  fallback.className = "bina-shell-fallback";
  fallback.hidden = true;
  const fallbackArea = document.createElement("div");
  fallbackArea.className = "bina-ui-appArea bina-shell-fallback-area";
  const fallbackBar = document.createElement("nav");
  fallbackBar.className = "bina-shell-fallback-bar";
  fallbackBar.setAttribute("aria-label", "大枠");
  const fallbackHome = document.createElement("button");
  fallbackHome.type = "button";
  fallbackHome.className = "bina-shell-fallback-home";
  fallbackHome.textContent = "ホーム";
  fallbackHome.setAttribute("aria-label", "ホームを開く");
  fallbackHome.addEventListener("click", () => { void system?.openHome(); });
  fallbackBar.append(fallbackHome);
  fallback.append(fallbackArea, fallbackBar);

  const status = document.createElement("p");
  status.className = "bina-shell-status";
  status.setAttribute("role", "status");
  status.hidden = true;

  const progress = document.createElement("p");
  progress.className = "bina-shell-status bina-shell-progress";
  progress.setAttribute("role", "status");
  progress.textContent = "今の OS 向けに作り直しています";
  progress.hidden = true;

  const appsHost = document.createElement("div");
  appsHost.className = "bina-shell-apps";
  appsHost.hidden = true;

  const live = mountLiveMode(root, options.installed, () => {
    system?.setInstallState?.(live.installed, live.busy);
  });
  const confirm = mountInstallConfirm(root);
  const netConfirm = mountNetConfirm(root);
  const openUrl = mountOpenUrl(root);
  const insets = document.createElement("div");
  insets.className = "bina-shell-insets";
  insets.setAttribute("aria-hidden", "true");
  root.append(style, insets, cadreHost, fallback, appsHost, status, progress);
  element.replaceChildren(root);
  const frames = () => [...cadreHost.querySelectorAll<HTMLElement>("[data-bina-reserve]")].filter(frame => !frame.closest(".bina-ui-appArea"));
  const edge = mountEdgeReveal(root, { frames, timers: options.revealTimers });

  let system: BinetteSystem | undefined;
  let stopped = false;
  let frozen = false;
  let view: SystemView = { instances: [], front: undefined, apps: [], clearError: false, cadreUnavailable: false };
  const hosts = new Map<number, { host: HTMLElement; stop(): void }>();
  let cadreMounted: { stop(): void } | undefined;
  const reported = new WeakSet<object>();

  function getAppArea(): HTMLElement {
    if (!fallback.hidden) return fallbackArea;
    const area = cadreHost.querySelector<HTMLElement>(".bina-ui-appArea");
    return area ?? cadreHost;
  }

  // セーフエリア。Cadre の枠を測り、アプリの表示先の CSS の変数とアプリ（Régie 経由）に渡す
  let safeArea: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };
  const safeTargets = () => [...[...hosts.values()].map(entry => entry.host), appsHost];
  const writeSafeArea = (host: HTMLElement) => {
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const value = `${safeArea[side]}px`;
      if (host.style.getPropertyValue(`--bina-safe-${side}`) !== value) host.style.setProperty(`--bina-safe-${side}`, value);
    }
  };
  const measure = () => {
    if (stopped) return;
    const area = getAppArea().getBoundingClientRect();
    const next = safeAreaOf(area, fallback.hidden ? frames().map(frame => ({ slot: frame.getAttribute("data-bina-reserve") ?? "", box: frame.getBoundingClientRect() })) : [],
      { device: deviceInsets(insets), fullscreen: view.fullscreen === true });
    const changed = next.top !== safeArea.top || next.right !== safeArea.right || next.bottom !== safeArea.bottom || next.left !== safeArea.left;
    safeArea = next;
    for (const host of safeTargets()) writeSafeArea(host);
    if (changed) system?.setSafeArea?.(safeArea);
  };
  // 枠の大きさや出入りが変わったら測り直す。ResizeObserver の無い環境では DOM 操作と画面の大きさの変化だけで測る
  const window = document.defaultView;
  const resizes = window && "ResizeObserver" in window ? new (window as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver(() => measure()) : undefined;
  const observed = new Set<Element>();
  const observe = () => {
    if (!resizes) return;
    const next = new Set<Element>([cadreHost, ...frames()]);
    for (const node of observed) if (!next.has(node)) { resizes.unobserve(node); observed.delete(node); }
    for (const node of next) if (!observed.has(node)) { resizes.observe(node); observed.add(node); }
  };
  const onResize = () => measure();
  window?.addEventListener("resize", onResize);

  const setPage = () => system?.setPage({ visible: document.visibilityState === "visible", frozen });
  const freeze = () => { frozen = true; setPage(); };
  const resume = () => { frozen = false; setPage(); };
  document.addEventListener("visibilitychange", setPage);
  document.addEventListener("freeze", freeze);
  document.addEventListener("resume", resume);

  const ui: ShellUi = {
    bind(value) { if (!stopped) { system = value; system.setInstallState?.(live.installed, live.busy); system.setSafeArea?.(safeArea); setPage(); } },
    install() { void live.install(); },
    confirmInstall: request => confirm.confirm(request),
    confirmNet: request => netConfirm.confirm(request),
    openUrl: request => openUrl.show(request),
    present(instance, process) {
      if (instance.cadre) {
        cadreMounted?.stop();
        cadreHost.replaceChildren();
        const mounted = mountApp(cadreHost, instance.app.html, process, {
          apps: instance.apps,
          css: instance.app.css,
          onError: error => ui.report(error),
          onDom: () => { ui.update(view); observe(); measure(); },
          isolateAppArea: true,
        });
        cadreMounted = mounted;
        const remove = () => {
          mounted.stop();
          cadreHost.replaceChildren();
          if (cadreMounted === mounted) cadreMounted = undefined;
        };
        return { remove };
      }
      const host = document.createElement("div");
      host.className = "bina-shell-app";
      host.classList.toggle("bina-shell-content", !instance.home);
      host.hidden = view.front !== instance.id;
      writeSafeArea(host);
      const targetArea = getAppArea();
      targetArea.append(host);
      const mounted = mountApp(host, instance.app.html, process, { apps: instance.apps, css: instance.app.css, onError: error => ui.report(error) });
      const remove = () => { mounted.stop(); host.remove(); hosts.delete(instance.id); };
      hosts.set(instance.id, { host, stop: remove });
      return { remove };
    },
    update(next) {
      if (stopped) return;
      if (next.clearError) status.hidden = true;
      progress.hidden = !next.rebuilding;
      view = next;
      const front = next.front;
      const useFallback = next.cadreUnavailable === true;
      fallback.hidden = !useFallback;
      cadreHost.hidden = useFallback;
      const fullscreen = next.fullscreen === true && !useFallback;
      root.classList.toggle("bina-shell-fullscreen", fullscreen);
      edge.setFullscreen(fullscreen);

      const targetArea = getAppArea();
      live.setAppArea(targetArea);
      for (const [id, entry] of hosts) {
        if (entry.host.parentElement !== targetArea) targetArea.append(entry.host);
        entry.host.hidden = id !== front;
      }
      appsHost.hidden = front !== "apps";
      if (front === "apps") {
        if (appsHost.parentElement !== targetArea) targetArea.append(appsHost);
        if (!appsHost.hasChildNodes()) {
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
      }
      measure();
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
      stopped = true;
      system = undefined;
      cadreMounted?.stop();
      cadreMounted = undefined;
      for (const entry of hosts.values()) entry.stop();
      document.removeEventListener("visibilitychange", setPage);
      document.removeEventListener("freeze", freeze);
      document.removeEventListener("resume", resume);
      live.stop();
      confirm.stop();
      netConfirm.stop();
      openUrl.stop();
      edge.stop();
      resizes?.disconnect();
      window?.removeEventListener("resize", onResize);
      root.remove();
    },
  };
  ui.update(view);
  return ui;
}

/** システムと表示をつなぐ */
export async function mountShell(element: HTMLElement, options: ShellOptions): Promise<MountedShell> {
  const previous = [...element.childNodes];
  const ui = createShellUi(element, options);
  try {
    const system = await startSystem({ ...options, ui });
    ui.bind(system);
    return { requireInstall: ui.requireInstall, stop() { system.stop(); ui.stop(); } };
  } catch (error) {
    ui.stop();
    element.replaceChildren(...previous);
    throw error;
  }
}
