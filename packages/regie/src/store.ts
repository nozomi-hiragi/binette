import type { AppManifest } from "@binette/core";

/** インストールしたアプリのビルド結果 */
export interface InstalledApp {
  /** JSON.stringify([source, manifest.id]) */
  key: string;
  source: string;
  manifest: AppManifest;
  /** SVG の文字列。無ければ undefined */
  icon: string | undefined;
  html: string;
  wasm: Uint8Array;
  /** Date.now() の Unix epoch ミリ秒 */
  installedAt: number;
}

/** ビルド結果の保存先 */
export interface AppStore {
  /** 同じ保存先の OS の記録 */
  readonly system: SystemStore;
  list(): Promise<InstalledApp[]>;
  get(key: string): Promise<InstalledApp | undefined>;
  put(app: InstalledApp): Promise<void>;
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
  home: string;
  stackSize: number;
  stopDelay: number;
  callTimeout: number;
  destroyTimeout: number;
  historyLimit: number;
  homeRetryWindow: number;
}

/** 保存が無いときの OS の既定値 */
export const DEFAULT_SYSTEM_SETTINGS: Readonly<SystemSettings> = Object.freeze({
  home: "", stackSize: 3, stopDelay: 10000, callTimeout: 5000,
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
    if (key === "home") {
      if (typeof value !== "string") throw new Error("home は文字列にしてください。");
    } else if (typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
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

/** メモリに保存する。読み書きの値は IndexedDB と同じく写す */
export function createMemoryAppStore(): AppStore {
  const apps = new Map<string, InstalledApp>();
  const last = new Map<string, LifecycleRecord>();
  let launches: LaunchRecord[] = [];
  let settings: Partial<SystemSettings> | undefined;
  return {
    system: {
      getLast: key => Promise.resolve(structuredClone(last.get(key))),
      putLast(key, record) { last.set(key, structuredClone(record)); return Promise.resolve(); },
      listLaunches: () => Promise.resolve(structuredClone(launches)),
      recordLaunch(record, limit = 100) {
        const size = historySize(limit);
        launches = size ? [...launches, structuredClone(record)].slice(-size) : [];
        return Promise.resolve();
      },
      getSettings: () => Promise.resolve(structuredClone(settings)),
      putSettings(value) { validateSystemSettings(value); settings = structuredClone(value); return Promise.resolve(); },
    },
    list: () => Promise.resolve(structuredClone([...apps.values()])),
    get: (key) => Promise.resolve(structuredClone(apps.get(key))),
    put(app) {
      apps.set(app.key, structuredClone(app));
      return Promise.resolve();
    },
  };
}

/** IndexedDB の保存先 */
export interface IndexedDbAppStoreOptions {
  /** DB 名。省略すると binette-apps */
  name?: string;
}

/** グローバルの indexedDB に保存する。接続は最初の読み書きで開く */
export function createIndexedDbAppStore(options: IndexedDbAppStoreOptions = {}): AppStore {
  let opening: Promise<IDBDatabase> | undefined;
  const open = () => opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = globalThis.indexedDB.open(options.name ?? "binette-apps", 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("apps")) db.createObjectStore("apps", { keyPath: "key" });
      if (!db.objectStoreNames.contains("system")) db.createObjectStore("system");
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = undefined; };
      resolve(db);
    };
  }).catch((error: unknown) => { opening = undefined; throw error; });

  const run = async <T>(table: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(table, mode);
      const request = action(transaction.objectStore(table));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? request.error ?? new Error("保存を中断しました。"));
      transaction.onerror = () => reject(transaction.error ?? request.error);
    });
  };
  return {
    system: {
      getLast: key => run("system", "readonly", store => store.get(`last:${key}`)),
      putLast: async (key, record) => { await run("system", "readwrite", store => store.put(record, `last:${key}`)); },
      listLaunches: async () => await run<LaunchRecord[] | undefined>("system", "readonly", store => store.get("launches")) ?? [],
      async recordLaunch(record, limit = 100) {
        const size = historySize(limit);
        // 読んでから書くまでを一つのトランザクションにし、同時の起動も失わない
        await run("system", "readwrite", store => {
          const request = store.get("launches");
          request.onsuccess = () => {
            const launches = [...(request.result ?? []) as LaunchRecord[], record];
            store.put(size ? launches.slice(-size) : [], "launches");
          };
          return request;
        });
      },
      getSettings: () => run("system", "readonly", store => store.get("settings")),
      async putSettings(settings) {
        validateSystemSettings(settings);
        await run("system", "readwrite", store => store.put(settings, "settings"));
      },
    },
    list: () => run<InstalledApp[]>("apps", "readonly", (store) => store.getAll()),
    get: (key) => run<InstalledApp | undefined>("apps", "readonly", (store) => store.get(key)),
    put: async (app) => { await run("apps", "readwrite", (store) => store.put(app)); },
  };
}
