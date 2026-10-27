import { parseAppManifest } from "@binette/core";
import { type AppStore, type InstalledApp, installedAppKey } from "@binette/regie";
import { type BuildOptions, buildApp } from "./build.ts";
import { iconPath } from "./paths.ts";
import { DestroyCause, DestroyKind, type MountedApp, type MountOptions, mountApp } from "./mount.ts";

import type { PrebuiltApp } from "./prebuilt.ts";

/** 枠で開くアプリ。read は開発用 */
export type ShellApp = { source: string } & (
  | { read: (path: string) => Promise<string>; prebuilt?: never }
  | { prebuilt: PrebuiltApp; read?: never }
);

/** 枠の設定 */
export interface ShellOptions extends BuildOptions, Pick<MountOptions, "onError" | "createWorker" | "callTimeout" | "stopDelay" | "destroyTimeout"> {
  apps: ShellApp[];
  store: AppStore;
  /** 最初の落ちからこの時間（ミリ秒、既定 5000）を過ぎてもホームが落ちるなら、開き直すのをやめる */
  homeRetryWindow?: number;
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
  const page = crypto.randomUUID();
  let frozen = false;
  let generation = 0;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  const homeRetryWindow = options.homeRetryWindow ?? 5000;
  let homeStartedAt = 0;
  let homeFailingSince: number | undefined;
  /** ホームが落ちたときに開き直してよいか。落ち続けて homeRetryWindow を過ぎたら開き直さない */
  const mayRestartHome = () => {
    const now = performance.now();
    // 前のホームが homeRetryWindow より長く動いていたなら、落ち続けてはいない
    if (homeFailingSince === undefined || now - homeStartedAt >= homeRetryWindow) homeFailingSince = now;
    return now - homeFailingSince < homeRetryWindow;
  };
  let stopped = false;
  type Session = { controller: AbortController; mounted?: MountedApp; host: HTMLElement; home: boolean; finish: boolean };
  const sessions = new Set<Session>();
  let active: Session | undefined;
  const reported = new WeakSet<object>();
  const report = (error: unknown) => {
    if (stopped) return;
    status.textContent = error instanceof Error ? error.message : String(error);
    status.hidden = false;
    if (typeof error === "object" && error !== null) {
      if (reported.has(error)) return;
      reported.add(error);
    }
    options.onError?.(error);
  };
  const cut = (session: Session) => {
    if (active === session) active = undefined;
    session.controller.abort();
    session.mounted?.stop();
    session.host.remove();
    sessions.delete(session);
  };
  const leave = async (kind: DestroyKind, cause: DestroyCause) => {
    const previous = active;
    active = undefined;
    if (!previous) return;
    try { await previous.mounted?.destroy(kind, cause); }
    catch (error) { return error; }
    finally { cut(previous); }
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
        const built = await buildApp((path) => path === "app.json" ? Promise.resolve(text!) : app.read(path), options);
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
  const show = async (installed: InstalledApp, atHome: boolean, clearStatus = true, kind = DestroyKind.System, cause = DestroyCause.Stack): Promise<void> => {
    if (stopped) return;
    clearTimeout(restartTimer);
    const current = ++generation;
    const exitError = await leave(kind, cause);
    if (stopped || current !== generation) return;
    if (exitError !== undefined) {
      report(exitError);
      if (home) { installed = home; atHome = true; }
      clearStatus = false;
    }
    const host = document.createElement("div");
    host.className = "bina-shell-app";
    host.classList.toggle("bina-shell-content", !atHome);
    const session = { controller: new AbortController(), host, home: atHome, mounted: undefined as MountedApp | undefined, finish: false };
    sessions.add(session);
    active = session;
    if (atHome) homeStartedAt = performance.now();
    toolbar.hidden = atHome;
    if (clearStatus) status.hidden = true;
    root.insertBefore(host, status);
    if (!atHome) back.focus();
    try {
      const mounted = await mountApp(host, installed, {
        createWorker: options.createWorker,
        callTimeout: options.callTimeout,
        stopDelay: options.stopDelay,
        destroyTimeout: options.destroyTimeout,
        page,
        signal: session.controller.signal,
        onError: (error) => { if (active === session) report(error); },
        async onExit(error) {
          if (active !== session) return;
          cut(session);
          // 落ち続けるホームは開き直さず、エラーを出したままにする（④ でここに Apps を出す）
          if (home && (!atHome || mayRestartHome())) await show(home, true);
          report(error);
        },
        onFinish() {
          if (active !== session) return;
          session.finish = true;
          if (session.mounted && home) void show(home, true, true, DestroyKind.User, DestroyCause.App);
        },
        ...(atHome ? {
          apps: apps.map(({ manifest, icon }) => ({ id: manifest.id, name: manifest.name, icon })),
          onOpen(i: number) {
            if (active !== session || !Number.isInteger(i) || !apps[i]) return;
            void show(apps[i]!, false);
          },
        } : {}),
      });
      if (active !== session) mounted.stop();
      else {
        session.mounted = mounted;
        mounted.setFrozen(frozen);
        if (session.finish && home) void show(home, true, true, DestroyKind.User, DestroyCause.App);
        else if (document.visibilityState === "hidden") await mounted.pause();
      }
    } catch (error) {
      if (active !== session) return;
      cut(session);
      if (!atHome && home) await show(home, true);
      report(error);
      // 落ち続けるホームは開き直さず、エラーを出したままにする（④ でここに Apps を出す）
      if (atHome && home && !stopped && current === generation && mayRestartHome()) {
        // 起動に失敗したホームも開き直す。stop を受け取れるよう、次のタスクに回す
        restartTimer = setTimeout(() => {
          if (!stopped && current === generation) void show(home, true, false);
        }, 0);
      }
    }
  };
  const goBack = () => { if (!stopped && active && !active.home && home) void show(home, true); };
  const updateVisibility = () => {
    const mounted = active?.mounted;
    if (!mounted) return;
    const action = document.visibilityState === "visible" ? mounted.resume() : mounted.pause();
    // Régie の終了通知が、エラーとホームへの復帰を受け持つ
    void action.catch(() => {});
  };
  const freeze = () => { frozen = true; active?.mounted?.setFrozen(true); };
  const resume = () => { frozen = false; active?.mounted?.setFrozen(false); updateVisibility(); };
  back.addEventListener("click", goBack);
  document.addEventListener("visibilitychange", updateVisibility);
  document.addEventListener("freeze", freeze);
  document.addEventListener("resume", resume);
  if (home) await show(home, true, false);
  else report(new Error("ホームのシステムアプリがありません。"));
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      generation++;
      clearTimeout(restartTimer);
      for (const session of sessions) cut(session);
      document.removeEventListener("visibilitychange", updateVisibility);
      document.removeEventListener("freeze", freeze);
      document.removeEventListener("resume", resume);
      back.removeEventListener("click", goBack);
      root.remove();
    },
  };
}
