import { DestroyCause, DestroyKind, parseAppManifest } from "@binette/core";
import { startProcess, type Process, type ProcessOptions, type AppStore, type InstalledApp, installedAppKey, DEFAULT_SYSTEM_SETTINGS, type SystemSettings, validateSystemSettings } from "@binette/regie";
import { type BuildOptions, buildApp } from "./build.ts";
import { iconPath } from "./paths.ts";
import { type MountedApp, mountApp } from "./mount.ts";

import type { PrebuiltApp } from "./prebuilt.ts";
import { mountLiveMode } from "./live.ts";

/** 枠で開くアプリ。read は開発用 */
export type ShellApp = { source: string } & (
  | { read: (path: string) => Promise<string>; prebuilt?: never }
  | { prebuilt: PrebuiltApp; read?: never }
);

/** 枠の設定 */
export interface ShellOptions extends BuildOptions, Pick<ProcessOptions, "onError" | "createWorker" | "callTimeout" | "stopDelay" | "destroyTimeout"> {
  apps: ShellApp[];
  store: AppStore;
  /** 最初の落ちからこの時間（ミリ秒、既定 5000）を過ぎてもホームが落ちるなら、Apps を出す */
  homeRetryWindow?: number;
  /** ホームを含むインスタンスの上限（既定 3、1 以上） */
  stackSize?: number;
  /** 起動の履歴の上限（既定 100） */
  historyLimit?: number;
  /** ページのインストール済み判定を上書きする。指定時は matchMedia を使わない */
  installed?: boolean;
}

/** 描画した枠 */
export interface MountedShell {
  /** インストール済みなら true。ライブモードなら理由と手順を表示して false */
  requireInstall(reason: string): boolean;
  /** 起動中のアプリを止め、イベントと画面を消す */
  stop(): void;
}

/** 落ちたホームを起動し直す前の、最初の待ち（ミリ秒） */
const HOME_RESTART_FIRST = 100;
/** 起動し直す前の待ちの上限（ミリ秒） */
const HOME_RESTART_MAX = 1000;

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

/** 保存したシステムのホームを開き、スタックとホームバーを受け持つ */
export async function mountShell(element: HTMLElement, options: ShellOptions): Promise<MountedShell> {
  const settings = { ...DEFAULT_SYSTEM_SETTINGS };
  for (const key of ["stackSize", "historyLimit", "callTimeout", "stopDelay", "destroyTimeout", "homeRetryWindow"] as const) {
    if (options[key] !== undefined) settings[key] = options[key];
  }
  Object.assign(settings, await options.store.system.getSettings());
  validateSystemSettings(settings);
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
  const page = crypto.randomUUID();
  let frozen = false;
  let generation = 0;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let homeFailingSince: number | undefined;
  let homeUnavailable = false;
  // 落ちたホームを起動し直す前の待ち。落ちるたびに倍にし、HOME_RESTART_MAX で頭打ちにする
  let homeRestartDelay = HOME_RESTART_FIRST;
  const resetHomeFailures = () => {
    homeFailingSince = undefined;
    homeRestartDelay = HOME_RESTART_FIRST;
  };
  /**
   * ホームが落ちたときに開き直してよいか。落ち続けて homeRetryWindow を過ぎたら開き直さない
   * @param startedAt 落ちたホームの起動が済んだ時刻。起動に失敗したなら undefined
   */
  const mayRestartHome = (startedAt?: number) => {
    const now = performance.now();
    // 落ちたホームが起動を済ませて homeRetryWindow より長く動いていたなら、落ち続けてはいない
    if (homeFailingSince === undefined || (startedAt !== undefined && now - startedAt >= settings.homeRetryWindow)) {
      homeFailingSince = now;
      homeRestartDelay = HOME_RESTART_FIRST;
    }
    return now - homeFailingSince < settings.homeRetryWindow;
  };
  let stopped = false;
  type Session = { controller: AbortController; mounted?: Process; view?: MountedApp; host: HTMLElement; installed: InstalledApp; home: boolean; finish: boolean; closing: boolean; closed?: Promise<void>; lastShown: number; startedAt?: number };
  let shown = 0;
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
    session.view?.stop();
    session.host.remove();
    sessions.delete(session);
    renderBar();
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
  // ホーム候補は、今回渡されたアプリ以外も含めて保存先から探す
  const available = new Map(installedApps.map(app => [app.key, app]));
  for (const app of await options.store.list()) if (!available.has(app.key)) available.set(app.key, app);
  const homes = [...available.values()].filter(app => app.manifest.role === "home");
  let home = homes.find(app => app.key === settings.home) ?? homes.find(app => app.source === "binette:system");
  const apps = installedApps.filter(app => app.manifest.role !== "home");
  let saving = Promise.resolve();
  const saveSettings = () => {
    const copy = { ...settings };
    saving = saving.then(() => options.store.system.putSettings(copy)).catch(report);
  };
  const setSetting = (name: string, value: number) => {
    if (stopped || !["stackSize", "stopDelay", "callTimeout", "destroyTimeout", "historyLimit", "homeRetryWindow"].includes(name)) return;
    const key = name as Exclude<keyof SystemSettings, "home">;
    try {
      validateSystemSettings({ [key]: value });
      if (!Number.isInteger(value) || ((key === "callTimeout" || key === "destroyTimeout") && value < 1000)) return;
    } catch { return; }
    settings[key] = value;
    if (key === "stopDelay") for (const session of sessions) session.mounted?.setStopDelay(value);
    saveSettings();
  };
  const selectHome = async (i: number) => {
    if (stopped || !Number.isInteger(i) || !homes[i]) return;
    const previous = home;
    home = homes[i]!;
    settings.home = home.key;
    saveSettings();
    resetHomeFailures();
    homeUnavailable = false;
    clearTimeout(restartTimer);
    if (previous?.key !== home.key) {
      for (const session of [...sessions]) if (session.installed.key === previous?.key) await close(session, DestroyKind.User, DestroyCause.Os);
    }
    renderBar();
  };
  const button = (text: string, label: string, action: () => void) => {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "bina-shell-button";
    node.textContent = text;
    node.setAttribute("aria-label", label);
    node.addEventListener("click", action);
    return node;
  };
  function renderBar() {
    toolbar.replaceChildren(button("ホーム", "ホームを開く", () => {
      if (!home) return;
      if (homeUnavailable) {
        homeUnavailable = false;
        resetHomeFailures();
      }
      void show(home, true);
    }));
    toolbar.setAttribute("aria-label", "ホームバー");
    for (const session of sessions) {
      if (session.home || session.closing) continue;
      const entry = document.createElement("span");
      entry.className = "bina-shell-entry";
      const name = session.installed.manifest.name;
      const open = button(name, `${name}を開く`, () => { void show(session.installed, false); });
      open.setAttribute("aria-pressed", String(active === session));
      entry.append(open, button("×", `${name}を閉じる`, () => { void close(session, DestroyKind.User, DestroyCause.Os); }));
      toolbar.append(entry);
    }
    toolbar.append(live.button);
  }
  function showApps() {
    if (stopped) return;
    clearTimeout(restartTimer);
    generation++;
    homeUnavailable = true;
    if (!appsHost.hasChildNodes()) {
      for (const app of [...apps].sort((a, b) => a.manifest.name < b.manifest.name ? -1 : a.manifest.name > b.manifest.name ? 1 : 0)) {
        const name = app.manifest.name;
        const link = button(name, `${name}を開く`, () => { void show(app, false); });
        link.className = "bina-shell-apps-link";
        appsHost.append(link);
      }
    }
    appsHost.hidden = false;
    renderBar();
  }
  /** 待ってからホームを起動し直す。待つあいだに stop や別の移動があれば起動しない */
  function restartHome(current: number) {
    const delay = homeRestartDelay;
    homeRestartDelay = Math.min(homeRestartDelay * 2, HOME_RESTART_MAX);
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      if (!stopped && current === generation && home) void show(home, true, false);
    }, delay);
  }
  async function returnHome() {
    if (homeUnavailable) showApps();
    else if (home) await show(home, true, false);
  }
  function close(session: Session, kind: DestroyKind, cause: DestroyCause): Promise<void> {
    if (stopped || !sessions.has(session) || session.closing) return session.closed ?? Promise.resolve();
    session.closing = true;
    const wasActive = active === session;
    const current = wasActive ? ++generation : generation;
    if (wasActive) { active = undefined; session.host.hidden = true; }
    renderBar();
    session.closed = (async () => {
      try { await session.mounted?.destroy(kind, cause); }
      catch (error) { report(error); }
      finally { cut(session); }
      if (wasActive && !stopped && current === generation) await returnHome();
    })();
    return session.closed;
  }
  async function trim() {
    while (!stopped && [...sessions].filter(s => !s.closing).length > settings.stackSize) {
      const oldest = [...sessions].filter(s => s !== active && !s.closing).sort((a, b) => a.lastShown - b.lastShown)[0];
      if (!oldest) return;
      await close(oldest, DestroyKind.System, DestroyCause.Stack);
    }
  }
  async function show(installed: InstalledApp, atHome: boolean, clearStatus = true): Promise<void> {
    if (stopped) return;
    if (active?.installed.key === installed.key && !active.mounted) return;
    clearTimeout(restartTimer);
    const current = ++generation;
    const previous = active;
    // 起動の途中で離れる場合は、未完成のインスタンスを残さない
    if (previous && previous.installed.key !== installed.key) {
      previous.host.hidden = true;
      if (previous.mounted) {
        try { await previous.mounted.pause(); }
        catch (error) { report(error); clearStatus = false; }
      } else cut(previous);
      // Pause を待つあいだに別の移動が前面を決めていたら、それを消さない
      if (current === generation && active === previous) active = undefined;
    }
    if (stopped || current !== generation) return;
    // Pause を待つあいだに前のホームが落ちて予約した起動し直しは、この移動で要らなくなる
    clearTimeout(restartTimer);
    // 同じアプリの Destroy が終わる前に次の記録を上書きしない
    const closing = [...sessions].find(s => s.closing && s.installed.key === installed.key);
    if (closing) await closing.closed;
    if (stopped || current !== generation) return;
    let session = [...sessions].find(s => !s.closing && s.installed.key === installed.key);
    if (session && !session.mounted) return;
    appsHost.hidden = true;
    if (clearStatus) status.hidden = true;
    if (session) {
      active = session;
      session.lastShown = ++shown;
      session.host.hidden = false;
      renderBar();
      try {
        if (document.visibilityState === "visible" && !frozen) await session.mounted!.resume();
      } catch { /* 終了通知が片付ける */ }
      return;
    }
    const host = document.createElement("div");
    host.className = "bina-shell-app";
    host.classList.toggle("bina-shell-content", !atHome);
    session = { controller: new AbortController(), host, installed, home: atHome, finish: false, closing: false, lastShown: ++shown };
    const started = session;
    sessions.add(started);
    active = started;
    stage.insertBefore(host, status);
    renderBar();
    try {
      const atSettings = installed.source === "binette:system" && installed.manifest.role === "settings";
      const launches = atSettings ? (await options.store.system.listLaunches()).reverse().map(record => ({
        time: record.time, name: available.get(record.app)?.manifest.name ?? record.app,
      })) : [];
      if (!sessions.has(started) || stopped) return;
      const mounted = await startProcess(installed.wasm, {
        createWorker: options.createWorker,
        callTimeout: settings.callTimeout,
        stopDelay: settings.stopDelay,
        destroyTimeout: settings.destroyTimeout,
        persistence: { store: options.store.system, key: installed.key, historyLimit: settings.historyLimit },
        page,
        signal: started.controller.signal,
        onError: error => { if (sessions.has(started)) report(error); },
        onExit(error) {
          if (!sessions.has(started)) return;
          const wasActive = active === started;
          cut(started);
          if (wasActive && home) {
            if (!atHome) void returnHome().then(() => report(error));
            else if (!mayRestartHome(started.startedAt)) { showApps(); report(error); }
            else { report(error); restartHome(generation); }
          } else report(error);
        },
        onFinish() {
          if (!sessions.has(started)) return;
          started.finish = true;
          if (started.mounted) void close(started, DestroyKind.User, DestroyCause.App);
        },
        ...(atSettings ? {
          grants: { os: { settings: { ...settings, home: home?.key ?? settings.home }, homes: homes.map(app => ({ id: app.key, name: app.manifest.name })), launches } },
          onSet: setSetting,
          onSetHome(i: number) { void selectHome(i).catch(report); },
        } : {}),
        ...(atHome ? {
          grants: { apps: apps.map(({ manifest, icon }) => ({ id: manifest.id, name: manifest.name, icon })) },
          onOpen(i: number) {
            if (active !== started || !Number.isInteger(i) || !apps[i]) return;
            void show(apps[i]!, false);
          },
        } : {}),
      });
      if (!sessions.has(started) || stopped) { mounted.stop(); return; }
      started.view = mountApp(host, installed.html, mounted, {
        apps: atHome ? apps.map(({ manifest, icon }) => ({ id: manifest.id, name: manifest.name, icon })) : undefined,
        onError: error => { if (sessions.has(started)) report(error); },
      });
      await mounted.begin();
      if (!sessions.has(started) || stopped) { mounted.stop(); started.view.stop(); return; }
      started.mounted = mounted;
      mounted.setStopDelay(settings.stopDelay);
      started.startedAt = performance.now();
      mounted.setFrozen(frozen);
      if (started.closing) { cut(started); return; }
      if (started.finish) await close(started, DestroyKind.User, DestroyCause.App);
      else {
        if (active !== started || document.visibilityState === "hidden" || frozen) await mounted.pause();
        await trim();
      }
    } catch (error) {
      if (!sessions.has(started)) return;
      const wasActive = active === started;
      cut(started);
      if (wasActive && !atHome) await returnHome();
      report(error);
      if (wasActive && atHome && home && !stopped && current === generation) {
        if (mayRestartHome()) restartHome(current);
        else showApps();
      }
    }
  }
  const updateVisibility = () => {
    const mounted = active?.mounted;
    if (!mounted) return;
    const action = document.visibilityState === "visible" && !frozen ? mounted.resume() : mounted.pause();
    // Régie の終了通知が、エラーとホームへの復帰を受け持つ
    void action.catch(() => {});
  };
  const freeze = () => { frozen = true; for (const session of sessions) session.mounted?.setFrozen(true); updateVisibility(); };
  const resume = () => { frozen = false; for (const session of sessions) session.mounted?.setFrozen(false); updateVisibility(); };
  renderBar();
  document.addEventListener("visibilitychange", updateVisibility);
  document.addEventListener("freeze", freeze);
  document.addEventListener("resume", resume);
  if (home) await show(home, true, false);
  else report(new Error("ホームのシステムアプリがありません。"));
  return {
    requireInstall: live.requireInstall,
    stop() {
      if (stopped) return;
      stopped = true;
      generation++;
      clearTimeout(restartTimer);
      for (const session of sessions) cut(session);
      document.removeEventListener("visibilitychange", updateVisibility);
      document.removeEventListener("freeze", freeze);
      document.removeEventListener("resume", resume);
      live.stop();
      root.remove();
    },
  };
}
