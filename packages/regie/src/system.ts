import { createProviderLists, type ProviderLists, type ProviderListsOptions } from "./lists.ts";
import { normalizeAppIdentifier, DestroyCause, DestroyKind, parseAppManifest } from "@binette/core";
import type { BuildOptions } from "./build.ts";
import type { BrowserBuildOptions } from "./browser-build.ts";
import { iconPath } from "./paths.ts";
import { startProcess, type Process, type ProcessOptions } from "./process.ts";
import type { ApiDenial, CadreSnapshot, PigeonLetter, PigeonSend } from "./launch.ts";
import { type AppStore, type InstalledApp, appId, DEFAULT_SYSTEM_SETTINGS, type SystemSettings, validateSystemSettings } from "./store.ts";

/** システムにインストールするアプリ。read は開発用 */
export type SystemApp = { source: string } & (
  | { read: (path: string) => Promise<string>; prebuilt?: never }
  | { prebuilt: Pick<InstalledApp, "manifest" | "html" | "wasm"> & { icon?: string; css?: string; subIcons?: Record<string, string> }; read?: never }
);

/** システムの設定 */
export interface SystemOptions extends Pick<ProcessOptions, "workerUrl" | "createWorker" | "callTimeout" | "stopDelay" | "destroyTimeout">, BuildOptions {
  apps: SystemApp[];
  /** boot.json の提供リスト */
  lists?: string[];
  providerLists?: Pick<ProviderListsOptions, "fetch" | "parseHtml" | "fetchTimeout">;
  /** 指定するとソースのビルドを検証済みコンパイラの Worker で行う。 */
  browserBuild?: BrowserBuildOptions;
  /** 役割の既定の割り当て（役割 → appId）。設定で変えていない役割に使う。省略すると入手元が `binette:system` の最初のもの */
  roles?: Record<string, string>;
  /** 新しい版の `/system` があるとき、設定アプリの「更新」で入れ替える処理 */
  update?: {
    apply(): Promise<void>;
    check?(): Promise<void>;
    openRecovery?(): void;
    snapshot?(): { phase: string; current: string; next: string; available: boolean };
    subscribe?(listener: () => void): () => void;
  };
  store: AppStore;
  ui: SystemUi;
  homeRetryWindow?: number;
  stackSize?: number;
  historyLimit?: number;
}

/** システムが見せ方を受け持つ側に頼むこと */
export interface SystemUi {
  present(instance: { id: number; app: InstalledApp; home: boolean; cadre?: boolean; apps?: { id: string; name: string; icon?: string }[] }, process: Process): { remove(): void };
  update(view: SystemView): void;
  report(error: unknown): void;
  install?(): void;
}

/** ホームバーと前面と Apps に見せる状態 */
export interface SystemView {
  /** icon はアプリの SVG の文字列。ホームバーのアイコンに使う。無いアプリは undefined */
  instances: { id: number; key: string; name: string; icon?: string; home: boolean; closing: boolean }[];
  front: number | "apps" | undefined;
  apps: { key: string; name: string }[];
  clearError: boolean;
  /** Cadre が落ち続けてフォールバック UI を描くべきか */
  cadreUnavailable?: boolean;
}

/** 起動したシステム */
export interface BinetteSystem {
  readonly lists: ProviderLists;
  openHome(): Promise<void>;
  open(key: string): Promise<void>;
  close(id: number): Promise<void>;
  setPage(page: { visible: boolean; frozen: boolean }): void;
  setInstallState?(installed: boolean, busy: boolean): void;
  stop(): void;
}

/**
 * API の辞書のキーごとの届け先。roles は割り当てを受けた役割のどれか、permission は app.json の permissions に書く権限。
 * どちらも無いキーはすべてのアプリに届く。権限を許す流れは未決なので、permission のキーは今は誰にも届かない。
 */
const API_RULES: Record<string, { roles?: string[]; permission?: string }> = {
  apps: { roles: ["home", "cadre"] },
  os: { roles: ["settings"] },
  storage: {},
  fs: { permission: "fs" },
  cadre: { roles: ["cadre"] },
  pigeon: {},
  shares: {},
};
/** 設定アプリで割り当てを変えられる役割。設定アプリ自体は固定 */
const ASSIGNABLE_ROLES = ["home", "cadre", "files"];
const SYSTEM_SOURCE = "binette:system";

const HOME_RESTART_FIRST = 100;
const HOME_RESTART_MAX = 1000;

/** インストールと設定とホームの選択を済ませる。ホームは openHome で開く */
export async function startSystem(options: SystemOptions): Promise<BinetteSystem> {
  const settings = { ...DEFAULT_SYSTEM_SETTINGS, roles: {} as Record<string, string> };
  for (const key of ["stackSize", "historyLimit", "callTimeout", "stopDelay", "destroyTimeout", "homeRetryWindow"] as const) {
    if (options[key] !== undefined) settings[key] = options[key];
  }
  const stored = await options.store.system.getSettings();
  validateSystemSettings(stored ?? {});
  Object.assign(settings, stored, { roles: { ...stored?.roles } });
  const bootRoles = { ...options.roles };
  const page = crypto.randomUUID();
  let frozen = false;
  let visible = true;
  let installed = false;
  let installBusy = false;
  let nextId = 0;
  let openedHome = false;
  let appsShown = false;
  let generation = 0;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let homeFailingSince: number | undefined;
  let homeUnavailable = false;
  let cadreSession: Session | undefined;
  let cadreFailingSince: number | undefined;
  let cadreRestartDelay = HOME_RESTART_FIRST;
  let cadreRestartTimer: ReturnType<typeof setTimeout> | undefined;
  let cadreUnavailable = false;
  const mayRestartCadre = (startedAt?: number) => {
    const now = performance.now();
    if (cadreFailingSince === undefined || (startedAt !== undefined && now - startedAt >= settings.homeRetryWindow)) {
      cadreFailingSince = now;
      cadreRestartDelay = HOME_RESTART_FIRST;
    }
    return now - cadreFailingSince < settings.homeRetryWindow;
  };
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
  let changingApps = false;
  type Session = { controller: AbortController; starting?: Promise<Process>; mounted?: Process; view?: { remove(): void }; id: number; installed: InstalledApp; home: boolean; finish: boolean; closing: boolean; closed?: Promise<void>; lastShown: number; startedAt?: number };
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
  const cutCadre = () => {
    if (!cadreSession) return;
    const session = cadreSession;
    cadreSession = undefined;
    session.controller.abort();
    session.mounted?.stop();
    session.view?.remove();
    renderBar();
  };
  const installedApps: InstalledApp[] = [];
  const seen = new Set<string>();
  const attempted = new Set<string>();
  for (const app of options.apps) {
    try {
      const text = app.prebuilt === undefined ? await app.read("app.json") : undefined;
      const manifest = app.prebuilt?.manifest ?? parseAppManifest(text!);
      const key = appId(app.source, manifest.id);
      if (seen.has(key)) continue;
      attempted.add(key);
      let installed = await options.store.get(key);
      if (app.prebuilt !== undefined) {
        // ビルドが要らないので毎回入れ直す。版を上げ忘れた OS の更新でも古いものを残さない。入れた日時は最初のものを保つ
        const { html, css, icon, wasm } = app.prebuilt;
        installed = { key, source: app.source, manifest, icon, html, ...(css === undefined ? {} : { css }), wasm, installedAt: installed?.installedAt ?? Date.now() };
        await options.store.put(installed);
      } else if (!installed || installed.manifest.version !== manifest.version) {
        const path = iconPath(manifest.icon);
        // app.json は最初に読んだものを使う
        const read = (path: string) => path === "app.json" ? Promise.resolve(text!) : app.read(path);
        const built = options.browserBuild
          ? await (await import("./browser-build.ts")).buildAppInWorker(read, { libraries: options.libraries, ...options.browserBuild })
          : await (await import("./build.ts")).buildApp(read, options);
        const icon = path === undefined ? undefined : await app.read(path);
        installed = { key, source: app.source, manifest: built.manifest, icon, html: built.html, ...(built.css === undefined ? {} : { css: built.css }), wasm: built.wasm, installedAt: Date.now() };
        await options.store.put(installed);
      }
      // サブアプリのアイコンも親の配布物から読み、親と同じ記録に保存する。
      const subIcons: Record<string, string> = { ...app.prebuilt?.subIcons };
      if (app.prebuilt === undefined) {
        for (const [id, sub] of Object.entries(installed.manifest.sub ?? {})) {
          const path = iconPath(sub.icon);
          if (path !== undefined) subIcons[id] = await app.read(path);
        }
      }
      if (Object.keys(subIcons).length) {
        installed = { ...installed, subIcons };
        await options.store.put(installed);
      }
      installedApps.push(installed);
      seen.add(key);
    } catch (error) { report(error); }
  }
  let changing = async (_source: string, _id?: string) => {};
  let changed = async () => {};
  const lists = await createProviderLists({
    store: options.store, lists: options.lists, browserBuild: options.browserBuild,
    ...options.providerLists, report,
    changing: (source, id) => changing(source, id),
    async changed(move) {
      if (move) for (const [role, key] of Object.entries(bootRoles)) {
        if (key.startsWith(`${move.from}#`)) bootRoles[role] = move.to + key.slice(move.from.length);
      }
      Object.assign(settings, await options.store.system.getSettings());
      await changed();
    },
  });
  for (const registration of await lists.list()) if (registration.boot) for (const [role, key] of Object.entries(bootRoles)) {
    if (key.startsWith(`${registration.boot}#`)) bootRoles[role] = registration.url + key.slice(registration.boot.length);
  }
  // ホーム候補は、今回渡されたアプリ以外も含めて保存先から探す
  const available = new Map(installedApps.map(app => [app.key, app]));
  for (const app of await options.store.list()) if (!available.has(app.key)) available.set(app.key, app);
  // 親のバイナリ・権限を使う独立した起動口。保存するのは親の成果物だけ。
  const entries = (parent: InstalledApp): InstalledApp[] => [parent, ...Object.entries(parent.manifest.sub ?? {}).map(([id, sub]) => ({
    ...parent,
    key: `${parent.key}.${normalizeAppIdentifier(id)}`,
    parentKey: parent.key,
    sub: normalizeAppIdentifier(id),
    listed: sub.listed ?? true,
    icon: parent.subIcons?.[id],
    manifest: { ...parent.manifest, id: `${parent.manifest.id}.${normalizeAppIdentifier(id)}`, name: sub.name, icon: sub.icon, roles: sub.roles, sub: undefined },
  }))];
  const parents = [...available.values()];
  for (const parent of parents) for (const entry of entries(parent).slice(1)) {
    if (available.has(entry.key)) throw new Error(`アプリの ID が重複しています: ${entry.key}`);
    available.set(entry.key, entry);
  }
  // 役割の割り当ては 2 段。名乗った（manifest.roles）アプリが候補になり、設定、ブートの既定、入手元が system の順で選ぶ
  const holders = (role: string) => [...available.values()].filter(app => app.manifest.roles?.includes(role));
  const candidates = (role: string) => ASSIGNABLE_ROLES.includes(role) ? holders(role) : [];
  const assign = (role: string): InstalledApp | undefined => {
    const list = role === "settings" ? holders(role).filter(app => app.source === SYSTEM_SOURCE) : holders(role);
    const chosen = role === "settings" ? undefined : settings.roles[role];
    return list.find(app => app.key === chosen) ?? list.find(app => app.key === bootRoles[role]) ?? list.find(app => app.source === SYSTEM_SOURCE);
  };
  const assigned: Record<string, InstalledApp | undefined> = { home: assign("home"), settings: assign("settings"), cadre: assign("cadre"), files: assign("files") };
  let home = assigned.home;
  let cadre = assigned.cadre;
  const apps = [...installedApps, ...parents.filter(app => !attempted.has(app.key) && app.source !== SYSTEM_SOURCE && app.source !== "binette:bundled")].flatMap(entries).filter(app => app.listed !== false && !app.manifest.roles?.includes("home") && !app.manifest.roles?.includes("cadre"));
  const updateAvailable = options.update !== undefined;
  let saving = Promise.resolve();
  const saveSettings = () => {
    const copy = { ...settings, roles: { ...settings.roles } };
    saving = saving.then(() => options.store.system.putSettings(copy)).catch(report);
  };
  const setSetting = (name: string, value: number) => {
    if (stopped || changingApps || !["stackSize", "stopDelay", "callTimeout", "destroyTimeout", "historyLimit", "homeRetryWindow"].includes(name)) return;
    const key = name as Exclude<keyof SystemSettings, "roles" | "allowHttpLists">;
    try {
      validateSystemSettings({ [key]: value });
      if (!Number.isInteger(value) || ((key === "callTimeout" || key === "destroyTimeout") && value < 1000)) return;
    } catch { return; }
    settings[key] = value;
    if (key === "stopDelay") for (const session of sessions) session.mounted?.setStopDelay(value);
    saveSettings();
  };
  /** 設定アプリが、役割に割り当てるアプリを候補の番号で選ぶ */
  const selectRole = async (role: string, i: number) => {
    const list = candidates(role);
    if (stopped || changingApps || !Number.isInteger(i) || !list[i]) return;
    if (role === "cadre") {
      const previous = cadre;
      cadre = assigned.cadre = list[i]!;
      settings.roles.cadre = cadre.key;
      saveSettings();
      if (previous?.key !== cadre.key || cadreUnavailable) {
        clearTimeout(cadreRestartTimer);
        cadreFailingSince = undefined;
        cadreRestartDelay = HOME_RESTART_FIRST;
        cadreUnavailable = false;
        cutCadre();
        await startCadre();
      }
      return;
    }
    if (role === "files") {
      assigned.files = list[i]!;
      settings.roles.files = list[i]!.key;
      saveSettings();
      return;
    }
    const previous = home;
    home = assigned.home = list[i]!;
    settings.roles.home = home.key;
    saveSettings();
    resetHomeFailures();
    homeUnavailable = false;
    clearTimeout(restartTimer);
    if (previous?.key !== home.key) {
      for (const session of [...sessions]) if (session.installed.key === previous?.key) await close(session, DestroyKind.User, DestroyCause.Os);
    }
    renderBar();
  };
  /** アプリに届く辞書のキーと、届かないキーの理由 */
  const apiOf = (installed: InstalledApp) => {
    const keys = new Set<string>();
    const denied: Record<string, ApiDenial> = {};
    for (const [key, rule] of Object.entries(API_RULES)) {
      if (rule.roles) {
        if (rule.roles.some(role => assigned[role]?.key === installed.key)) keys.add(key);
        else denied[key] = "NotAssigned";
      } else if (rule.permission) denied[key] = "NotGranted";
      else keys.add(key);
    }
    return { keys, denied };
  };
  /** 設定アプリの起動時に渡す OS の写し */
  const muted = new Map<string, boolean>();
  for (const app of available.values()) muted.set(app.key, await options.store.pigeon.muted(app.parentKey ?? app.key));
  let nextLetter = 0;
  const notifications: PigeonLetter[] = [];
  const canNotify = (app: InstalledApp) => Object.hasOwn(app.manifest.permissions ?? {}, "notify");
  const pigeonSnapshot = async (app: InstalledApp) => ({ letters: await options.store.pigeon.read(app.key), notify: canNotify(app) });
  const syncInbox = async (key: string) => {
    const app = available.get(key);
    if (!app || stopped) return;
    const snapshot = await pigeonSnapshot(app);
    for (const session of [...sessions, ...(cadreSession ? [cadreSession] : [])]) if (session.installed.key === key) session.mounted?.syncPigeon?.(snapshot);
  };
  const routePigeon = (sender: InstalledApp, request: PigeonSend) => {
    if (stopped || (request.to === "user" && (!canNotify(sender) || muted.get(sender.key)))) return;
    const target = request.to === "user" ? undefined : available.get(request.to);
    if (request.to !== "user" && !target) return;
    if (!Array.isArray(request.shares ?? []) || (request.to === "user" && request.shares?.length) || request.shares?.some(share => !share || typeof share.id !== "string" || !["read", "write"].includes(share.access))) return;
    const letter: PigeonLetter = { ...structuredClone(request), from: sender.key, id: ++nextLetter };
    if (request.to === "user") { notifications.push(letter); if (notifications.length > 100) notifications.shift(); renderBar(); return; }
    saving = saving.then(async () => {
      const deliver = () => options.store.pigeon.append(request.to, letter);
      if (request.shares?.length) await options.store.shares.inviteSharesWithDelivery(sender.key, request.to, request.shares, deliver);
      else await deliver();
      await syncInbox(request.to);
      if (request.urgent && target && !stopped) void show(target, target.key === home?.key).catch(report);
    }).catch(report);
  };
  const shareRequest = (app: InstalledApp, operation: string, args: string[]) => {
    const execute = async () => {
      if (!apiOf(app).keys.has("shares") || !Array.isArray(args) || args.some(arg => typeof arg !== "string")) throw new Error("共有の要求が不正です。");
      const shares = options.store.shares;
      const required: Record<string, number> = { create: 1, list: 0, join: 1, leave: 1, read: 2, write: 3, readBase64: 2, writeBase64: 3, remove: 2, files: 2, fileInfo: 2, ownList: 1, ownRead: 1, ownWrite: 2, ownRemove: 1, ownMove: 2, ownShareOn: 2, ownShareOff: 1, ownReference: 3, sharedRename: 3, sharedDelete: 2, folderRename: 2, folderLeave: 1, sharedFolderRename: 3, sharedFolderDelete: 2, shareMove: 4, estimate: 0, export: 2, pickReply: 3 };
      if (required[operation] === undefined || args.length !== required[operation]) throw new Error("共有の引数が不正です。");
      const [id, path, value] = args;
      const filerOperations = ["ownList", "ownRead", "ownWrite", "ownRemove", "ownMove", "ownShareOn", "ownShareOff", "ownReference", "sharedRename", "sharedDelete", "folderRename", "folderLeave", "sharedFolderRename", "sharedFolderDelete", "shareMove", "estimate", "export", "pickReply"];
      if (filerOperations.includes(operation) && (app.key !== assigned.files?.key || app.source !== "binette:bundled")) throw new Error("Filer の操作は許可されていません。");
      const ownPath = (path: string) => { if (!path.startsWith("/data/filer/") && path !== "/data/filer") throw new Error("ファイルのパスが不正です。"); return path; };
      const backend = options.store.fileStorage;
      const owner = async () => await backend.appOwner(app.parentKey ?? app.key, app.source, app.manifest.name);
      const base64 = (bytes: Uint8Array) => { let result = ""; for (const byte of bytes) result += String.fromCharCode(byte); return btoa(result); };
      switch (operation) {
        case "ownList": return (await backend.filerShareList(app.key, await owner(), ownPath(id))).map(({ path, row }) => ({ ...row, path, ...( "share" in row ? { share: row.share, sharePath: row.path } : {}), modified: new Date(row.modified).toLocaleDateString("ja-JP") }));
        case "ownShareOn": return await backend.filerShareOn(app.key, await owner(), ownPath(id), path);
        case "ownShareOff": await backend.filerShareOff(app.key, await owner(), ownPath(id)); return;
        case "ownReference": await backend.filerShareReference(app.key, await owner(), ownPath(id), path, value); return;
        case "sharedRename": await backend.filerShareRename(app.key, await owner(), id, path, value); return;
        case "sharedDelete": await backend.filerShareDelete(app.key, await owner(), id, path); return;
        case "folderRename": await backend.filerShareFolderRename(app.key, await owner(), id, path); return;
        case "folderLeave": await backend.filerShareFolderLeave(app.key, await owner(), id); return;
        case "sharedFolderRename": await backend.filerShareSubfolderRename(app.key, await owner(), id, path, value); return;
        case "sharedFolderDelete": await backend.filerShareSubfolderDelete(app.key, await owner(), id, path); return;
        case "ownRead": { const bytes = await backend.forOwner(await owner()).read(ownPath(id)); return bytes === undefined ? null : base64(bytes); }
        case "ownWrite": await backend.forOwner(await owner()).write(ownPath(id), Uint8Array.from(atob(path), c => c.charCodeAt(0))); return;
        case "ownRemove": await backend.forOwner(await owner()).delete(ownPath(id)); return;
        case "ownMove": await backend.forOwner(await owner()).move(ownPath(id), ownPath(path)); return;
        case "shareMove": await backend.moveShareFile(id, app.key, await owner(), ownPath(path), value, args[3] === "true"); return;
        case "estimate": return await navigator.storage.estimate();
        case "export": { const bytes = Uint8Array.from(atob(path), c => c.charCodeAt(0)); const url = URL.createObjectURL(new Blob([bytes])); const a = document.createElement("a"); a.href = url; a.download = id; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return; }
        case "pickReply": { if (!available.has(id)) throw new Error("宛先がありません。"); const share = await shares.getShare(path); const access = share?.members[id]?.state === "joined" ? share.members[id].access : "write"; if (share?.members[id]?.state !== "joined") { await shares.inviteShare(path, app.key, id, "write"); await shares.joinShare(path, id); } await options.store.pigeon.append(id, { id: ++nextLetter, from: app.key, to: id, kind: "pick.reply", title: "", body: JSON.stringify({ id: path, path: value }), shares: [{ id: path, access }] }); await syncInbox(id); return; }
        case "create": return await shares.createShare(app.key, id);
        case "list": { const list = await shares.listShares(app.key); return app.key === assigned.files?.key && app.source === "binette:bundled" ? list.map(share => ({ ...share, filerState: share.members[app.key]?.state, filerIsCreator: share.creator === app.key, creatorName: share.members[app.key]?.label ?? available.get(share.creator)?.manifest.name ?? share.creator })) : list; }
        case "join": await shares.joinShare(id, app.key); return;
        case "leave": await shares.leaveShare(id, app.key); return;
        case "read": { const bytes = await shares.shareFiles(id, app.key).read(path); return bytes === undefined ? null : new TextDecoder().decode(bytes); }
        case "readBase64": { const bytes = await shares.shareFiles(id, app.key).read(path); if (bytes === undefined) return null; let encoded = ""; for (const byte of bytes) encoded += String.fromCharCode(byte); return btoa(encoded); }
        case "writeBase64": { const encoded = atob(value); await shares.shareFiles(id, app.key).write(path, Uint8Array.from(encoded, char => char.charCodeAt(0))); return; }
        case "write": await shares.shareFiles(id, app.key).write(path, new TextEncoder().encode(value)); return;
        case "remove": await shares.shareFiles(id, app.key).delete(path); return;
        case "files": return await shares.shareFiles(id, app.key).list(path);
        case "fileInfo": { const metadata = await shares.shareFiles(id, app.key).metadata(path); return metadata ? { ...metadata, modified: new Date(metadata.modified).toLocaleDateString("ja-JP") } : null; }
        default: throw new Error("共有の操作が不明です。");
      }
    };
    const pending = saving.then(execute);
    saving = pending.then(() => {}, () => {});
    return pending;
  };
  const donePigeon = (app: InstalledApp, id: number) => {
    saving = saving.then(async () => { await options.store.pigeon.done(app.key, id); }).catch(report);
  };
  const dismissNotification = (id: number) => {
    const i = notifications.findIndex(letter => letter.id === id);
    if (i >= 0) { notifications.splice(i, 1); renderBar(); }
  };
  const osSnapshot = (launches: { time: number; name: string }[]) => {
    const { roles: _roles, allowHttpLists: _allowHttpLists, ...numeric } = settings;
    return {
      settings: numeric,
      notifications: [...available.values()].filter(canNotify).map(app => ({ id: app.key, name: app.manifest.name, muted: muted.get(app.key) ?? false })),
      roles: Object.fromEntries(Object.entries(assigned).flatMap(([role, app]) => app ? [[role, app.key]] : [])),
      candidates: Object.fromEntries(ASSIGNABLE_ROLES.map(role => [role, candidates(role).map(app => ({ id: app.key, name: app.manifest.name }))])),
      launches,
      updateAvailable: options.update?.snapshot?.().available ?? updateAvailable,
      updateState: options.update?.snapshot?.(),
    };
  };
  const cadreSnapshot = (): CadreSnapshot => {
    const instances = [...sessions].filter(s => !s.home && !s.closing).map(s => ({
      id: s.id,
      appIndex: apps.findIndex(app => app.key === s.installed.key),
      name: s.installed.manifest.name,
      front: active === s,
      hasIcon: s.installed.icon !== undefined,
    }));
    const homeFront = active !== undefined && active.home;
    return { instances, homeFront, installed, installBusy, notifications: structuredClone(notifications) };
  };

  function renderBar(clearError = false) {
    const snapshot = cadreSnapshot();
    cadreSession?.mounted?.syncCadre?.(snapshot);
    options.ui.update({
      instances: [...sessions].map(s => ({ id: s.id, key: s.installed.key, name: s.installed.manifest.name, icon: s.installed.icon, home: s.home, closing: s.closing })),
      front: appsShown ? "apps" : active === hiding ? undefined : active?.id,
      apps: [...apps].sort((a, b) => a.manifest.name < b.manifest.name ? -1 : a.manifest.name > b.manifest.name ? 1 : 0).map(app => ({ key: app.key, name: app.manifest.name })),
      clearError,
      cadreUnavailable: cadreUnavailable || !cadre,
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
    if (stopped || changingApps) return;
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
      const api = apiOf(installed);
      const launches = api.keys.has("os") ? (await options.store.system.listLaunches()).reverse().map(record => ({
        time: record.time, name: available.get(record.app)?.manifest.name ?? record.app,
      })) : [];
      if (!sessions.has(started) || stopped) return;
      // アプリごとのデータの読み込みに失敗したら、storage だけ載せない
      // 前の起動で積んだ書き込みを待ってから読む（古いスナップショットを渡さない）
      const storage = api.keys.has("storage") ? await saving.then(() => options.store.data.read(installed.parentKey ?? installed.key)).catch(() => undefined) : undefined;
      if (api.keys.has("storage") && !storage) { api.keys.delete("storage"); api.denied.storage = "NotGranted"; }
      if (!sessions.has(started) || stopped) return;
      const pigeon = await saving.then(() => pigeonSnapshot(installed));
      const updateAtStart = options.update?.snapshot?.();
      const mounting = startProcess(installed.wasm, {
        sub: installed.sub,
        declarative: installed.manifest.entry.html === undefined,
        createWorker: options.createWorker,
        workerUrl: options.workerUrl,
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
        grants: {
          denied: api.denied,
          pigeon,
          shares: api.keys.has("shares"),
          ...(api.keys.has("apps") ? { apps: apps.map(({ key, manifest, icon }) => ({ id: key, name: manifest.name, icon })) } : {}),
          ...(api.keys.has("os") ? { os: osSnapshot(launches) } : {}),
          ...(storage ? { storage } : {}),
        },
        onOpen(i: number) {
          if (!api.keys.has("apps") || active !== started || !Number.isInteger(i) || !apps[i]) return;
          void show(apps[i]!, false);
        },
        onShare(operation, args) { return shareRequest(installed, operation, args); },
        onPigeonSend(letter) { routePigeon(installed, letter); },
        onPigeonDone(id) { donePigeon(installed, id); },
        onNotificationMuted(i, value) {
          if (!api.keys.has("os")) return;
          const target = osSnapshot([]).notifications[i];
          if (!target) return;
          const owner = available.get(target.id)?.parentKey ?? target.id;
          for (const app of available.values()) if ((app.parentKey ?? app.key) === owner) muted.set(app.key, value);
          saving = saving.then(() => options.store.pigeon.mute(owner, value)).catch(report);
          if (value) for (const letter of [...notifications]) if (muted.get(letter.from)) dismissNotification(letter.id);
          for (const session of sessions) if (apiOf(session.installed).keys.has("os")) session.mounted?.syncOs?.(osSnapshot([]));
        },
        onSet(name: string, value: number) { if (api.keys.has("os")) setSetting(name, value); },
        onAssign(role: string, i: number) { if (api.keys.has("os")) void selectRole(role, i).catch(report); },
        onOpenRecovery() { if (api.keys.has("os")) options.update?.openRecovery?.(); },
        onCheckUpdate() { if (api.keys.has("os")) void options.update?.check?.().catch(report); },
        onUpdate() { if (api.keys.has("os")) void options.update?.apply().catch(report); },
        onStorage(name: string, value: string | null) {
          if (!api.keys.has("storage")) return;
          saving = saving.then(() => options.store.data.write(installed.parentKey ?? installed.key, name, value)).catch(report);
        },
      });
      started.starting = mounting;
      const mounted = await mounting;
      if (!sessions.has(started) || stopped) { mounted.stop(); return; }
      started.view = options.ui.present({ id: started.id, app: installed, home: atHome,
        apps: api.keys.has("apps") ? apps.map(({ key, manifest, icon }) => ({ id: key, name: manifest.name, icon })) : undefined,
      }, mounted);
      renderBar();
      await mounted.begin();
      if (!sessions.has(started) || stopped) { mounted.stop(); started.view.remove(); return; }
      started.mounted = mounted;
      await saving;
      const latestPigeon = await pigeonSnapshot(installed);
      if (JSON.stringify(latestPigeon) !== JSON.stringify(pigeon)) mounted.syncPigeon?.(latestPigeon);
      if (api.keys.has("os") && JSON.stringify(updateAtStart) !== JSON.stringify(options.update?.snapshot?.())) mounted.syncOs?.(osSnapshot(launches));
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
  const openHome = async () => {
    if (!home) return;
    if (homeUnavailable) { homeUnavailable = false; resetHomeFailures(); }
    const clearStatus = openedHome;
    openedHome = true;
    await show(home, true, clearStatus);
  };
  function restartCadre() {
    const delay = cadreRestartDelay;
    cadreRestartDelay = Math.min(cadreRestartDelay * 2, HOME_RESTART_MAX);
    clearTimeout(cadreRestartTimer);
    cadreRestartTimer = setTimeout(() => {
      if (!stopped && cadre) void startCadre();
    }, delay);
  }
  async function startCadre(): Promise<void> {
    if (changingApps) return;
    if (stopped || !cadre) {
      cadreUnavailable = true;
      renderBar();
      return;
    }
    const selectedCadre = cadre;
    clearTimeout(cadreRestartTimer);
    if (cadreSession) cutCadre();
    const session: Session = { controller: new AbortController(), id: ++nextId, installed: selectedCadre, home: false, finish: false, closing: false, lastShown: ++shown };
    cadreSession = session;
    try {
      const api = apiOf(selectedCadre);
      const storage = api.keys.has("storage") ? await saving.then(() => options.store.data.read(selectedCadre.parentKey ?? selectedCadre.key)).catch(() => undefined) : undefined;
      if (api.keys.has("storage") && !storage) { api.keys.delete("storage"); api.denied.storage = "NotGranted"; }
      if (cadreSession !== session || stopped) return;
      const pigeon = await saving.then(() => pigeonSnapshot(selectedCadre));
      const mounting = startProcess(selectedCadre.wasm, {
        sub: selectedCadre.sub,
        declarative: selectedCadre.manifest.entry.html === undefined,
        createWorker: options.createWorker,
        workerUrl: options.workerUrl,
        callTimeout: settings.callTimeout,
        stopDelay: settings.stopDelay,
        destroyTimeout: settings.destroyTimeout,
        persistence: { store: options.store.system, key: selectedCadre.key, historyLimit: settings.historyLimit },
        page,
        signal: session.controller.signal,
        onError: error => { if (cadreSession === session) report(error); },
        onExit(error) {
          if (cadreSession !== session) return;
          cutCadre();
          report(error);
          if (mayRestartCadre(session.startedAt)) restartCadre();
          else {
            cadreUnavailable = true;
            renderBar();
            void openHome();
          }
        },
        onFinish() {
          if (cadreSession !== session) return;
          cutCadre();
          if (mayRestartCadre(session.startedAt)) restartCadre();
          else {
            cadreUnavailable = true;
            renderBar();
            void openHome();
          }
        },
        grants: {
          denied: api.denied,
          cadre: cadreSnapshot(),
          pigeon,
          shares: api.keys.has("shares"),
          ...(storage ? { storage } : {}),
          ...(api.keys.has("apps") ? { apps: apps.map(({ key, manifest, icon }) => ({ id: key, name: manifest.name, icon })) } : {}),
        },
        onStorage(name, value) {
          if (!api.keys.has("storage")) return;
          saving = saving.then(() => options.store.data.write(selectedCadre.parentKey ?? selectedCadre.key, name, value)).catch(report);
        },
        onShare(operation, args) { return shareRequest(selectedCadre, operation, args); },
        onPigeonSend(letter) { routePigeon(selectedCadre, letter); },
        onPigeonDone(id) { donePigeon(selectedCadre, id); },
        onNotificationDismiss: dismissNotification,
        onNotificationOpen(id) {
          const letter = notifications.find(letter => letter.id === id);
          if (!letter || letter.actions?.length) return;
          const target = available.get(letter.from);
          dismissNotification(id);
          if (target) void show(target, target.key === home?.key).catch(report);
        },
        onNotificationReply(id, action, body) {
          const letter = notifications.find(letter => letter.id === id);
          const button = letter?.actions?.find(button => button.id === action);
          if (!letter || !button) return;
          const reply: PigeonLetter = { id: ++nextLetter, from: "user", to: letter.from, kind: action, title: letter.title, body: button.input ? body : "" };
          saving = saving.then(async () => { await options.store.pigeon.append(reply.to, reply); await syncInbox(reply.to); }).catch(report);
          dismissNotification(id);
        },
        onCadreOpen(id) {
          const target = [...sessions].find(s => s.id === id && !s.home && !s.closing);
          if (target) void show(target.installed, false);
        },
        onCadreClose(id) {
          const target = [...sessions].find(s => s.id === id && !s.home && !s.closing);
          if (target) void close(target, DestroyKind.User, DestroyCause.Os);
        },
        onCadreHome() { void openHome(); },
        onCadreSettings() {
          const target = assigned.settings;
          if (target) void show(target, false);
        },
        onCadreBack() {
          if (active && !active.home) void returnHome();
        },
        onCadreNotify(text) { routePigeon(selectedCadre, { to: "user", kind: "notification", title: "", body: text }); },
        onCadreInstall() { options.ui.install?.(); },
        onOpen(i) {
          if (!api.keys.has("apps") || !Number.isInteger(i) || !apps[i]) return;
          void show(apps[i]!, false);
        },
      });
      session.starting = mounting;
      const mounted = await mounting;
      if (cadreSession !== session || stopped) { mounted.stop(); return; }
      session.view = options.ui.present({
        id: session.id, app: selectedCadre, home: false, cadre: true,
        apps: api.keys.has("apps") ? apps.map(({ key, manifest, icon }) => ({ id: key, name: manifest.name, icon })) : undefined,
      }, mounted);
      await mounted.begin();
      if (cadreSession !== session || stopped) { mounted.stop(); session.view.remove(); return; }
      session.mounted = mounted;
      await saving;
      const latestPigeon = await pigeonSnapshot(selectedCadre);
      if (JSON.stringify(latestPigeon) !== JSON.stringify(pigeon)) mounted.syncPigeon?.(latestPigeon);
      mounted.setStopDelay(settings.stopDelay);
      session.startedAt = performance.now();
      mounted.setFrozen(frozen);
      // 隠れている間に起動し終えた Cadre は、ふつうのアプリと同じく Pause に戻す
      if (!visible || frozen) await mounted.pause().catch(() => {});
      if (cadreSession !== session || stopped) return;
      cadreUnavailable = false;
      renderBar();
    } catch (error) {
      if (cadreSession !== session) return;
      cutCadre();
      report(error);
      if (mayRestartCadre()) restartCadre();
      else {
        cadreUnavailable = true;
        renderBar();
        void openHome();
      }
    }
  }
  // 起動済み Worker の一覧は起動時の写しなので、役割の Worker は保存して起動し直す。
  // 移転元の storage・ライフサイクル書き込みが残らないよう、付け替え前に終了を待つ。
  changing = async (source, id) => {
    changingApps = true;
    for (const session of [...sessions]) if ((session.installed.source === source && (id === undefined || (session.installed.parentKey ?? session.installed.key) === appId(source, id))) || apiOf(session.installed).keys.has("apps")) {
      const process = session.mounted ?? await session.starting?.catch(() => undefined);
      await process?.destroy(DestroyKind.System, DestroyCause.Os).catch(report);
      cut(session);
    }
    if (cadreSession) {
      const process = cadreSession.mounted ?? await cadreSession.starting?.catch(() => undefined);
      await process?.destroy(DestroyKind.System, DestroyCause.Os).catch(report);
      cutCadre();
    }
    clearTimeout(restartTimer);
    clearTimeout(cadreRestartTimer);
    await saving;
  };
  changed = async () => {
    changingApps = false;
    if (stopped) return;
    available.clear();
    for (const app of await options.store.list()) if (app.source !== SYSTEM_SOURCE && app.source !== "binette:bundled") for (const entry of entries(app)) available.set(entry.key, entry);
    // bootAppStore は埋め込みを隠すので、今回の配布物を戻す。
    for (const app of installedApps) if (!available.has(app.key)) for (const entry of entries(app)) available.set(entry.key, entry);
    for (const role of ["home", "settings", "cadre"]) assigned[role] = assign(role);
    home = assigned.home;
    cadre = assigned.cadre;
    apps.splice(0, apps.length, ...[...available.values()].filter(app => app.listed !== false && !app.manifest.roles?.includes("home") && !app.manifest.roles?.includes("cadre")));
    const launches = (await options.store.system.listLaunches()).toReversed().map(record => ({ time: record.time, name: available.get(record.app)?.manifest.name ?? record.app }));
    for (const session of sessions) if (apiOf(session.installed).keys.has("os")) session.mounted?.syncOs?.(osSnapshot(launches));
    renderBar();
    if (cadre) await startCadre();
    if (openedHome && home && !active) await openHome();
  };
  const unsubscribeUpdate = options.update?.subscribe?.(() => {
    for (const session of sessions) if (apiOf(session.installed).keys.has("os")) {
      session.mounted?.syncOs?.(osSnapshot([]));
    }
  });
  renderBar();
  if (!home) report(new Error("ホームのシステムアプリがありません。"));
  if (cadre) {
    await startCadre();
  } else {
    cadreUnavailable = true;
    renderBar();
    await openHome();
  }
  // 呼び出し元の UI の起動完了を待ち、接続失敗も通常のエラーとして届ける。
  const firstCheck = setTimeout(() => { if (!stopped) void lists.check().catch(report); }, 0);
  return {
    lists,
    openHome,
    async open(key) {
      const app = apps.find(app => app.key === key);
      if (app) await show(app, false);
    },
    async close(id) {
      const session = [...sessions].find(session => session.id === id);
      if (session) await close(session, DestroyKind.User, DestroyCause.Os);
    },
    setInstallState(value, busy) {
      if (stopped || (installed === value && installBusy === busy)) return;
      installed = value;
      installBusy = busy;
      renderBar();
    },
    setPage(page) {
      if (stopped) return;
      visible = page.visible;
      if (frozen !== page.frozen) {
        frozen = page.frozen;
        cadreSession?.mounted?.setFrozen(frozen);
        for (const session of sessions) session.mounted?.setFrozen(frozen);
      }
      cadreSession?.mounted && void (visible && !frozen ? cadreSession.mounted.resume() : cadreSession.mounted.pause()).catch(() => {});
      const mounted = active?.mounted;
      if (mounted) void (visible && !frozen ? mounted.resume() : mounted.pause()).catch(() => {});
    },
    stop() {
      if (stopped) return;
      stopped = true;
      unsubscribeUpdate?.();
      clearTimeout(firstCheck);
      lists.stop();
      generation++;
      clearTimeout(restartTimer);
      clearTimeout(cadreRestartTimer);
      cutCadre();
      for (const session of sessions) cut(session);
    },
  };
}
