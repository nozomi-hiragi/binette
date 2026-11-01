import { appFilePaths } from "./app-files.ts";

/** パスをキーにした保存先。読み書きの値は毎回コピーする。 */
export interface FileTree {
  read(path: string): Promise<Uint8Array | undefined>;
  /** 同じ時点の複数ファイルを、指定した順でコピーして読む。 */
  readFiles(paths: readonly string[]): Promise<(Uint8Array | undefined)[]>;
  write(path: string, data: Uint8Array): Promise<void>;
  /** すべての検証とコピーを終えてから、ひとまとまりとして保存する。 */
  writeFiles(files: ReadonlyMap<string, Uint8Array>): Promise<void>;
  list(prefix: string): Promise<string[]>;
  delete(path: string): Promise<void>;
  replaceSystem(files: ReadonlyMap<string, Uint8Array>): Promise<void>;
  /** /system に /user を重ねて読む。設定アプリは上書きしない。 */
  readOverlay(path: string): Promise<Uint8Array | undefined>;
  /** 論理パスを一覧する。/ は両方の層を含む。 */
  listOverlay(prefix: string): Promise<string[]>;
  update(
    path: string,
    transform: (value: Uint8Array | undefined) => Uint8Array,
  ): Promise<void>;
}

function validatePath(path: string): void {
  if (path === "/") return;
  if (
    !path.startsWith("/") || path.endsWith("/") || path.includes("\\") ||
    [...path].some((char) =>
      char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
    ) ||
    path.slice(1).split("/").some((part) =>
      !part || part === "." || part === ".."
    )
  ) {
    throw new Error(`Expected a canonical absolute path: ${path}`);
  }
}
const within = (path: string, prefix: string) =>
  prefix === "/" || path === prefix || path.startsWith(`${prefix}/`);
function writable(path: string): void {
  validatePath(path);
  if (path === "/" || within(path, "/system")) {
    throw new Error("/system can only be changed with replaceSystem.");
  }
}
const settings = (path: string) => within(path, "/apps/settings");
const copy = (value: Uint8Array | undefined) => value?.slice();
function writableFiles(
  files: ReadonlyMap<string, Uint8Array>,
): Map<string, Uint8Array> {
  const result = new Map<string, Uint8Array>();
  for (const [path, data] of files) {
    writable(path);
    result.set(path, data.slice());
  }
  return result;
}
function systemFiles(
  files: ReadonlyMap<string, Uint8Array>,
): Map<string, Uint8Array> {
  const result = new Map<string, Uint8Array>();
  for (const [path, data] of files) {
    validatePath(path);
    if (!path.startsWith("/system/")) {
      throw new Error("Expected files below /system.");
    }
    result.set(path, data.slice());
  }
  return result;
}

function overlay(
  tree: Omit<FileTree, "readOverlay" | "listOverlay">,
): FileTree {
  return {
    ...tree,
    async readOverlay(path) {
      validatePath(path);
      return (!settings(path)
        ? await tree.read(`/user${path === "/" ? "" : path}`)
        : undefined) ??
        await tree.read(`/system${path === "/" ? "" : path}`);
    },
    async listOverlay(prefix) {
      validatePath(prefix);
      const found = new Set<string>();
      for (const layer of ["/system", "/user"]) {
        for (
          const path of await tree.list(
            `${layer}${prefix === "/" ? "" : prefix}`,
          )
        ) {
          const logical = path.slice(layer.length);
          if (logical && (layer !== "/user" || !settings(logical))) {
            found.add(logical);
          }
        }
      }
      return [...found].sort();
    },
  };
}

/** メモリに保存する。 */
export function createMemoryFileTree(): FileTree {
  const files = new Map<string, Uint8Array>();
  return overlay({
    read(path) {
      validatePath(path);
      return Promise.resolve(copy(files.get(path)));
    },
    readFiles(paths) {
      for (const path of paths) validatePath(path);
      return Promise.resolve(paths.map((path) => copy(files.get(path))));
    },
    write(path, data) {
      writable(path);
      files.set(path, data.slice());
      return Promise.resolve();
    },
    writeFiles(input) {
      const updates = writableFiles(input);
      for (const [path, data] of updates) files.set(path, data);
      return Promise.resolve();
    },
    list(prefix) {
      validatePath(prefix);
      return Promise.resolve(
        [...files.keys()].filter((path) => within(path, prefix)).sort(),
      );
    },
    delete(path) {
      writable(path);
      files.delete(path);
      return Promise.resolve();
    },
    replaceSystem(input) {
      const replacements = systemFiles(input);
      for (const path of files.keys()) {
        if (within(path, "/system")) files.delete(path);
      }
      for (const [path, data] of replacements) files.set(path, data);
      return Promise.resolve();
    },
    update(path, transform) {
      writable(path);
      files.set(path, transform(copy(files.get(path))).slice());
      return Promise.resolve();
    },
  });
}

/** IndexedDB の保存先。既定の DB 名は binette-apps。 */
export interface IndexedDbFileTreeOptions {
  name?: string;
}

/** 最初の操作で接続し、旧 AppStore・SystemStore は DB 更新時に移す。 */
export function createIndexedDbFileTree(
  options: IndexedDbFileTreeOptions = {},
): FileTree {
  let opening: Promise<IDBDatabase> | undefined;
  const open = () =>
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = globalThis.indexedDB.open(
        options.name ?? "binette-apps",
        3,
      );
      request.onupgradeneeded = () => {
        const db = request.result;
        const files = db.createObjectStore("files");
        const transaction = request.transaction!;
        const encode = (value: unknown) =>
          new TextEncoder().encode(JSON.stringify(value));
        if (db.objectStoreNames.contains("apps")) {
          const cursor = transaction.objectStore("apps").openCursor();
          cursor.onsuccess = () => {
            const entry = cursor.result;
            if (!entry) return;
            const app = entry.value;
            const paths = appFilePaths(app.manifest.id, app.source);
            const metadata = { ...app };
            delete metadata.wasm;
            files.put(encode(metadata), paths.record);
            files.put(app.wasm, paths.wasm);
            entry.continue();
          };
        }
        if (db.objectStoreNames.contains("system")) {
          const cursor = transaction.objectStore("system").openCursor();
          cursor.onsuccess = () => {
            const entry = cursor.result;
            if (!entry) return;
            const key = String(entry.key);
            const path = key.startsWith("last:")
              ? `last/${encodeURIComponent(key.slice(5))}`
              : key;
            if (
              key === "settings" || key === "launches" ||
              key.startsWith("last:")
            ) files.put(encode(entry.value), `/data/system/${path}.json`);
            entry.continue();
          };
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          opening = undefined;
        };
        resolve(db);
      };
    }).catch((error: unknown) => {
      opening = undefined;
      throw error;
    });

  const run = async <T>(
    mode: IDBTransactionMode,
    action: (
      store: IDBObjectStore,
      set: (value: T) => void,
      fail: (error: unknown) => void,
    ) => void,
  ): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction("files", mode);
      let value: T;
      let failure: unknown;
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = () =>
        reject(
          failure ?? transaction.error ??
            new Error("File transaction aborted."),
        );
      transaction.onerror = () => reject(failure ?? transaction.error);
      try {
        action(transaction.objectStore("files"), (result) => {
          value = result;
        }, (error) => {
          failure = error;
          transaction.abort();
        });
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    });
  };
  return overlay({
    read(path) {
      validatePath(path);
      return run<Uint8Array | undefined>("readonly", (store, set) => {
        const request = store.get(path);
        request.onsuccess = () => set(copy(request.result));
      });
    },
    readFiles(paths) {
      const requested = [...paths];
      for (const path of requested) validatePath(path);
      return run<(Uint8Array | undefined)[]>("readonly", (store, set) => {
        const values: (Uint8Array | undefined)[] = new Array(requested.length);
        set(values);
        requested.forEach((path, index) => {
          const request = store.get(path);
          request.onsuccess = () => {
            values[index] = copy(request.result);
          };
        });
      });
    },
    write(path, data) {
      writable(path);
      const value = data.slice();
      return run<void>("readwrite", (store) => {
        store.put(value, path);
      });
    },
    writeFiles(input) {
      const updates = writableFiles(input);
      return run<void>("readwrite", (store) => {
        for (const [path, data] of updates) store.put(data, path);
      });
    },
    list(prefix) {
      validatePath(prefix);
      return run<string[]>("readonly", (store, set) => {
        const request = store.getAllKeys();
        request.onsuccess = () =>
          set(
            request.result.map(String).filter((path) => within(path, prefix))
              .sort(),
          );
      });
    },
    delete(path) {
      writable(path);
      return run<void>("readwrite", (store) => {
        store.delete(path);
      });
    },
    replaceSystem(input) {
      const replacements = systemFiles(input);
      return run<void>("readwrite", (store) => {
        const request = store.getAllKeys();
        request.onsuccess = () => {
          for (const key of request.result) {
            if (within(String(key), "/system")) store.delete(key);
          }
          for (const [path, data] of replacements) store.put(data, path);
        };
      });
    },
    update(path, transform) {
      writable(path);
      return run<void>("readwrite", (store, _set, fail) => {
        const request = store.get(path);
        request.onsuccess = () => {
          try {
            store.put(transform(copy(request.result)).slice(), path);
          } catch (error) {
            fail(error);
          }
        };
      });
    },
  });
}
