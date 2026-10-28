import { startSystem, type SystemOptions, type SystemUi, type SystemView, type BinetteSystem } from "@binette/regie";
import { type BuildOptions, buildApp } from "./build.ts";
import { mountApp } from "./mount.ts";
import { mountLiveMode } from "./live.ts";

/** 表示の設定 */
export interface ShellUiOptions {
  installed?: boolean;
  onError?: (error: unknown) => void;
}
/** 枠の設定 */
export interface ShellOptions extends Omit<SystemOptions, "ui">, BuildOptions, ShellUiOptions {}
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
:where(.bina-shell) { display: flex; flex-direction: column; flex: 1; min-height: 0; height: 100%; font: inherit; isolation: isolate; }
:where(.bina-shell) [hidden] { display: none; }
:where(.bina-shell-stage) { position: relative; display: flex; flex-direction: column; flex: 1; min-height: 0; isolation: isolate; }
:where(.bina-shell-live) { position: absolute; z-index: 2147483647; pointer-events: none; right: max(var(--bina-shell-padding, 12px), env(safe-area-inset-right, 0px)); bottom: max(var(--bina-shell-padding, 12px), env(safe-area-inset-bottom, 0px)); color: var(--bina-shell-live-color, var(--bina-shell-color, #16181d)); opacity: var(--bina-shell-live-opacity, 0.35); font-size: var(--bina-shell-live-size, 0.875em); }
:where(.bina-shell-install) { margin-inline-start: auto; }
:where(.bina-shell-install-dialog) { z-index: 2147483647; max-width: min(28rem, 80vw); padding: var(--bina-shell-padding, 12px); border: 1px solid var(--bina-shell-border, #d5dae1); border-radius: var(--bina-shell-radius, 12px); background: var(--bina-shell-surface, #fff); color: var(--bina-shell-color, #16181d); font: inherit; overflow-wrap: anywhere; }
:where(.bina-shell-homebar) { display: flex; flex-wrap: wrap; flex-shrink: 0; margin-top: auto; gap: var(--bina-shell-gap, 8px); padding: var(--bina-shell-padding, 12px); padding-bottom: max(var(--bina-shell-padding, 12px), env(safe-area-inset-bottom, 0px)); padding-left: max(var(--bina-shell-padding, 12px), env(safe-area-inset-left, 0px)); padding-right: max(var(--bina-shell-padding, 12px), env(safe-area-inset-right, 0px)); border-top: 1px solid var(--bina-shell-border, #d5dae1); background: var(--bina-shell-background, #f3f5f8); color: var(--bina-shell-color, #16181d); }
:where(.bina-shell-button) { font: inherit; color: inherit; cursor: pointer; border: 1px solid var(--bina-shell-border, #d5dae1); background: var(--bina-shell-surface, #fff); border-radius: var(--bina-shell-radius, 12px); padding: var(--bina-shell-button-padding, 12px); }
:where(.bina-shell-button):focus-visible { outline: 2px solid var(--bina-shell-focus, #3273b9); outline-offset: 2px; }
:where(.bina-shell-entry) { display: inline-flex; gap: var(--bina-shell-gap, 8px); }
:where(.bina-shell-button)[aria-pressed="true"] { border-color: var(--bina-shell-focus, #3273b9); }
:where(.bina-shell-app) { display: flex; flex-direction: column; flex: 1; min-height: 0; }
:where(.bina-shell-apps) { display: flex; flex-direction: column; align-items: flex-start; flex: 1; min-height: 0; gap: var(--bina-shell-gap, 8px); padding: var(--bina-shell-padding, 12px); background: var(--bina-shell-background, #f3f5f8); color: var(--bina-shell-color, #16181d); }
:where(.bina-shell-apps-link) { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; padding: 0; text-align: start; text-decoration: underline; overflow-wrap: anywhere; }
:where(.bina-shell-apps-link):focus-visible { outline: 2px solid var(--bina-shell-focus, #3273b9); outline-offset: 2px; }
:where(.bina-shell-status) { color: var(--bina-shell-error, #b3261e); }
`;

/** システムの状態を描き、ボタンとページの知らせを渡す */
export function createShellUi(element: HTMLElement, options: ShellUiOptions = {}): ShellUi {
  const document = element.ownerDocument;
  const root = document.createElement("div");
  root.className = "bina-shell";
  const style = document.createElement("style");
  style.textContent = css;
  const toolbar = document.createElement("nav");
  toolbar.className = "bina-shell-homebar";
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
  const live = mountLiveMode(stage, options.installed);
  root.append(style, stage, toolbar);
  element.replaceChildren(root);
  let system: BinetteSystem | undefined;
  let stopped = false;
  let frozen = false;
  let front: SystemView["front"];
  const hosts = new Map<number, { host: HTMLElement; stop(): void }>();
  const reported = new WeakSet<object>();
  const button = (text: string, label: string, action: () => void) => {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "bina-shell-button";
    node.textContent = text;
    node.setAttribute("aria-label", label);
    node.addEventListener("click", action);
    return node;
  };
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
      host.hidden = front !== instance.id;
      stage.insertBefore(host, status);
      const mounted = mountApp(host, instance.app.html, process, { apps: instance.apps, onError: error => ui.report(error) });
      const remove = () => { mounted.stop(); host.remove(); hosts.delete(instance.id); };
      hosts.set(instance.id, { host, stop: remove });
      return { remove };
    },
    update(view) {
      if (stopped) return;
      if (typeof view.front === "number") status.hidden = true;
      front = view.front;
      for (const [id, entry] of hosts) entry.host.hidden = id !== front;
      appsHost.hidden = front !== "apps";
      if (front === "apps" && !appsHost.hasChildNodes()) {
        for (const app of view.apps) {
          const link = button(app.name, `${app.name}を開く`, () => { void system?.open(app.key); });
          link.className = "bina-shell-apps-link";
          appsHost.append(link);
        }
      }
      toolbar.replaceChildren(button("ホーム", "ホームを開く", () => { void system?.openHome(); }));
      toolbar.setAttribute("aria-label", "ホームバー");
      for (const instance of view.instances) {
        if (instance.home || instance.closing) continue;
        const entry = document.createElement("span");
        entry.className = "bina-shell-entry";
        const open = button(instance.name, `${instance.name}を開く`, () => { void system?.open(instance.key); });
        open.setAttribute("aria-pressed", String(front === instance.id));
        entry.append(open, button("×", `${instance.name}を閉じる`, () => { void system?.close(instance.id); }));
        toolbar.append(entry);
      }
      toolbar.append(live.button);
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
      for (const entry of hosts.values()) entry.stop();
      document.removeEventListener("visibilitychange", setPage);
      document.removeEventListener("freeze", freeze);
      document.removeEventListener("resume", resume);
      live.stop();
      root.remove();
    },
  };
  ui.update({ instances: [], front: undefined, apps: [] });
  return ui;
}

/** システムと表示をつなぎ、ホームを開く */
export async function mountShell(element: HTMLElement, options: ShellOptions): Promise<MountedShell> {
  const ui = createShellUi(element, options);
  try {
    const system = await startSystem({ ...options, ui, build: options.build ?? (read => buildApp(read, options)) });
    ui.bind(system);
    await system.openHome();
    return { requireInstall: ui.requireInstall, stop() { system.stop(); ui.stop(); } };
  } catch (error) { ui.stop(); throw error; }
}
