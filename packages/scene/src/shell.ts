import { parseAppManifest } from "@binette/core";
import { type AppStore, type InstalledApp, installedAppKey } from "@binette/regie";
import { type BuildOptions, buildApp } from "./build.ts";
import { parseBindings } from "./bindings.ts";
import { iconPath } from "./paths.ts";
import { type MountedApp, type MountOptions, mountApp } from "./mount.ts";

import type { PrebuiltApp } from "./prebuilt.ts";

/** 枠で開くアプリ。read は開発用 */
export type ShellApp = { source: string } & (
  | { read: (path: string) => Promise<string>; prebuilt?: never }
  | { prebuilt: PrebuiltApp; read?: never }
);

/** 枠の設定 */
export interface ShellOptions extends BuildOptions, Pick<MountOptions, "onError" | "createWorker"> {
  apps: ShellApp[];
  store: AppStore;
}

/** 描画した枠 */
export interface MountedShell {
  /** 起動中のアプリを止め、イベントと画面を消す */
  stop(): void;
}

const css = `
:where(.bina-shell) { display: flex; flex-direction: column; flex: 1; min-height: 0; height: 100%; font: inherit; }
:where(.bina-shell) [hidden] { display: none; }
:where(.bina-shell-toolbar) { padding: var(--bina-shell-padding, 12px); background: var(--bina-shell-background, #f3f5f8); color: var(--bina-shell-color, #16181d); }
:where(.bina-shell-back) { font: inherit; color: inherit; cursor: pointer; border: 1px solid var(--bina-shell-border, #d5dae1); background: var(--bina-shell-surface, #fff); border-radius: var(--bina-shell-radius, 12px); padding: var(--bina-shell-button-padding, 12px); }
:where(.bina-shell-back):focus-visible { outline: 2px solid var(--bina-shell-focus, #3273b9); outline-offset: 2px; }
:where(.bina-shell-app) { display: flex; flex-direction: column; flex: 1; min-height: 0; }
:where(.bina-shell-status) { color: var(--bina-shell-error, #b3261e); }
`;

/** 保存したシステムのホームを開き、アプリの起動と戻る帯を受け持つ */
export async function mountShell(element: HTMLElement, options: ShellOptions): Promise<MountedShell> {
  const document = element.ownerDocument;
  const parser = options.parser ?? {
    parseFromString(html: string): Document {
      const parsed = document.implementation.createHTMLDocument("");
      parsed.documentElement.innerHTML = html;
      return parsed;
    },
  };
  const root = document.createElement("div");
  root.className = "bina-shell";
  const style = document.createElement("style");
  style.textContent = css;
  const toolbar = document.createElement("div");
  toolbar.className = "bina-shell-toolbar";
  toolbar.hidden = true;
  const back = document.createElement("button");
  back.className = "bina-shell-back";
  back.type = "button";
  back.textContent = "戻る";
  toolbar.append(back);
  const status = document.createElement("p");
  status.className = "bina-shell-status";
  status.setAttribute("role", "status");
  status.hidden = true;
  root.append(style, toolbar, status);
  element.replaceChildren(root);
  let stopped = false;
  let active: { controller: AbortController; mounted?: MountedApp; host: HTMLElement; home: boolean } | undefined;
  const reported = new WeakSet<object>();
  const report = (error: unknown) => {
    status.textContent = error instanceof Error ? error.message : String(error);
    status.hidden = false;
    if (typeof error === "object" && error !== null) {
      if (reported.has(error)) return;
      reported.add(error);
    }
    options.onError?.(error);
  };
  const leave = () => {
    const previous = active;
    active = undefined;
    previous?.controller.abort();
    previous?.mounted?.stop();
    previous?.host.remove();
  };
  const installedApps: InstalledApp[] = [];
  const seen = new Set<string>();
  for (const app of options.apps) {
    try {
      const text = app.prebuilt === undefined ? await app.read("app.json") : undefined;
      const manifest = app.prebuilt?.manifest ?? parseAppManifest(text!);
      const key = installedAppKey(app.source, manifest.id);
      if (seen.has(key)) continue;
      let installed = await options.store.get(key);
      if (app.prebuilt !== undefined) {
        // ビルドが要らないので毎回入れ直す。版を上げ忘れた OS の更新でも古いものを残さない。入れた日時は最初のものを保つ
        const { html, icon, wasm } = app.prebuilt;
        installed = { key, source: app.source, manifest, icon, html, wasm, installedAt: installed?.installedAt ?? Date.now() };
        await options.store.put(installed);
      } else if (!installed || installed.manifest.version !== manifest.version) {
        const path = iconPath(manifest.icon);
        // app.json は最初に読んだものを使う
        const built = await buildApp((path) => path === "app.json" ? Promise.resolve(text!) : app.read(path), { ...options, parser });
        const icon = path === undefined ? undefined : await app.read(path);
        installed = { key, source: app.source, manifest: built.manifest, icon, html: built.html, wasm: built.wasm, installedAt: Date.now() };
        await options.store.put(installed);
      }
      installedApps.push(installed);
      seen.add(key);
    } catch (error) { report(error); }
  }
  const isHome = (app: InstalledApp) => app.source === "binette:system" && app.manifest.role === "home";
  const home = installedApps.find(isHome);
  const apps = installedApps.filter((app) => !isHome(app));
  const show = async (installed: InstalledApp, atHome: boolean, clearStatus = true): Promise<void> => {
    if (stopped) return;
    leave();
    const host = document.createElement("div");
    host.className = "bina-shell-app";
    host.classList.toggle("bina-shell-content", !atHome);
    const session = { controller: new AbortController(), host, home: atHome, mounted: undefined as MountedApp | undefined };
    active = session;
    toolbar.hidden = atHome;
    if (clearStatus) status.hidden = true;
    root.insertBefore(host, status);
    if (!atHome) back.focus();
    try {
      const mounted = await mountApp(host, { ...installed, bindings: parseBindings(installed.html, parser) }, {
        createWorker: options.createWorker,
        signal: session.controller.signal,
        onError: (error) => { if (active === session) report(error); },
        ...(atHome ? {
          apps: apps.map(({ manifest, icon }) => ({ id: manifest.id, name: manifest.name, icon })),
          onOpen(i: number) {
            if (active !== session || !Number.isInteger(i) || !apps[i]) return;
            void show(apps[i]!, false);
          },
        } : {}),
      });
      if (active !== session) mounted.stop();
      else session.mounted = mounted;
    } catch (error) {
      if (active !== session) return;
      leave();
      if (!atHome && home) await show(home, true);
      report(error);
    }
  };
  const goBack = () => { if (!stopped && active && !active.home && home) void show(home, true); };
  back.addEventListener("click", goBack);
  if (home) await show(home, true, false);
  else report(new Error("ホームのシステムアプリがありません。"));
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      leave();
      back.removeEventListener("click", goBack);
      root.remove();
    },
  };
}
