import { appId } from "./app-key.ts";
export { appId } from "./app-key.ts";
import { normalizeAppIdentifier, type AppManifest } from "@binette/core";
import { appFilePaths, decodeAppPathSegment, encodeAppPathSegment } from "./app-files.ts";
import { createIndexedDbFileTree, createMemoryFileTree, type FileTree } from "./fs.ts";

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
  /** アプリごとのデータ（`/data/<id>/`） */
  readonly data: AppDataStore;
  list(): Promise<InstalledApp[]>;
  get(key: string): Promise<InstalledApp | undefined>;
  put(app: InstalledApp): Promise<void>;
  /** 提供リストの引っ越し。保存データと OS の記録も付け替える */
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
    system: {
      getLists: async () => decode<ProviderListRegistration[]>(await tree.read(listsPath)) ?? [],
      putLists: lists => tree.write(listsPath, encode(lists)),
      getPermissions: async key => decode<string[]>(await tree.read(permissionsPath(key))) ?? [],
      putPermissions: (key, permissions) => tree.write(permissionsPath(key), encode(permissions)),
      getLast: async key => decode<LifecycleRecord>(await tree.read(lastPath(key))),
      putLast(key, record) { return tree.write(lastPath(key), encode(record)); },
      listLaunches: async () => decode<LaunchRecord[]>(await tree.read(launchesPath)) ?? [],
      recordLaunch(record, limit = 100) {
        const size = historySize(limit);
        const copy = structuredClone(record);
        return tree.update(launchesPath, value => {
          const launches = [...(decode<LaunchRecord[]>(value) ?? []), copy];
          return encode(size ? launches.slice(-size) : []);
        });
      },
      async getSettings() {
        const settings = decode<Partial<SystemSettings> & { home?: unknown }>(await tree.read(settingsPath));
        if (settings === undefined || !("home" in settings)) return settings;
        // v0.2.0 の途中まで使っていた home を roles.home に読み替える
        const { home, ...rest } = settings;
        return typeof home === "string" ? { ...rest, roles: { home, ...rest.roles } } : rest;
      },
      putSettings(settings) {
        validateSystemSettings(settings);
        return tree.write(settingsPath, encode(settings));
      },
    },
    data: {
      async read(id) {
        const directory = dataDirectory(id);
        const names = (await tree.list(directory)).filter(path => path.startsWith(`${directory}/`));
        const values = await tree.readFiles(names);
        const result = new Map<string, string>();
        names.forEach((path, i) => { if (values[i] !== undefined) result.set(decodeAppPathSegment(path.slice(directory.length + 1)), decoder.decode(values[i])); });
        return result;
      },
      async write(id, name, value) {
        const path = `${dataDirectory(id)}/${encodeAppPathSegment(name)}`;
        await (value === null ? tree.delete(path) : tree.write(path, encoder.encode(value)));
      },
    },
    async list() {
      const paths = (await tree.list("/apps")).filter(path => /^\/apps\/[^/]+\/record\.json$/.test(path));
      const apps = await Promise.all(paths.map(readApp));
      return apps.filter((app): app is InstalledApp => app !== undefined);
    },
    async get(key) {
      // キーは完全な ID。旧い [source, id] の記録は移行しない。
      return await readApp(`/apps/${encodeAppPathSegment(key)}/record.json`);
    },
    async moveSource(from, to, lists) {
      if (from === to) return;
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
    async put(app) {
      await tree.writeFiles(installedAppFiles(app));
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
    list: () => serial(() => store.list()),
    get: key => serial(() => store.get(key)),
    put: app => { const copy = structuredClone(app); return serial(() => store.put(copy)); },
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
    },
  };
}

/** 読み書きの値をコピーしてメモリに保存する。 */
export function createMemoryAppStore(): AppStore {
  return createAppStore(createMemoryFileTree());
}

/** IndexedDB の保存先。 */
export interface IndexedDbAppStoreOptions {
  /** DB 名。省略すると binette-apps。 */
  name?: string;
}

/** グローバルの indexedDB に保存する。接続は最初の読み書きで開く。 */
export function createIndexedDbAppStore(options: IndexedDbAppStoreOptions = {}): AppStore {
  const store = createAppStore(createIndexedDbFileTree(options));
  const system = store.system;
  return {
    ...store,
    system: {
      ...system,
      // IndexedDB 版は検証エラーも Promise の拒否で返す従来の契約を保つ。
      async recordLaunch(record, limit) { await system.recordLaunch(record, limit); },
      async putSettings(settings) { await system.putSettings(settings); },
    },
  };
}
