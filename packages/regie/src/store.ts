import type { AppManifest } from "@binette/core";
import { appFilePaths, decodeAppPathSegment, encodeAppPathSegment } from "./app-files.ts";
import { createIndexedDbFileTree, createMemoryFileTree, type FileTree } from "./fs.ts";

/** インストールしたアプリのビルド結果 */
export interface InstalledApp {
  /** JSON.stringify([source, manifest.id]) */
  key: string;
  source: string;
  manifest: AppManifest;
  /** SVG の文字列。無ければ undefined */
  icon: string | undefined;
  html: string;
  /** `entry.css` の CSS。無ければ undefined */
  css?: string;
  wasm: Uint8Array;
  /** Date.now() の Unix epoch ミリ秒 */
  installedAt: number;
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

/** インスタンスを作った日時（Unix epoch ミリ秒）と installedAppKey */
export interface LaunchRecord { time: number; app: string }

/** OS の設定。時間はミリ秒 */
export interface SystemSettings {
  /** 役割から割り当てたアプリの installedAppKey への写し。空ならブートの既定 */
  roles: Record<string, string>;
  stackSize: number;
  stopDelay: number;
  callTimeout: number;
  destroyTimeout: number;
  historyLimit: number;
  homeRetryWindow: number;
}

/** 保存が無いときの OS の既定値 */
export const DEFAULT_SYSTEM_SETTINGS: Readonly<SystemSettings> = Object.freeze({
  roles: {}, stackSize: 3, stopDelay: 10000, callTimeout: 5000,
  destroyTimeout: 5000, historyLimit: 100, homeRetryWindow: 5000,
});

/** アプリの記録と OS の設定。アプリのキーは installedAppKey を使う */
export interface SystemStore {
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
    } else if (!["stackSize", "stopDelay", "callTimeout", "destroyTimeout", "historyLimit", "homeRetryWindow"].includes(key) ||
      typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
      ((key === "stackSize" || key === "historyLimit") && !Number.isInteger(value)) ||
      (key === "stackSize" && value < 1)) {
      throw new Error(`OS の設定が範囲外です: ${key}`);
    }
  }
}

/** 入手元と ID の区切りが衝突しないキー */
export function installedAppKey(source: string, id: string): string {
  return JSON.stringify([source, id]);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const encode = (value: unknown): Uint8Array => encoder.encode(JSON.stringify(value));
const decode = <T>(value: Uint8Array | undefined): T | undefined =>
  value === undefined ? undefined : JSON.parse(decoder.decode(value)) as T;
const launchesPath = "/data/system/launches.json";
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
    if (!app || typeof app.source !== "string" || typeof app.manifest?.id !== "string" ||
      appFilePaths(app.manifest.id, app.source).record !== recordPath) return undefined;
    return { ...app, icon: app.icon, wasm };
  };
  return {
    system: {
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
      const paths = (await tree.list("/apps")).filter(path => /^\/apps\/[^/]+\/[^/]+\/record\.json$/.test(path));
      const apps = await Promise.all(paths.map(readApp));
      return apps.filter((app): app is InstalledApp => app !== undefined);
    },
    async get(key) {
      let parts: unknown;
      try { parts = JSON.parse(key); } catch { return undefined; }
      if (!Array.isArray(parts) || parts.length !== 2 || !parts.every(part => typeof part === "string")) return undefined;
      if (installedAppKey(parts[0], parts[1]) !== key) return undefined;
      return await readApp(appFilePaths(parts[1], parts[0]).record);
    },
    async put(app) {
      await tree.writeFiles(installedAppFiles(app));
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
