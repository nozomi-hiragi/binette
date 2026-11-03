import { createMemoryPigeonStore, createIndexedDbPigeonStore, type PigeonStore } from "./pigeon.ts";
import {
  createIndexedDbStorage,
  createMemoryStorage,
  type IndexedDbStorageOptions,
  type StorageBackend,
} from "./storage.ts";
export * from "./storage.ts";

/** パスをキーにした保存先。読み書きの値は毎回コピーする。 */
export interface FileTree {
  readonly storage?: StorageBackend;
  readonly pigeon?: PigeonStore;
  read(path: string): Promise<Uint8Array | undefined>;
  /** 同じ時点の複数ファイルを、指定した順でコピーして読む。 */
  readFiles(paths: readonly string[]): Promise<(Uint8Array | undefined)[]>;
  write(path: string, data: Uint8Array): Promise<void>;
  /** すべての検証とコピーを終えてから、ひとまとまりとして保存する。 */
  writeFiles(
    files: ReadonlyMap<string, Uint8Array>,
    remove?: readonly string[],
  ): Promise<void>;
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
// 設定サブアプリは親と実行物を共有するため、Cadre 全体を固定物から読む。
const fixedCadre = (path: string) => within(path, "/apps/cadre");
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
      return (!fixedCadre(path)
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
          if (logical && (layer !== "/user" || !fixedCadre(logical))) {
            found.add(logical);
          }
        }
      }
      return [...found].sort();
    },
  };
}

/** In-memory metadata and immutable content with the same storage semantics. */
export function createMemoryFileTree(): FileTree {
  return storageFileTree(createMemoryStorage(), createMemoryPigeonStore());
}

/** IndexedDB metadata and OPFS immutable file contents. */
export type IndexedDbFileTreeOptions = IndexedDbStorageOptions;
export function createIndexedDbFileTree(
  options: IndexedDbFileTreeOptions = {},
): FileTree {
  return storageFileTree(createIndexedDbStorage(options), createIndexedDbPigeonStore(`${options.name ?? "binette-apps"}-pigeon`));
}
function storageFileTree(storage: StorageBackend, pigeon: PigeonStore): FileTree {
  const owner = storage.forOwner("_0/-0");
  return overlay({
    storage,
    pigeon,
    read(path) {
      validatePath(path);
      return owner.read(path);
    },
    readFiles(paths) {
      paths.forEach(validatePath);
      return owner.readFiles(paths);
    },
    write(path, data) {
      writable(path);
      return owner.write(path, data);
    },
    writeFiles(files, remove = []) {
      const updates = writableFiles(files);
      remove.forEach(writable);
      return owner.writeFiles(updates, remove);
    },
    list(prefix) {
      validatePath(prefix);
      return owner.list(prefix);
    },
    delete(path) {
      writable(path);
      return owner.delete(path);
    },
    replaceSystem(files) {
      return owner.replace("/system", systemFiles(files));
    },
    update(path, transform) {
      writable(path);
      return owner.update(path, transform);
    },
  });
}
