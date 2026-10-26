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
  list(): Promise<InstalledApp[]>;
  get(key: string): Promise<InstalledApp | undefined>;
  put(app: InstalledApp): Promise<void>;
}

/** 入手元と ID の区切りが衝突しないキー */
export function installedAppKey(source: string, id: string): string {
  return JSON.stringify([source, id]);
}

/** メモリに保存する。読み書きの値は IndexedDB と同じく写す */
export function createMemoryAppStore(): AppStore {
  const apps = new Map<string, InstalledApp>();
  return {
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
    const request = globalThis.indexedDB.open(options.name ?? "binette-apps", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("apps", { keyPath: "key" });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = undefined; };
      resolve(db);
    };
  }).catch((error: unknown) => { opening = undefined; throw error; });

  const run = async <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction("apps", mode);
      const request = action(transaction.objectStore("apps"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? request.error ?? new Error("保存を中断しました。"));
      transaction.onerror = () => reject(transaction.error ?? request.error);
    });
  };
  return {
    list: () => run<InstalledApp[]>("readonly", (store) => store.getAll()),
    get: (key) => run<InstalledApp | undefined>("readonly", (store) => store.get(key)),
    put: async (app) => { await run("readwrite", (store) => store.put(app)); },
  };
}
