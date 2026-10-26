import { parseAppManifest } from "@binette/core";
import { type AppStore, type InstalledApp, installedAppKey } from "@binette/regie";
import { type BuildOptions, buildApp } from "./build.ts";
import { parseBindings } from "./bindings.ts";
import { iconPath } from "./paths.ts";
import { type MountedApp, type MountOptions, mountApp } from "./mount.ts";

import type { PrebuiltApp } from "./prebuilt.ts";

/** ホームに並べるアプリ。read は開発用 */
export type HomeApp = { source: string } & (
  | { read: (path: string) => Promise<string>; prebuilt?: never }
  | { prebuilt: PrebuiltApp; read?: never }
);

/** ホームの設定 */
export interface HomeOptions extends BuildOptions, Pick<MountOptions, "onError" | "createWorker"> {
  apps: HomeApp[];
  store: AppStore;
}

/** 描画したホーム */
export interface MountedHome {
  /** 起動中のアプリを止め、イベントと画面を消す */
  stop(): void;
}

const css = `
:where(.bina-home) {
  box-sizing: border-box; display: flex; flex-direction: column; flex: 1; min-height: 0; height: 100%;
  background: var(--bina-home-background, #f3f5f8); color: var(--bina-home-color, #16181d);
  padding: var(--bina-home-padding, 16px); font: inherit;
}
:where(.bina-home) [hidden] { display: none; }
:where(.bina-home-grid) {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--bina-home-tile-size, 112px)), 1fr));
  gap: var(--bina-home-gap, 16px); align-content: start;
}
:where(.bina-home-tile, .bina-home-back) {
  font: inherit; color: inherit; cursor: pointer; border: 1px solid var(--bina-home-border, #d5dae1);
  background: var(--bina-home-surface, #ffffff); border-radius: var(--bina-home-radius, 12px);
  padding: var(--bina-home-button-padding, 12px);
}
:where(.bina-home-tile) { display: flex; flex-direction: column; align-items: center; gap: var(--bina-home-gap, 16px); overflow-wrap: anywhere; }
:where(.bina-home-icon) { width: var(--bina-home-icon-size, 56px); height: var(--bina-home-icon-size, 56px); object-fit: contain; }
:where(.bina-home-tile, .bina-home-back):focus-visible { outline: 2px solid var(--bina-home-focus, #3273b9); outline-offset: 2px; }
:where(.bina-home-view) { display: flex; flex-direction: column; flex: 1; min-height: 0; gap: var(--bina-home-gap, 16px); }
:where(.bina-home-toolbar) { flex: none; }
:where(.bina-home-app) { flex: 1; min-height: 0; background: var(--bina-home-surface, #ffffff); }
:where(.bina-home-status) { color: var(--bina-home-error, #b3261e); }
`;

/** 同じ入手元・ID・版のビルド結果を使い、1 つずつ開けるホームを描く */
export async function mountHome(element: HTMLElement, options: HomeOptions): Promise<MountedHome> {
  const document = element.ownerDocument;
  const parser = options.parser ?? {
    parseFromString(html: string): Document {
      const parsed = document.implementation.createHTMLDocument("");
      parsed.documentElement.innerHTML = html;
      return parsed;
    },
  };
  const root = document.createElement("div");
  root.className = "bina-home";
  const style = document.createElement("style");
  style.textContent = css;
  const grid = document.createElement("div");
  grid.className = "bina-home-grid";
  grid.setAttribute("aria-label", "アプリ");
  const view = document.createElement("div");
  view.className = "bina-home-view";
  view.hidden = true;
  const toolbar = document.createElement("div");
  toolbar.className = "bina-home-toolbar";
  const back = document.createElement("button");
  back.className = "bina-home-back";
  back.type = "button";
  back.textContent = "戻る";
  toolbar.append(back);
  view.append(toolbar);
  const status = document.createElement("p");
  status.className = "bina-home-status";
  status.setAttribute("role", "status");
  status.hidden = true;
  root.append(style, grid, view, status);
  element.replaceChildren(root);

  let stopped = false;
  let active: { controller: AbortController; mounted?: MountedApp; host: HTMLElement; trigger: HTMLButtonElement } | undefined;
  const listeners: (() => void)[] = [];
  const reported = new WeakSet<object>();
  const report = (error: unknown) => {
    if (typeof error === "object" && error !== null) {
      if (reported.has(error)) return;
      reported.add(error);
    }
    status.textContent = error instanceof Error ? error.message : String(error);
    status.hidden = false;
    options.onError?.(error);
  };
  const leave = () => {
    const previous = active;
    active = undefined;
    previous?.controller.abort();
    previous?.mounted?.stop();
    previous?.host.replaceChildren();
    previous?.host.remove();
    view.hidden = true;
    grid.hidden = false;
    if (!stopped) previous?.trigger.focus();
  };
  const open = async (installed: InstalledApp, trigger: HTMLButtonElement) => {
    if (stopped || active) return;
    const host = document.createElement("div");
    host.className = "bina-home-app";
    const session = { controller: new AbortController(), host, trigger, mounted: undefined as MountedApp | undefined };
    active = session;
    grid.hidden = true;
    view.hidden = false;
    status.hidden = true;
    view.append(host);
    back.focus();
    try {
      const mounted = await mountApp(host, { ...installed, bindings: parseBindings(installed.html, parser) }, {
        createWorker: options.createWorker,
        signal: session.controller.signal,
        onError: (error) => { if (active === session) report(error); },
      });
      // 戻る・停止と起動完了が重なっても残さない
      if (active !== session) mounted.stop();
      else session.mounted = mounted;
    } catch (error) {
      if (active === session) { leave(); report(error); }
    }
  };
  back.addEventListener("click", leave);
  listeners.push(() => back.removeEventListener("click", leave));

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
      const saved = installed;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "bina-home-tile";
      if (saved.icon !== undefined) {
        const icon = document.createElement("img");
        icon.className = "bina-home-icon";
        icon.alt = "";
        icon.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(saved.icon)}`;
        button.append(icon);
      }
      const name = document.createElement("span");
      name.textContent = saved.manifest.name;
      button.append(name);
      const click = () => { void open(saved, button); };
      button.addEventListener("click", click);
      listeners.push(() => button.removeEventListener("click", click));
      grid.append(button);
      seen.add(key);
    } catch (error) {
      // 1 つ失敗しても残りを並べる
      report(error);
    }
  }

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      leave();
      for (const remove of listeners) remove();
      root.remove();
    },
  };
}
