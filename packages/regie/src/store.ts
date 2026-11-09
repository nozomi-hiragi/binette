import { createMemoryStorage, type ShareStorage, type StorageBackend } from "./storage.ts";
import { createMemoryPigeonStore, createIndexedDbPigeonStore, type PigeonStore } from "./pigeon.ts";
import { appId } from "./app-key.ts";
import type { ScheduleRule, ScheduleRun } from "./scheduler.ts";
export { appId } from "./app-key.ts";
import { normalizeAppIdentifier, parseAppId, type AppManifest } from "@binette/core";
import { appFilePaths, decodeAppPathSegment, encodeAppPathSegment } from "./app-files.ts";
import { createIndexedDbFileTree, createMemoryFileTree, type FileTree, type IndexedDbFileTreeOptions } from "./fs.ts";

/** インストールしたアプリのビルド結果 */
export interface InstalledApp {
  /** アプリの完全な ID */
  key: string;
  source: string;
  /** サブアプリの親の完全な ID。保存領域と権限を共有する */
  parentKey?: string;
  sub?: string;
  listed?: boolean;
  /** サブアプリの識別子から SVG の文字列への写し */
  subIcons?: Record<string, string>;
  manifest: AppManifest;
  /** SVG の文字列。無ければ undefined */
  icon: string | undefined;
  html: string;
  /** `entry.css` の CSS。無ければ undefined */
  css?: string;
  wasm: Uint8Array;
  /** Date.now() の Unix epoch ミリ秒 */
  installedAt: number;
  /** 提供リストの版。manifest.version とは独立して比べる */
  listVersion?: string;
}

/** ビルド結果の保存先 */
export interface AppStore {
  /** 同じ保存先の OS の記録 */
  readonly system: SystemStore;
  readonly pigeon: PigeonStore;
  readonly shares: ShareStorage;
  readonly fileStorage: StorageBackend;
  /** App-owned data below `/data`. */
  readonly data: AppDataStore;
  list(): Promise<InstalledApp[]>;
  get(key: string): Promise<InstalledApp | undefined>;
  put(app: InstalledApp, files?: ReadonlyMap<string, Uint8Array>): Promise<void>;
  /** Change the provider URL while keeping app owners and saved records stable. */
  moveSource(from: string, to: string, lists?: ProviderListRegistration[]): Promise<void>;
}

/** アプリごとのデータ。名前は 1 つの部品で、中身は文字列。アプリの ID は `system` を使えない（OS の記録と同じ場所のため） */
export interface AppDataStore {
  /** 名前から中身への写し */
  read(id: string): Promise<Map<string, string>>;
  /** value が null なら消す */
  write(id: string, name: string, value: string | null): Promise<void>;
}

/** 最後に呼んだライフサイクル。番号は Réplique の enum と共通 */
export interface LifecycleRecord {
  state: number;
  done: boolean;
  page: string;
  reason: { kind: number; cause: number };
}

/** インスタンスを作った日時（Unix epoch ミリ秒）と完全な ID */
export interface LaunchRecord { time: number; app: string }

/** OS の設定。時間はミリ秒 */
export interface SystemSettings {
  /** 役割から割り当てたアプリの完全な ID への写し。空ならブートの既定 */
  roles: Record<string, string>;
  /** 開発用。http: の提供リストを許す。省略時は false */
  allowHttpLists?: boolean;
  stackSize: number;
  stopDelay: number;
  callTimeout: number;
  destroyTimeout: number;
  historyLimit: number;
  homeRetryWindow: number;
}

/** 保存が無いときの OS の既定値 */
export const DEFAULT_SYSTEM_SETTINGS: Readonly<SystemSettings> = Object.freeze({
  roles: {}, allowHttpLists: false, stackSize: 3, stopDelay: 10000, callTimeout: 5000,
  destroyTimeout: 5000, historyLimit: 100, homeRetryWindow: 5000,
});

/** 登録した提供リスト。boot は削除できない既定リストの元の URL */
export interface ProviderListRegistration { url: string; boot?: string }

/** アプリの記録と OS の設定。アプリのキーは完全な ID を使う */
export interface SystemStore {
  getLists(): Promise<ProviderListRegistration[]>;
  putLists(lists: ProviderListRegistration[]): Promise<void>;
  getPermissions(key: string): Promise<string[]>;
  putPermissions(key: string, permissions: string[]): Promise<void>;
  getLast(key: string): Promise<LifecycleRecord | undefined>;
  putLast(key: string, record: LifecycleRecord): Promise<void>;
  listLaunches(): Promise<LaunchRecord[]>;
  recordLaunch(record: LaunchRecord, limit?: number): Promise<void>;
  getSettings(): Promise<Partial<SystemSettings> | undefined>;
  /** 全体を置き換える。省いた項目は ShellOptions または既定値に戻る */
  putSettings(settings: Partial<SystemSettings>): Promise<void>;
  /** 予定の ID から保存した予定への写し。無ければ空 */
  getSchedules(): Promise<Record<string, SavedSchedule>>;
  /** 全体を置き換える */
  putSchedules(schedules: Record<string, SavedSchedule>): Promise<void>;
}

/** スケジューラが保存する予定（[scheduler.md](../../../docs/spec/scheduler.md#予定)） */
export interface SavedSchedule {
  owner: string;
  label?: string;
  rule: ScheduleRule;
  enabled: boolean;
  /** 登録した時刻（Unix epoch ミリ秒） */
  registered: number;
  last?: ScheduleRun;
}

const historySize = (limit: number) => {
  if (!Number.isInteger(limit) || limit < 0) throw new Error("履歴の最大行数は 0 以上の整数にしてください。");
  return limit;
};

/** OS の設定の範囲を確かめる */
export function validateSystemSettings(settings: Partial<SystemSettings>): void {
  for (const [key, value] of Object.entries(settings)) {
    if (key === "roles") {
      if (typeof value !== "object" || value === null || Array.isArray(value) || !Object.values(value).every(app => typeof app === "string")) {
        throw new Error("roles は役割からアプリへの文字列の写しにしてください。");
      }
    } else if (key === "allowHttpLists") {
      if (typeof value !== "boolean") throw new Error("allowHttpLists は真偽値にしてください。");
    } else if (!["stackSize", "stopDelay", "callTimeout", "destroyTimeout", "historyLimit", "homeRetryWindow"].includes(key) ||
      typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
      ((key === "stackSize" || key === "historyLimit") && !Number.isInteger(value)) ||
      (key === "stackSize" && value < 1)) {
      throw new Error(`OS の設定が範囲外です: ${key}`);
    }
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const encode = (value: unknown): Uint8Array => encoder.encode(JSON.stringify(value));
const decode = <T>(value: Uint8Array | undefined): T | undefined =>
  value === undefined ? undefined : JSON.parse(decoder.decode(value)) as T;
const launchesPath = "/data/system/launches.json";
const listsPath = "/data/system/lists.json";
const permissionsPath = (key: string) => `/data/system/permissions/${encodeURIComponent(key)}.json`;
const settingsPath = "/data/system/settings.json";
const schedulesPath = "/data/system/schedules.json";
const dataDirectory = (id: string) => {
  if (id === "system") throw new Error("system はアプリの ID に使えません。");
  return `/data/${encodeAppPathSegment(id)}`;
};
const lastPath = (key: string) => `/data/system/last/${encodeURIComponent(key)}.json`;
type StoredApp = Omit<InstalledApp, "wasm">;

/** 成果物と同じトランザクションにまとめられる、起動用の保存ファイル。 */
export function installedAppFiles(app: InstalledApp): Map<string, Uint8Array> {
  const { wasm, ...record } = app;
  const paths = appFilePaths(app.manifest.id, app.source);
  return new Map([[paths.record, encode(record)], [paths.wasm, wasm.slice()]]);
}

/** 同じファイルの木にアプリと OS の記録を保存する。一覧はパス順に返す。 */
export function createAppStore(tree: FileTree): AppStore {
  const storage = tree.storage;
  const fileStorage = storage ?? createMemoryStorage();
  const ownerFor = async (id: string) => {
    if (id === "system") throw new Error("system はアプリの ID に使えません。");
    const parsed = parseAppId(id, { allowHttp: true });
    const parent = parsed.sub ? appId(parsed.list ?? "binette:bundled", parsed.id) : id;
    return storage!.forOwner(await storage!.appOwner(parent, parsed.list));
  };
  const readOwnedApp = async (id: string, owner: string): Promise<InstalledApp | undefined> => {
    const [record, wasm] = await storage!.forOwner(owner).readFiles(["/build/record.json", "/build/app.wasm"]);
    if (record === undefined || wasm === undefined) return undefined;
    try {
      const saved = decode<StoredApp>(record);
      if (!saved || typeof saved.manifest?.id !== "string") return undefined;
      const parsed = parseAppId(id, { allowHttp: true });
      if (appId(parsed.list ?? saved.source, saved.manifest.id) !== id) return undefined;
      return { ...saved, key: id, source: parsed.list ?? saved.source, icon: saved.icon, wasm };
    } catch { return undefined; }
  };
  const canonicalKey = async (key: string): Promise<string> => {
    if (!storage) return key;
    const reference = /^binette:owner:(_[0-9a-f]+\/-[0-9a-f]+)(\..*)?$/s.exec(key);
    if (!reference) return key;
    const entry = await storage.findAppByOwner(reference[1]!);
    return entry ? entry.id + (reference[2] ?? "") : key;
  };
  const stableKey = async (key: string): Promise<string> => {
    if (!storage) return key;
    let parsed;
    try { parsed = parseAppId(key, { allowHttp: true }); } catch { return key; }
    const parent = appId(parsed.list ?? "binette:bundled", parsed.id);
    const suffix = parsed.sub ? `.${parsed.sub}` : "";
    if (`${parent}${suffix}` !== key) return key;
    const owner = await storage.appOwner(parent, parsed.list);
    return `binette:owner:${owner}${suffix}`;
  };
  const systemAppPath = async (key: string, kind: "permissions" | "last") => {
    if (!storage) return kind === "permissions" ? permissionsPath(key) : lastPath(key);
    const parsed = parseAppId(await canonicalKey(key), { allowHttp: true });
    const parent = appId(parsed.list ?? "binette:bundled", parsed.id);
    const owner = await storage.appOwner(parent, parsed.list);
    return `/data/system/${kind}/${encodeURIComponent(owner)}${parsed.sub ? `.${encodeURIComponent(parsed.sub)}` : ""}.json`;
  };
  const readApp = async (recordPath: string): Promise<InstalledApp | undefined> => {
    const [record, wasm] = await tree.readFiles([recordPath, recordPath.replace(/record\.json$/, "app.wasm")]);
    if (record === undefined || wasm === undefined) return undefined;
    let app: StoredApp | undefined;
    try { app = decode<StoredApp>(record); } catch { return undefined; }
    try {
      if (!app || typeof app.source !== "string" || typeof app.manifest?.id !== "string" ||
        app.key !== appId(app.source, app.manifest.id) ||
        appFilePaths(app.manifest.id, app.source).record !== recordPath) return undefined;
      return { ...app, icon: app.icon, wasm };
    } catch { return undefined; }
  };
  const store: AppStore = {
    pigeon: tree.pigeon ?? createMemoryPigeonStore(),
    shares: fileStorage,
    fileStorage,
    system: {
      getLists: async () => {
        const lists = decode<(ProviderListRegistration & { provider?: number })[]>(await tree.read(listsPath)) ?? [];
        if (!storage) return lists;
        return Promise.all(lists.map(async ({ url, boot, provider }) => {
          const current = await storage.provider(provider ?? url);
          return { url: current?.url ?? url, ...(boot === undefined ? {} : { boot }) };
        }));
      },
      putLists: async lists => {
        if (!storage) return tree.write(listsPath, encode(lists));
        const records = await Promise.all(lists.map(async list => ({ ...list, provider: (await storage.registerProvider(list.url)).number })));
        await tree.write(listsPath, encode(records));
      },
      getPermissions: async key => decode<string[]>(await tree.read(await systemAppPath(key, "permissions"))) ?? [],
      putPermissions: async (key, permissions) => tree.write(await systemAppPath(key, "permissions"), encode(permissions)),
      getLast: async key => decode<LifecycleRecord>(await tree.read(await systemAppPath(key, "last"))),
      async putLast(key, record) { return tree.write(await systemAppPath(key, "last"), encode(record)); },
      listLaunches: async () => Promise.all((decode<LaunchRecord[]>(await tree.read(launchesPath)) ?? []).map(async record => ({ ...record, app: await canonicalKey(record.app) }))),
      async recordLaunch(record, limit = 100) {
        const size = historySize(limit);
        const copy = { ...structuredClone(record), app: await stableKey(record.app) };
        return tree.update(launchesPath, value => {
          const launches = [...(decode<LaunchRecord[]>(value) ?? []), copy];
          return encode(size ? launches.slice(-size) : []);
        });
      },
      async getSettings() {
        const settings = decode<Partial<SystemSettings> & { home?: unknown }>(await tree.read(settingsPath));
        if (settings?.roles) settings.roles = Object.fromEntries(await Promise.all(Object.entries(settings.roles).map(async ([role, key]) => [role, await canonicalKey(key)])));
        if (settings === undefined || !("home" in settings)) return settings;
        // v0.2.0 の途中まで使っていた home を roles.home に読み替える
        const { home, ...rest } = settings;
        return typeof home === "string" ? { ...rest, roles: { home, ...rest.roles } } : rest;
      },
      async putSettings(settings) {
        validateSystemSettings(settings);
        const copy = structuredClone(settings);
        if (copy.roles) copy.roles = Object.fromEntries(await Promise.all(Object.entries(copy.roles).map(async ([role, key]) => [role, await stableKey(key)])));
        return tree.write(settingsPath, encode(copy));
      },
      getSchedules: async () => decode<Record<string, SavedSchedule>>(await tree.read(schedulesPath)) ?? {},
      putSchedules: schedules => tree.write(schedulesPath, encode(schedules)),
    },
    data: {
      async read(id) {
        if (storage) {
          const owner = await ownerFor(id);
          const paths = await owner.list("/data");
          const values = await owner.readFiles(paths);
          return new Map(paths.flatMap((path, i) => values[i] === undefined ? [] : [[decodeAppPathSegment(path.slice(6)), decoder.decode(values[i])]]));
        }
        const directory = dataDirectory(id);
        const names = (await tree.list(directory)).filter(path => path.startsWith(`${directory}/`));
        const values = await tree.readFiles(names);
        const result = new Map<string, string>();
        names.forEach((path, i) => { if (values[i] !== undefined) result.set(decodeAppPathSegment(path.slice(directory.length + 1)), decoder.decode(values[i])); });
        return result;
      },
      async write(id, name, value) {
        if (storage) {
          const owner = await ownerFor(id);
          const path = `/data/${encodeAppPathSegment(name)}`;
          await (value === null ? owner.delete(path) : owner.write(path, encoder.encode(value)));
          return;
        }
        const path = `${dataDirectory(id)}/${encodeAppPathSegment(name)}`;
        await (value === null ? tree.delete(path) : tree.write(path, encoder.encode(value)));
      },
    },
    async list() {
      const paths = (await tree.list("/apps")).filter(path => /^\/apps\/[^/]+\/record\.json$/.test(path));
      const apps = await Promise.all(paths.map(readApp));
      const result = new Map(apps.filter((app): app is InstalledApp => app !== undefined).map(app => [app.key, app]));
      if (storage) for (const entry of await storage.listApps()) {
        const app = await readOwnedApp(entry.id, entry.owner);
        if (app) result.set(app.key, app);
      }
      return [...result.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    },
    async get(key) {
      if (storage) {
        const entry = await storage.findApp(key);
        if (entry) {
          const app = await readOwnedApp(key, entry.owner);
          if (app) return app;
        }
      }
      // キーは完全な ID。旧い [source, id] の記録は移行しない。
      return await readApp(`/apps/${encodeAppPathSegment(key)}/record.json`);
    },
    async moveSource(from, to, lists) {
      if (from === to) return;
      if (storage) {
        await storage.moveProvider(from, to);
        return;
      }
      const parents = (await this.list()).filter(app => app.source === from);
      const mapping = new Map<string, string>();
      const files = new Map<string, Uint8Array>();
      const remove = new Set<string>();
      for (const app of parents) {
        const key = appId(to, app.manifest.id);
        if ((await tree.list(`/apps/${encodeAppPathSegment(key)}`)).length) throw new Error(`引っ越し先に同じ ID のアプリがあります: ${key}`);
        mapping.set(app.key, key);
        for (const id of Object.keys(app.manifest.sub ?? {})) mapping.set(`${app.key}.${normalizeAppIdentifier(id)}`, `${key}.${normalizeAppIdentifier(id)}`);
        const oldDirectory = `/apps/${encodeAppPathSegment(app.key)}`;
        const newDirectory = `/apps/${encodeAppPathSegment(key)}`;
        for (const path of await tree.list(oldDirectory)) {
          const value = await tree.read(path);
          if (value !== undefined) files.set(newDirectory + path.slice(oldDirectory.length), value);
          remove.add(path);
        }
        for (const [path, bytes] of installedAppFiles({ ...app, source: to, key })) files.set(path, bytes);
      }
      for (const [fromKey, toKey] of mapping) {
        const oldData = dataDirectory(fromKey), newData = dataDirectory(toKey);
        if ((await tree.list(newData)).length) throw new Error(`引っ越し先に保存データがあります: ${toKey}`);
        for (const path of await tree.list(oldData)) {
          const value = await tree.read(path);
          if (value !== undefined) files.set(newData + path.slice(oldData.length), value);
          remove.add(path);
        }
        for (const makePath of [lastPath, permissionsPath]) {
          const path = makePath(fromKey), destination = makePath(toKey);
          if (await tree.read(destination) !== undefined) throw new Error(`引っ越し先に OS の記録があります: ${toKey}`);
          const value = await tree.read(path);
          if (value !== undefined) { files.set(destination, value); remove.add(path); }
        }
      }
      const settings = decode<Partial<SystemSettings>>(await tree.read(settingsPath));
      if (settings?.roles) files.set(settingsPath, encode({ ...settings, roles: Object.fromEntries(Object.entries(settings.roles).map(([role, key]) => [role, mapping.get(key) ?? key])) }));
      const launches = decode<LaunchRecord[]>(await tree.read(launchesPath));
      if (launches) files.set(launchesPath, encode(launches.map(record => ({ ...record, app: mapping.get(record.app) ?? record.app }))));
      if (lists) files.set(listsPath, encode(lists));
      // 登録・アプリ・データ・OS の記録の付け替えと元の削除を同じトランザクションで行う。
      await tree.writeFiles(files, [...remove]);
    },
    async put(app, files) {
      if (storage) {
        const owner = storage.forOwner(await storage.appOwner(app.parentKey ?? app.key, app.source, app.manifest.name));
        const { wasm, ...record } = app;
        const output = new Map<string, Uint8Array>();
        for (const [path, bytes] of files ?? []) output.set(`/source/${path}`, bytes);
        output.set("/build/record.json", encode(record));
        output.set("/build/app.wasm", wasm);
        output.set("/build/index.html", encoder.encode(app.html));
        if (app.css !== undefined) output.set("/build/entry.css", encoder.encode(app.css));
        const remove = files ? (await owner.list("/source")).filter(path => !output.has(path)) : [];
        if (app.css === undefined) remove.push("/build/entry.css");
        await owner.writeFiles(output, remove);
      } else await tree.writeFiles(installedAppFiles(app));
    },
  };
  // 引っ越しの読み取りから一括保存まで、同じ保存先の storage・履歴・設定更新を待たせる。
  let tail = Promise.resolve();
  const serial = <T>(action: () => Promise<T>): Promise<T> => {
    const result = tail.then(action);
    tail = result.then(() => {}, () => {});
    return result;
  };
  return {
    pigeon: store.pigeon,
    shares: store.shares,
    fileStorage: store.fileStorage,
    list: () => serial(() => store.list()),
    get: key => serial(() => store.get(key)),
    put: (app, files) => { const copy = structuredClone(app); const source = files && structuredClone(files); return serial(() => store.put(copy, source)); },
    moveSource: (from, to, lists) => { const copy = structuredClone(lists); return serial(() => store.moveSource(from, to, copy)); },
    data: {
      read: id => serial(() => store.data.read(id)),
      write: (id, name, value) => serial(() => store.data.write(id, name, value)),
    },
    system: {
      getLists: () => serial(() => store.system.getLists()),
      putLists: lists => { const copy = structuredClone(lists); return serial(() => store.system.putLists(copy)); },
      getPermissions: key => serial(() => store.system.getPermissions(key)),
      putPermissions: (key, permissions) => { const copy = [...permissions]; return serial(() => store.system.putPermissions(key, copy)); },
      getLast: key => serial(() => store.system.getLast(key)),
      putLast: (key, record) => { const copy = structuredClone(record); return serial(() => store.system.putLast(key, copy)); },
      listLaunches: () => serial(() => store.system.listLaunches()),
      recordLaunch: (record, limit) => {
        historySize(limit ?? 100);
        const copy = structuredClone(record);
        return serial(() => store.system.recordLaunch(copy, limit));
      },
      getSettings: () => serial(() => store.system.getSettings()),
      putSettings: settings => {
        validateSystemSettings(settings);
        const copy = structuredClone(settings);
        return serial(() => store.system.putSettings(copy));
      },
      getSchedules: () => serial(() => store.system.getSchedules()),
      putSchedules: schedules => { const copy = structuredClone(schedules); return serial(() => store.system.putSchedules(copy)); },
    },
  };
}

/** 読み書きの値をコピーしてメモリに保存する。 */
export function createMemoryAppStore(): AppStore {
  return createAppStore(createMemoryFileTree());
}

/** IndexedDB の保存先。 */
export type IndexedDbAppStoreOptions = IndexedDbFileTreeOptions;

/** グローバルの indexedDB に保存する。接続は最初の読み書きで開く。 */
export function createIndexedDbAppStore(options: IndexedDbAppStoreOptions = {}): AppStore {
  const store = createAppStore(createIndexedDbFileTree(options));
  const system = store.system;
  return {
    ...store,
    pigeon: createIndexedDbPigeonStore(`${options.name ?? "binette-apps"}-pigeon`),
    system: {
      ...system,
      // IndexedDB 版は検証エラーも Promise の拒否で返す従来の契約を保つ。
      async recordLaunch(record, limit) { await system.recordLaunch(record, limit); },
      async putSettings(settings) { await system.putSettings(settings); },
    },
  };
}
