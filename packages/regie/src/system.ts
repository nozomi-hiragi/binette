import { DestroyCause, DestroyKind, parseAppManifest } from "@binette/core";
import type { BuildOptions } from "./build.ts";
import { iconPath } from "./paths.ts";
import { startProcess, type Process, type ProcessOptions } from "./process.ts";
import { type AppStore, type InstalledApp, installedAppKey, DEFAULT_SYSTEM_SETTINGS, type SystemSettings, validateSystemSettings } from "./store.ts";

/** システムにインストールするアプリ。read は開発用 */
export type SystemApp = { source: string } & (
  | { read: (path: string) => Promise<string>; prebuilt?: never }
  | { prebuilt: Pick<InstalledApp, "manifest" | "html" | "wasm"> & { icon?: string }; read?: never }
);

/** システムの設定 */
export interface SystemOptions extends Pick<ProcessOptions, "createWorker" | "callTimeout" | "stopDelay" | "destroyTimeout">, BuildOptions {
  apps: SystemApp[];
  store: AppStore;
  ui: SystemUi;
  homeRetryWindow?: number;
  stackSize?: number;
  historyLimit?: number;
}

/** システムが見せ方を受け持つ側に頼むこと */
export interface SystemUi {
  present(instance: { id: number; app: InstalledApp; home: boolean; apps?: { id: string; name: string; icon?: string }[] }, process: Process): { remove(): void };
  update(view: SystemView): void;
  report(error: unknown): void;
}

/** ホームバーと前面と Apps に見せる状態 */
export interface SystemView {
  instances: { id: number; key: string; name: string; home: boolean; closing: boolean }[];
  front: number | "apps" | undefined;
  apps: { key: string; name: string }[];
  clearError: boolean;
}

/** 起動したシステム */
export interface BinetteSystem {
  openHome(): Promise<void>;
  open(key: string): Promise<void>;
  close(id: number): Promise<void>;
  setPage(page: { visible: boolean; frozen: boolean }): void;
  stop(): void;
}

const HOME_RESTART_FIRST = 100;
const HOME_RESTART_MAX = 1000;

/** インストールと設定とホームの選択を済ませる。ホームは openHome で開く */
export async function startSystem(options: SystemOptions): Promise<BinetteSystem> {
  const settings = { ...DEFAULT_SYSTEM_SETTINGS };
  for (const key of ["stackSize", "historyLimit", "callTimeout", "stopDelay", "destroyTimeout", "homeRetryWindow"] as const) {
    if (options[key] !== undefined) settings[key] = options[key];
  }
  Object.assign(settings, await options.store.system.getSettings());
  validateSystemSettings(settings);
  const page = crypto.randomUUID();
  let frozen = false;
  let visible = true;
  let nextId = 0;
  let openedHome = false;
  let appsShown = false;
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
  type Session = { controller: AbortController; mounted?: Process; view?: { remove(): void }; id: number; installed: InstalledApp; home: boolean; finish: boolean; closing: boolean; closed?: Promise<void>; lastShown: number; startedAt?: number };
  let shown = 0;
  const sessions = new Set<Session>();
  let active: Session | undefined;
  let hiding: Session | undefined;
  const report = (error: unknown) => {
    if (stopped) return;
    options.ui.report(error);
  };
  const cut = (session: Session) => {
    if (active === session) active = undefined;
    session.controller.abort();
    session.mounted?.stop();
    session.view?.remove();
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
        const { buildApp } = await import("./build.ts");
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
  function renderBar(clearError = false) {
    options.ui.update({
      instances: [...sessions].map(s => ({ id: s.id, key: s.installed.key, name: s.installed.manifest.name, home: s.home, closing: s.closing })),
      front: appsShown ? "apps" : active === hiding ? undefined : active?.id,
      apps: [...apps].sort((a, b) => a.manifest.name < b.manifest.name ? -1 : a.manifest.name > b.manifest.name ? 1 : 0).map(app => ({ key: app.key, name: app.manifest.name })),
      clearError,
    });
  }
  function showApps() {
    if (stopped) return;
    clearTimeout(restartTimer);
    generation++;
    homeUnavailable = true;
    appsShown = true;
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
    if (wasActive) active = undefined;
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
      hiding = previous;
      renderBar();
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
    appsShown = false;
    hiding = undefined;
    if (session) {
      active = session;
      session.lastShown = ++shown;
      renderBar(clearStatus);
      try {
        if (visible && !frozen) await session.mounted!.resume();
      } catch { /* 終了通知が片付ける */ }
      return;
    }
    session = { controller: new AbortController(), id: ++nextId, installed, home: atHome, finish: false, closing: false, lastShown: ++shown };
    const started = session;
    sessions.add(started);
    active = started;
    renderBar(clearStatus);
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
      started.view = options.ui.present({ id: started.id, app: installed, home: atHome,
        apps: atHome ? apps.map(({ manifest, icon }) => ({ id: manifest.id, name: manifest.name, icon })) : undefined,
      }, mounted);
      renderBar();
      await mounted.begin();
      if (!sessions.has(started) || stopped) { mounted.stop(); started.view.remove(); return; }
      started.mounted = mounted;
      mounted.setStopDelay(settings.stopDelay);
      started.startedAt = performance.now();
      mounted.setFrozen(frozen);
      if (started.closing) { cut(started); return; }
      if (started.finish) await close(started, DestroyKind.User, DestroyCause.App);
      else {
        if (active !== started || !visible || frozen) await mounted.pause();
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
  renderBar();
  if (!home) report(new Error("ホームのシステムアプリがありません。"));
  return {
    async openHome() {
      if (!home) return;
      if (homeUnavailable) { homeUnavailable = false; resetHomeFailures(); }
      const clearStatus = openedHome;
      openedHome = true;
      await show(home, true, clearStatus);
    },
    async open(key) {
      const app = apps.find(app => app.key === key);
      if (app) await show(app, false);
    },
    async close(id) {
      const session = [...sessions].find(session => session.id === id);
      if (session) await close(session, DestroyKind.User, DestroyCause.Os);
    },
    setPage(page) {
      if (stopped) return;
      visible = page.visible;
      if (frozen !== page.frozen) {
        frozen = page.frozen;
        for (const session of sessions) session.mounted?.setFrozen(frozen);
      }
      const mounted = active?.mounted;
      if (mounted) void (visible && !frozen ? mounted.resume() : mounted.pause()).catch(() => {});
    },
    stop() {
      if (stopped) return;
      stopped = true;
      generation++;
      clearTimeout(restartTimer);
      for (const session of sessions) cut(session);
    },
  };
}
