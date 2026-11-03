import { formatAppId, parseAppId } from "@binette/core";
/** Immutable content storage; keys are owner/hash paths. */
export interface ContentStore {
  read(key: string): Promise<Uint8Array | undefined>;
  write(key: string, value: Uint8Array): Promise<void>;
  list(): Promise<string[]>;
  delete(key: string): Promise<void>;
}
export function createMemoryContentStore(): ContentStore {
  const files = new Map<string, Uint8Array>();
  return {
    read: (key) => Promise.resolve(files.get(key)?.slice()),
    write: (key, value) => {
      files.set(key, value.slice());
      return Promise.resolve();
    },
    list: () => Promise.resolve([...files.keys()]),
    delete: (key) => {
      files.delete(key);
      return Promise.resolve();
    },
  };
}
export function createOpfsContentStore(namespace?: string): ContentStore {
  const root = async () => {
    const directory = await navigator.storage.getDirectory();
    if (namespace === undefined) return directory;
    return (await directory.getDirectoryHandle("databases", { create: true }))
      .getDirectoryHandle(encodeURIComponent(namespace), { create: true });
  };
  async function parent(key: string, create: boolean) {
    const parts = key.split("/");
    const name = parts.pop()!;
    let directory = await root();
    for (const part of parts) {
      directory = await directory.getDirectoryHandle(part, { create });
    }
    return { directory, name };
  }
  const missing = (error: unknown) =>
    error instanceof DOMException && error.name === "NotFoundError";
  return {
    async read(key) {
      try {
        const { directory, name } = await parent(key, false);
        return new Uint8Array(
          await (await (await directory.getFileHandle(name)).getFile())
            .arrayBuffer(),
        );
      } catch (error) {
        if (missing(error)) return undefined;
        throw error;
      }
    },
    async write(key, value) {
      const { directory, name } = await parent(key, true);
      const stream =
        await (await directory.getFileHandle(name, { create: true }))
          .createWritable();
      try {
        await stream.write(value.slice().buffer);
        await stream.close();
      } catch (error) {
        await stream.abort().catch(() => {});
        throw error;
      }
    },
    async list() {
      const found: string[] = [];
      async function visit(
        directory: FileSystemDirectoryHandle,
        prefix: string,
      ) {
        for await (const [name, entry] of directory.entries()) {
          if (
            namespace === undefined && prefix === "" && name === "databases"
          ) continue;
          if (entry.kind === "directory") {
            await visit(
              entry as FileSystemDirectoryHandle,
              `${prefix}${name}/`,
            );
          } else found.push(`${prefix}${name}`);
        }
      }
      await visit(await root(), "");
      return found;
    },
    async delete(key) {
      try {
        const { directory, name } = await parent(key, false);
        await directory.removeEntry(name);
        const parts = key.split("/");
        parts.pop();
        while (parts.length) {
          let parent = await root();
          for (const part of parts.slice(0, -1)) {
            parent = await parent.getDirectoryHandle(part);
          }
          const child = await parent.getDirectoryHandle(
            parts[parts.length - 1],
          );
          if (!(await child.entries().next()).done) break;
          await parent.removeEntry(parts[parts.length - 1]);
          parts.pop();
        }
      } catch (error) {
        if (!missing(error)) throw error;
      }
    },
  };
}
export interface FileMetadata {
  hash: string;
  history: string[];
  deleted?: number;
  name: string;
  size: number;
  created: number;
  modified: number;
}
/** A Filer entry referring to content in a shared owner. */
export interface FileReference {
  share: string;
  path: string;
  name: string;
  size: number;
  created: number;
  modified: number;
  deleted?: number;
}
type FileRow = FileMetadata | FileReference;
function isReference(row: FileRow): row is FileReference { return "share" in row; }
export interface ProviderRecord {
  number: number;
  url: string;
  name: string;
  added: number;
}
export interface ShareRecord {
  id: string;
  name: string;
  created: number;
  creator: string;
  members: Record<
    string,
    { access: "read" | "write"; state: "invited" | "joined"; label?: string }
  >;
}
export interface ShareStorage {
  createShare(creator: string, name: string, id?: string): Promise<ShareRecord>;
  getShare(id: string): Promise<ShareRecord | undefined>;
  listShares(appId: string): Promise<ShareRecord[]>;
  inviteShare(
    id: string,
    actor: string,
    target: string,
    access: "read" | "write",
  ): Promise<void>;
  inviteSharesWithDelivery(
    actor: string,
    target: string,
    attachments: readonly { id: string; access: "read" | "write" }[],
    deliver: () => Promise<void>,
  ): Promise<void>;
  inviteShareWithDelivery(
    id: string,
    actor: string,
    target: string,
    access: "read" | "write",
    deliver: () => Promise<void>,
  ): Promise<void>;
  joinShare(id: string, appId: string): Promise<void>;
  leaveShare(id: string, appId: string): Promise<void>;
  shareFiles(id: string, appId: string): OwnerStorage;
  accessShareFile(
    id: string,
    appId: string,
    operation: keyof OwnerStorage,
    args: unknown[],
  ): Promise<unknown>;
  filerShareOn(appId: string, owner: string, path: string, sharedPath: string): Promise<ShareRecord>;
  filerShareReference(appId: string, owner: string, path: string, share: string, sharedPath: string): Promise<void>;
  filerShareOff(appId: string, owner: string, path: string): Promise<void>;
  filerShareRename(appId: string, owner: string, share: string, from: string, to: string): Promise<void>;
  filerShareDelete(appId: string, owner: string, share: string, path: string): Promise<void>;
  filerShareList(appId: string, owner: string, prefix: string): Promise<{ path: string; row: FileRow }[]>;
  filerShareFolderRename(appId: string, owner: string, share: string, label: string): Promise<void>;
  filerShareFolderLeave(appId: string, owner: string, share: string): Promise<void>;
  filerShareSubfolderRename(appId: string, owner: string, share: string, from: string, to: string): Promise<void>;
  filerShareSubfolderDelete(appId: string, owner: string, share: string, prefix: string): Promise<void>;
  moveShareFile(
    id: string,
    appId: string,
    owner: string,
    path: string,
    sharedPath: string,
    toShare: boolean,
  ): Promise<void>;
}
interface State {
  shares: Map<string, ShareRecord>;
  afterCommit?: (() => Promise<void>)[];
  providers: Map<number, Omit<ProviderRecord, "number">>;
  apps: Map<string, string>;
  files: Map<string, FileRow>;
  counters: Map<string, number>;
}
export interface OwnerStorage {
  read(path: string): Promise<Uint8Array | undefined>;
  readFiles(paths: readonly string[]): Promise<(Uint8Array | undefined)[]>;
  write(path: string, value: Uint8Array): Promise<void>;
  writeFiles(
    files: ReadonlyMap<string, Uint8Array>,
    remove?: readonly string[],
  ): Promise<void>;
  list(prefix: string): Promise<string[]>;
  delete(path: string): Promise<void>;
  update(
    path: string,
    transform: (value: Uint8Array | undefined) => Uint8Array,
  ): Promise<void>;
  metadata(path: string): Promise<FileMetadata | undefined>;
  restore(path: string, hash?: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  replace(
    prefix: string,
    files: ReadonlyMap<string, Uint8Array>,
  ): Promise<void>;
}
export interface StorageBackend extends ShareStorage {
  forOwner(owner: string): OwnerStorage;
  appOwner(appId: string, providerUrl?: string, name?: string): Promise<string>;
  provider(url: string | number): Promise<ProviderRecord | undefined>;
  registerProvider(url: string, name?: string): Promise<ProviderRecord>;
  listApps(): Promise<
    { id: string; owner: string; provider: ProviderRecord }[]
  >;
  findApp(
    id: string,
  ): Promise<
    { id: string; owner: string; provider: ProviderRecord } | undefined
  >;
  findAppByOwner(
    owner: string,
  ): Promise<
    { id: string; owner: string; provider: ProviderRecord } | undefined
  >;
  moveProvider(from: string, to: string): Promise<void>;
  removeApp(id: string, immediate?: boolean): Promise<void>;
  gc(now?: number): Promise<void>;
  syncProviders(): Promise<void>;
}
const emptyState = (): State => ({
  shares: new Map(),
  providers: new Map([[0, {
    url: "binette:system",
    name: "Binette",
    added: Date.now(),
  }]]),
  apps: new Map(),
  files: new Map(),
  counters: new Map([["provider", 1], ["app:0", 1]]),
});
const key = (owner: string, path: string) => JSON.stringify([owner, path]);
function pathCheck(path: string) {
  if (
    !path.startsWith("/") || (path !== "/" && path.endsWith("/")) ||
    path.includes("\\") ||
    [...path].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
    (path !== "/" &&
      path.slice(1).split("/").some((p) => !p || p === "." || p === ".."))
  ) throw new Error(`Expected a canonical absolute path: ${path}`);
}
const within = (path: string, prefix: string) =>
  prefix === "/" || path === prefix || path.startsWith(`${prefix}/`);
async function hash(value: Uint8Array) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", value.slice().buffer),
    ),
  ].map((b) => b.toString(16).padStart(2, "0")).join("");
}
interface Persistence {
  run<T>(action: (state: State) => T | Promise<T>, write: boolean): Promise<T>;
}
function backend(
  persistence: Persistence,
  content: ContentStore,
  now: () => number,
): StorageBackend {
  const run = <T>(action: (state: State) => T | Promise<T>, write = false) =>
    persistence.run(action, write);
  const read = async (state: State, owner: string, path: string) => {
    const row = state.files.get(key(owner, path));
    if (!row || row.deleted !== undefined || isReference(row)) return undefined;
    const value = await content.read(`${owner}/${row.hash}`);
    if (!value) throw new Error(`Missing stored content: ${owner}/${row.hash}`);
    return value;
  };
  async function put(
    state: State,
    owner: string,
    files: ReadonlyMap<string, Uint8Array>,
    remove: readonly string[] = [],
  ) {
    const date = now();
    const updates: [string, FileMetadata][] = [];
    for (const [path, value] of files) {
      const digest = await hash(value);
      if (!await content.read(`${owner}/${digest}`)) {
        await content.write(`${owner}/${digest}`, value);
      }
      const previous = state.files.get(key(owner, path));
      updates.push([key(owner, path), {
        hash: digest,
        history: previous && !isReference(previous)
          ? (previous.hash === digest
            ? previous.history
            : [previous.hash, ...previous.history.filter((h) => h !== digest)])
            .slice(0, 10)
          : [],
        name: path.split("/").pop()!,
        size: value.length,
        created: previous?.created ?? date,
        modified: date,
      }]);
    }
    for (const path of remove) {
      const row = state.files.get(key(owner, path));
      if (row) state.files.set(key(owner, path), { ...row, deleted: date });
    }
    for (const [k, row] of updates) state.files.set(k, row);
  }
  function currentId(state: State, key: string, id: string): string {
    const provider = state.providers.get(JSON.parse(key)[0])!;
    const parsed = parseAppId(id, { allowHttp: true });
    return formatAppId({
      id: parsed.id,
      ...(provider.url.startsWith("binette:") ? {} : { list: provider.url }),
    }, { allowHttp: true });
  }
  function checkFilerOwner(s: State, appId: string, owner: string): void {
    const owned = [...s.apps].some(([k, value]) => {
      const [p, a] = JSON.parse(k);
      const parent = currentId(s, k, value);
      return `_${p.toString(16)}/-${a.toString(16)}` === owner && appId === parent;
    });
    if (!owned) throw new Error("自分の保存領域だけを操作できます。");
  }
  async function copyContent(from: string, to: string, row: FileMetadata): Promise<void> {
    for (const digest of [row.hash, ...row.history]) {
      const bytes = await content.read(`${from}/${digest}`);
      if (!bytes) throw new Error("ファイルの内容がありません。");
      if (!await content.read(`${to}/${digest}`)) await content.write(`${to}/${digest}`, bytes);
    }
  }
  const api: StorageBackend = {
    createShare(creator, name, id = crypto.randomUUID()) {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(id)
      ) throw new Error("共有 ID は UUID v4 にしてください。");
      return run((s) => {
        if (s.shares.has(id)) throw new Error("共有は既にあります。");
        const record: ShareRecord = {
          id,
          name,
          created: now(),
          creator,
          members: { [creator]: { access: "write", state: "joined" } },
        };
        s.shares.set(id, record);
        return structuredClone(record);
      }, true);
    },
    getShare(id) {
      return run((s) => structuredClone(s.shares.get(id)));
    },
    listShares(appId) {
      return run((s) =>
        structuredClone(
          [...s.shares.values()].filter((r) => Object.hasOwn(r.members, appId)),
        )
      );
    },
    inviteShare(id, actor, target, access) {
      if (access !== "read" && access !== "write") {
        throw new Error("共有の権限が不正です。");
      }
      return run((s) => {
        const row = s.shares.get(id);
        if (
          !row || row.members[actor]?.state !== "joined" ||
          row.members[actor]?.access !== "write"
        ) throw new Error("共有への書き込み権限がありません。");
        if (row.members[target]?.state === "joined") {
          throw new Error("既に参加しています。");
        }
        row.members[target] = { access, state: "invited" };
      }, true);
    },
    inviteSharesWithDelivery(actor, target, attachments, deliver) {
      const copies = structuredClone(attachments);
      return run(async (s) => {
        for (const { id, access } of copies) {
          if (access !== "read" && access !== "write") {
            throw new Error("共有の権限が不正です。");
          }
          const row = s.shares.get(id);
          if (
            !row || row.members[actor]?.state !== "joined" ||
            row.members[actor]?.access !== "write"
          ) throw new Error("共有への書き込み権限がありません。");
          if (row.members[target]?.state === "joined") {
            throw new Error("既に参加しています。");
          }
          row.members[target] = { access, state: "invited" };
        }
        await deliver();
      }, true);
    },
    inviteShareWithDelivery(id, actor, target, access, deliver) {
      return run(async (s) => {
        if (access !== "read" && access !== "write") {
          throw new Error("共有の権限が不正です。");
        }
        const row = s.shares.get(id);
        if (
          !row || row.members[actor]?.state !== "joined" ||
          row.members[actor]?.access !== "write"
        ) throw new Error("共有への書き込み権限がありません。");
        if (row.members[target]?.state === "joined") {
          throw new Error("既に参加しています。");
        }
        row.members[target] = { access, state: "invited" };
        await deliver();
      }, true);
    },
    joinShare(id, appId) {
      return run((s) => {
        const member = s.shares.get(id)?.members[appId];
        if (!member) throw new Error("共有が無いか、招待されていません。");
        member.state = "joined";
      }, true);
    },
    leaveShare(id, appId) {
      return run((s) => {
        const row = s.shares.get(id);
        if (!row) return;
        delete row.members[appId];
        if (!Object.values(row.members).some((m) => m.state === "joined")) {
          s.shares.delete(id);
          for (const k of s.files.keys()) {
            if (JSON.parse(k)[0] === `shared/${id}`) s.files.delete(k);
          }
        }
      }, true);
    },
    shareFiles(id, appId) {
      return checkedShareFiles(api, id, appId);
    },
    accessShareFile(id, appId, operation, args) {
      const reading = ["read", "readFiles", "list", "metadata"].includes(
        operation,
      );
      if (
        ![
          "read",
          "readFiles",
          "list",
          "metadata",
          "write",
          "writeFiles",
          "delete",
          "update",
          "restore",
          "move",
          "replace",
        ].includes(operation)
      ) throw new Error("ファイル操作が不正です。");
      return run(async (s) => {
        const member = s.shares.get(id)?.members[appId];
        if (
          member?.state !== "joined" || (!reading && member.access !== "write")
        ) throw new Error("共有の権限がありません。");
        const local = backend(
          { run: async (action) => await action(s) },
          content,
          now,
        ).forOwner(`shared/${id}`);
        return await Reflect.apply(Reflect.get(local, operation), local, args);
      }, !reading);
    },
    filerShareFolderRename(appId, owner, id, label) {
      if (!label || label === "." || label === ".." || (label.includes("/") || label.includes("\\") || [...label].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))) throw new Error("フォルダー名が不正です。");
      return run((s) => {
        checkFilerOwner(s, appId, owner);
        const member = s.shares.get(id)?.members[appId];
        if (member?.state !== "joined") throw new Error("共有の権限がありません。");
        member.label = label;
      }, true);
    },
    filerShareSubfolderRename(appId, owner, id, from, to) {
      pathCheck(from); pathCheck(to);
      if (from === "/" || to === "/" || (from !== to && (within(from, to) || within(to, from)))) throw new Error("フォルダーのパスが不正です。");
      return run((s) => {
        checkFilerOwner(s, appId, owner);
        const member = s.shares.get(id)?.members[appId];
        if (member?.state !== "joined" || member.access !== "write") throw new Error("共有への書き込み権限がありません。");
        const sharedOwner = `shared/${id}`;
        const source = [...s.files].flatMap(([fileKey, row]) => {
          const [fileOwner, path] = JSON.parse(fileKey) as [string, string];
          return fileOwner === sharedOwner && within(path, from) ? [{ fileKey, path, row }] : [];
        });
        if (!source.some(({ row }) => row.deleted === undefined)) throw new Error("共有フォルダーがありません。");
        if (from === to) return;
        for (const { path } of source) if (s.files.has(key(sharedOwner, to + path.slice(from.length)))) throw new Error("移動先にファイルがあります。");
        for (const { fileKey } of source) s.files.delete(fileKey);
        for (const { path, row } of source) {
          const next = to + path.slice(from.length);
          s.files.set(key(sharedOwner, next), { ...row, name: next.split("/").pop()!, modified: now() });
        }
        for (const [fileKey, ref] of s.files) {
          const [fileOwner] = JSON.parse(fileKey) as [string, string];
          if (fileOwner === owner && isReference(ref) && ref.share === id && within(ref.path, from)) s.files.set(fileKey, { ...ref, path: to + ref.path.slice(from.length), modified: now() });
        }
      }, true);
    },
    filerShareSubfolderDelete(appId, owner, id, prefix) {
      pathCheck(prefix);
      if (prefix === "/") throw new Error("共有ルートには使えません。");
      return run((s) => {
        checkFilerOwner(s, appId, owner);
        const member = s.shares.get(id)?.members[appId];
        if (member?.state !== "joined" || member.access !== "write") throw new Error("共有への書き込み権限がありません。");
        const sharedOwner = `shared/${id}`;
        let found = false;
        const date = now();
        for (const [fileKey, row] of s.files) {
          const [fileOwner, path] = JSON.parse(fileKey) as [string, string];
          if (fileOwner === sharedOwner && within(path, prefix) && row.deleted === undefined) { found = true; s.files.set(fileKey, { ...row, deleted: date }); }
          else if (fileOwner === owner && isReference(row) && row.share === id && within(row.path, prefix) && row.deleted === undefined) s.files.set(fileKey, { ...row, deleted: date });
        }
        if (!found) throw new Error("共有フォルダーがありません。");
      }, true);
    },
    filerShareFolderLeave(appId, owner, id) {
      return run(async (s) => {
        checkFilerOwner(s, appId, owner);
        const share = s.shares.get(id);
        if (share?.members[appId]?.state !== "joined") throw new Error("共有の権限がありません。");
        const sharedOwner = `shared/${id}`;
        for (const [fileKey, ref] of s.files) {
          const [fileOwner] = JSON.parse(fileKey) as [string, string];
          if (fileOwner !== owner || !isReference(ref) || ref.share !== id) continue;
          const source = s.files.get(key(sharedOwner, ref.path));
          if (!source || source.deleted !== undefined) { s.files.delete(fileKey); continue; }
          if (isReference(source)) throw new Error("共有ファイルが不正です。");
          await copyContent(sharedOwner, owner, source);
          const { deleted: _deleted, ...contentRow } = source;
          s.files.set(fileKey, { ...contentRow, name: ref.name, created: ref.created, modified: ref.modified, ...(ref.deleted === undefined ? {} : { deleted: ref.deleted }) });
        }
        delete share.members[appId];
        if (!Object.values(share.members).some(member => member.state === "joined")) {
          s.shares.delete(id);
          for (const fileKey of s.files.keys()) if (JSON.parse(fileKey)[0] === sharedOwner) s.files.delete(fileKey);
        }
      }, true);
    },
    filerShareList(appId, owner, prefix) {
      pathCheck(prefix);
      return run((s) => {
        checkFilerOwner(s, appId, owner);
        return [...s.files].flatMap(([key, row]) => {
          const [fileOwner, path] = JSON.parse(key) as [string, string];
          return fileOwner === owner && row.deleted === undefined && within(path, prefix)
            ? [{ path, row: structuredClone(row) }] : [];
        });
      });
    },
    filerShareReference(appId, owner, path, id, sharedPath) {
      pathCheck(path); pathCheck(sharedPath);
      if (path === "/" || sharedPath === "/") throw new Error("ファイルのパスにしてください。");
      return run((s) => {
        checkFilerOwner(s, appId, owner);
        if (s.shares.get(id)?.members[appId]?.state !== "joined") throw new Error("共有の権限がありません。");
        const source = s.files.get(key(`shared/${id}`, sharedPath));
        if (!source || source.deleted !== undefined || isReference(source)) throw new Error("共有ファイルがありません。");
        if (s.files.has(key(owner, path))) throw new Error("移動先にファイルがあります。");
        s.files.set(key(owner, path), { share: id, path: sharedPath, name: path.split("/").pop()!, size: source.size, created: now(), modified: source.modified });
      }, true);
    },
    filerShareOn(appId, owner, path, sharedPath) {
      pathCheck(path); pathCheck(sharedPath);
      if (path === "/" || sharedPath === "/") throw new Error("ファイルのパスにしてください。");
      return run(async (s) => {
        checkFilerOwner(s, appId, owner);
        const row = s.files.get(key(owner, path));
        if (!row || row.deleted !== undefined || isReference(row)) throw new Error("ファイルがありません。");
        const id = crypto.randomUUID();
        if (s.shares.has(id)) throw new Error("共有は既にあります。");
        const share: ShareRecord = { id, name: "shared", created: now(), creator: appId, members: { [appId]: { access: "write", state: "joined" } } };
        const sharedOwner = `shared/${id}`;
        await copyContent(owner, sharedOwner, row);
        s.shares.set(id, share);
        s.files.set(key(sharedOwner, sharedPath), { ...row, name: sharedPath.split("/").pop()!, modified: now() });
        s.files.set(key(owner, path), { share: id, path: sharedPath, name: row.name, size: row.size, created: row.created, modified: row.modified });
        return structuredClone(share);
      }, true);
    },
    filerShareRename(appId, owner, id, from, to) {
      pathCheck(from); pathCheck(to);
      if (from === "/" || to === "/") throw new Error("ファイルのパスにしてください。");
      return run((s) => {
        checkFilerOwner(s, appId, owner);
        const member = s.shares.get(id)?.members[appId];
        if (member?.state !== "joined" || member.access !== "write") throw new Error("共有への書き込み権限がありません。");
        const sharedOwner = `shared/${id}`, oldKey = key(sharedOwner, from), nextKey = key(sharedOwner, to);
        const row = s.files.get(oldKey);
        if (!row || row.deleted !== undefined || isReference(row)) throw new Error("共有ファイルがありません。");
        if (from === to) return;
        if (s.files.has(nextKey)) throw new Error("移動先にファイルがあります。");
        s.files.set(nextKey, { ...row, name: to.split("/").pop()!, modified: now() });
        s.files.delete(oldKey);
        for (const [fileKey, ref] of s.files) {
          const [fileOwner] = JSON.parse(fileKey) as [string, string];
          if (fileOwner === owner && isReference(ref) && ref.share === id && ref.path === from && ref.deleted === undefined) s.files.set(fileKey, { ...ref, path: to, modified: now() });
        }
      }, true);
    },
    filerShareDelete(appId, owner, id, path) {
      pathCheck(path);
      if (path === "/") throw new Error("ファイルのパスにしてください。");
      return run((s) => {
        checkFilerOwner(s, appId, owner);
        const member = s.shares.get(id)?.members[appId];
        if (member?.state !== "joined" || member.access !== "write") throw new Error("共有への書き込み権限がありません。");
        const sharedKey = key(`shared/${id}`, path), row = s.files.get(sharedKey);
        if (!row || row.deleted !== undefined || isReference(row)) throw new Error("共有ファイルがありません。");
        const date = now(); s.files.set(sharedKey, { ...row, deleted: date });
        for (const [fileKey, ref] of s.files) {
          const [fileOwner] = JSON.parse(fileKey) as [string, string];
          if (fileOwner === owner && isReference(ref) && ref.share === id && ref.path === path && ref.deleted === undefined) s.files.set(fileKey, { ...ref, deleted: date });
        }
      }, true);
    },
    filerShareOff(appId, owner, path) {
      pathCheck(path);
      return run(async (s) => {
        checkFilerOwner(s, appId, owner);
        const ref = s.files.get(key(owner, path));
        if (!ref || ref.deleted !== undefined || !isReference(ref)) throw new Error("共有参照がありません。");
        const member = s.shares.get(ref.share)?.members[appId];
        if (member?.state !== "joined" || member.access !== "write") throw new Error("共有への書き込み権限がありません。");
        const sharedOwner = `shared/${ref.share}`;
        const row = s.files.get(key(sharedOwner, ref.path));
        if (!row || row.deleted !== undefined || isReference(row)) throw new Error("共有ファイルがありません。");
        await copyContent(sharedOwner, owner, row);
        for (const [fileKey, other] of s.files) {
          const [fileOwner] = JSON.parse(fileKey) as [string, string];
          if (fileOwner === owner && isReference(other) && other.share === ref.share && other.path === ref.path && other.deleted === undefined) {
            s.files.set(fileKey, { ...row, name: other.name, created: other.created, modified: now() });
          }
        }
        s.files.delete(key(sharedOwner, ref.path));
      }, true);
    },
    moveShareFile(id, appId, owner, path, sharedPath, toShare) {
      pathCheck(path);
      pathCheck(sharedPath);
      if (path === "/" || sharedPath === "/") {
        throw new Error("ファイルのパスにしてください。");
      }
      return run(async (s) => {
        const member = s.shares.get(id)?.members[appId];
        if (member?.state !== "joined" || member.access !== "write") {
          throw new Error("共有への書き込み権限がありません。");
        }
        const owned = [...s.apps].some(([k, value]) => {
          const [p, a] = JSON.parse(k);
          const parent = currentId(s, k, value);
          return `_${p.toString(16)}/-${a.toString(16)}` === owner &&
            (appId === parent || appId.startsWith(`${parent}.`));
        });
        if (!owned) throw new Error("自分の保存領域だけを移動できます。");
        const shared = `shared/${id}`;
        const from = toShare ? owner : shared, to = toShare ? shared : owner;
        const fromPath = toShare ? path : sharedPath,
          toPath = toShare ? sharedPath : path;
        const row = s.files.get(key(from, fromPath));
        if (!row || row.deleted !== undefined || isReference(row)) {
          throw new Error("ファイルがありません。");
        }
        if (s.files.has(key(to, toPath))) {
          throw new Error("移動先にファイルがあります。");
        }
        for (const digest of [row.hash, ...row.history]) {
          const bytes = await content.read(`${from}/${digest}`);
          if (!bytes) throw new Error("ファイルの内容がありません。");
          if (!await content.read(`${to}/${digest}`)) {
            await content.write(`${to}/${digest}`, bytes);
          }
        }
        s.files.set(key(to, toPath), {
          ...row,
          name: toPath.split("/").pop()!,
          modified: now(),
        });
        s.files.delete(key(from, fromPath));
      }, true);
    },
    forOwner(owner) {
      if (
        !/^_[0-9a-f]+\/-[0-9a-f]+$/.test(owner) &&
        !/^shared\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(owner)
      ) throw new Error("Invalid storage owner.");
      const validate = (files: ReadonlyMap<string, Uint8Array>) => {
        const copy = new Map<string, Uint8Array>();
        for (const [path, value] of files) {
          pathCheck(path);
          if (path === "/") throw new Error("Expected a file path.");
          copy.set(path, value.slice());
        }
        return copy;
      };
      return {
        read(path) {
          pathCheck(path);
          return run((s) => read(s, owner, path));
        },
        readFiles(paths) {
          const requested = [...paths];
          requested.forEach(pathCheck);
          return run((s) =>
            Promise.all(requested.map((p) => read(s, owner, p)))
          );
        },
        write(path, value) {
          return this.writeFiles(new Map([[path, value]]));
        },
        writeFiles(files, remove = []) {
          const updates = validate(files);
          const deletions = [...remove];
          deletions.forEach(pathCheck);
          return run((s) => put(s, owner, updates, deletions), true);
        },
        list(prefix) {
          pathCheck(prefix);
          return run((s) =>
            [...s.files].filter(([k, r]) =>
              JSON.parse(k)[0] === owner && r.deleted === undefined && !isReference(r) &&
              within(JSON.parse(k)[1], prefix)
            ).map(([k]) => JSON.parse(k)[1] as string).sort()
          );
        },
        delete(path) {
          pathCheck(path);
          return run((s) => put(s, owner, new Map(), [path]), true);
        },
        update(path, transform) {
          pathCheck(path);
          return run(async (s) => {
            const value = transform(await read(s, owner, path));
            await put(s, owner, validate(new Map([[path, value]])));
          }, true);
        },
        metadata(path) {
          pathCheck(path);
          return run((s) => { const row = s.files.get(key(owner, path)); return row && !isReference(row) ? structuredClone(row) : undefined; });
        },
        restore(path, digest) {
          pathCheck(path);
          return run(async (s) => {
            const row = s.files.get(key(owner, path));
            if (!row || isReference(row)) throw new Error("File does not exist.");
            if (digest !== undefined && digest !== row.hash) {
              if (!row.history.includes(digest)) {
                throw new Error("Unknown historical content.");
              }
              row.history = [
                row.hash,
                ...row.history.filter((h) => h !== digest),
              ].slice(0, 10);
              row.hash = digest;
              row.size = (await content.read(`${owner}/${digest}`))!.length;
            }
            delete row.deleted;
            row.modified = now();
          }, true);
        },
        move(from, to) {
          pathCheck(from);
          pathCheck(to);
          if (to === "/") throw new Error("Expected a file path.");
          return run((s) => {
            const row = s.files.get(key(owner, from));
            if (!row || row.deleted !== undefined) {
              throw new Error("File does not exist.");
            }
            if (from === to) return;
            if (s.files.has(key(owner, to))) {
              throw new Error("Destination already exists.");
            }
            s.files.set(key(owner, to), {
              ...row,
              name: to.split("/").pop()!,
              modified: now(),
            });
            s.files.delete(key(owner, from));
          }, true);
        },
        replace(prefix, files) {
          pathCheck(prefix);
          const updates = validate(files);
          for (const path of updates.keys()) {
            if (!within(path, prefix)) {
              throw new Error("File outside replacement prefix.");
            }
          }
          return run(async (s) => {
            const removals = [...s.files.keys()].map((k) => JSON.parse(k))
              .filter(([o, p]) =>
                o === owner && within(p, prefix) && !updates.has(p)
              ).map(([, p]) => p);
            await put(s, owner, updates, removals);
          }, true);
        },
      };
    },
    appOwner(id, url, name) {
      const parsed = parseAppId(id, { allowHttp: true });
      id = formatAppId({ id: parsed.id, list: parsed.list }, {
        allowHttp: true,
      });
      url ??= parsed.list ?? "binette:system";
      if (url === "binette:bundled") url = "binette:system";
      name ??= url;
      return run((s) => {
        for (const [k, value] of s.apps) {
          if (currentId(s, k, value) === id) {
            const [p, a] = JSON.parse(k);
            return `_${p.toString(16)}/-${a.toString(16)}`;
          }
        }
        let provider = [...s.providers].find(([, p]) => p.url === url)?.[0];
        if (provider === undefined) {
          provider = s.counters.get("provider") ?? 1;
          s.counters.set("provider", provider + 1);
          s.providers.set(provider, { url: url!, name: name!, added: now() });
        }
        const counter = `app:${provider}`;
        const app = s.counters.get(counter) ?? 0;
        s.counters.set(counter, app + 1);
        s.apps.set(JSON.stringify([provider, app]), id);
        return `_${provider.toString(16)}/-${app.toString(16)}`;
      }, true);
    },
    registerProvider(url, name = url) {
      return run((s) => {
        const existing = [...s.providers].find(([, p]) => p.url === url);
        if (existing) return { number: existing[0], ...existing[1] };
        const number = s.counters.get("provider") ?? 1;
        s.counters.set("provider", number + 1);
        const provider = { url, name, added: now() };
        s.providers.set(number, provider);
        return { number, ...provider };
      }, true);
    },
    provider(url) {
      return run((s) => {
        const entry = [...s.providers].find(([number, p]) =>
          typeof url === "number" ? number === url : p.url === url
        );
        return entry ? { number: entry[0], ...entry[1] } : undefined;
      });
    },
    listApps() {
      return run((s) =>
        [...s.apps].map(([k, id]) => {
          const [p, a] = JSON.parse(k);
          return {
            id: currentId(s, k, id),
            owner: `_${p.toString(16)}/-${a.toString(16)}`,
            provider: { number: p, ...s.providers.get(p)! },
          };
        })
      );
    },
    findApp(id) {
      return run((s) => {
        for (const [k, value] of s.apps) {
          if (currentId(s, k, value) !== id) continue;
          const [p, a] = JSON.parse(k);
          return {
            id,
            owner: `_${p.toString(16)}/-${a.toString(16)}`,
            provider: { number: p, ...s.providers.get(p)! },
          };
        }
        return undefined;
      });
    },
    findAppByOwner(owner) {
      return run((s) => {
        for (const [k, value] of s.apps) {
          const [p, a] = JSON.parse(k);
          if (`_${p.toString(16)}/-${a.toString(16)}` !== owner) continue;
          return {
            id: currentId(s, k, value),
            owner,
            provider: { number: p, ...s.providers.get(p)! },
          };
        }
        return undefined;
      });
    },
    moveProvider(from, to) {
      return run((s) => {
        const existing = [...s.providers].find(([, p]) => p.url === to);
        const found = [...s.providers].find(([, p]) => p.url === from);
        if (!found) return;
        if (existing && existing[0] !== found[0]) {
          throw new Error("Provider already exists.");
        }
        found[1].url = to;
        const migrate = (id: string) => {
          const parsed = parseAppId(id, { allowHttp: true });
          return parsed.list === from
            ? formatAppId({ ...parsed, list: to }, { allowHttp: true })
            : id;
        };
        for (const share of s.shares.values()) {
          share.creator = migrate(share.creator);
          share.members = Object.fromEntries(
            Object.entries(share.members).map((
              [id, member],
            ) => [migrate(id), member]),
          );
        }
      }, true);
    },
    removeApp(id, immediate = false) {
      return run((s) => {
        for (const [shareId, share] of s.shares) {
          for (const member of Object.keys(share.members)) {
            const parsed = parseAppId(member, { allowHttp: true });
            const parent = formatAppId({ id: parsed.id, list: parsed.list }, {
              allowHttp: true,
            });
            if (member === id || parent === id) delete share.members[member];
          }
          if (!Object.values(share.members).some((m) => m.state === "joined")) {
            s.shares.delete(shareId);
            for (const k of s.files.keys()) {
              if (JSON.parse(k)[0] === `shared/${shareId}`) s.files.delete(k);
            }
          }
        }
        for (const [k, value] of s.apps) {
          if (currentId(s, k, value) !== id) continue;
          const [p, a] = JSON.parse(k);
          const owner = `_${p.toString(16)}/-${a.toString(16)}`;
          s.apps.delete(k);
          for (const file of s.files.keys()) {
            if (JSON.parse(file)[0] === owner) s.files.delete(file);
          }
          if (immediate) {
            (s.afterCommit ??= []).push(async () => {
              for (
                const file of await content.list()
              ) {
                if (file.startsWith(`${owner}/`)) await content.delete(file);
              }
            });
          }
        }
      }, true);
    },
    gc(date = now()) {
      return run((s) => {
        for (const [k, row] of s.files) {
          if (
            row.deleted !== undefined && date - row.deleted >= 30 * 86400000
          ) s.files.delete(k);
        }
        const live = new Set<string>();
        for (const [k, row] of s.files) {
          const [owner] = JSON.parse(k);
          if (isReference(row)) continue;
          for (const digest of [row.hash, ...row.history]) {
            live.add(`${owner}/${digest}`);
          }
        }
        (s.afterCommit ??= []).push(async () => {
          for (const file of await content.list()) {
            if (
              /^(?:_[0-9a-f]+\/-[0-9a-f]+|shared\/[A-Za-z0-9][A-Za-z0-9._-]*)\/[0-9a-f]{64}$/
                .test(file) && !live.has(file)
            ) {
              await content.delete(file);
            }
          }
        });
      }, true);
    },
    syncProviders() {
      return run(async (s) => {
        for (const [number, provider] of s.providers) {
          const path = `_${number.toString(16)}/provider.json`;
          const value = new TextEncoder().encode(JSON.stringify(provider));
          const existing = await content.read(path);
          if (
            !existing || existing.length !== value.length ||
            existing.some((byte, index) => byte !== value[index])
          ) await content.write(path, value);
        }
      });
    },
  };
  return api;
}
export interface StorageOptions {
  content?: ContentStore;
  now?: () => number;
}
export function createMemoryStorage(
  options: StorageOptions = {},
): StorageBackend {
  let state = emptyState();
  let pending = Promise.resolve();
  return backend(
    {
      run<T>(action: (state: State) => T | Promise<T>, write: boolean) {
        const result = pending.then(async () => {
          const next = structuredClone(state);
          const value = await action(next);
          const after = next.afterCommit ?? [];
          delete next.afterCommit;
          if (write) state = next;
          for (const action of after) await action();
          return value;
        });
        pending = result.then(() => {}, () => {});
        return result;
      },
    },
    options.content ?? createMemoryContentStore(),
    options.now ?? Date.now,
  );
}
export interface IndexedDbStorageOptions extends StorageOptions {
  name?: string;
}
export function createIndexedDbStorage(
  options: IndexedDbStorageOptions = {},
): StorageBackend {
  const name = options.name ?? "binette-apps";
  let opening: Promise<IDBDatabase> | undefined;
  let initialProvider: Omit<ProviderRecord, "number"> | undefined;
  let pending = Promise.resolve();
  const open = () =>
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 6);
      request.onupgradeneeded = (event) => {
        const db = request.result;
        if (event.oldVersion > 0 && event.oldVersion < 4) {
          for (const store of [...db.objectStoreNames]) {
            db.deleteObjectStore(store);
          }
        }
        for (
          const store of [
            "providers",
            "apps",
            "files",
            "counters",
            "appIds",
            "shares",
          ]
        ) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
        }
        const providers = request.transaction!.objectStore("providers");
        if (!providers.indexNames.contains("url")) {
          providers.createIndex("url", "url", { unique: true });
        }
        const cursor = request.transaction!.objectStore("apps").openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) {
            return;
          }
          request.transaction!.objectStore("appIds").put(row.key, [
            (row.key as number[])[0],
            parseAppId(row.value, { allowHttp: true }).id,
          ]);
          row.continue();
        };
        if (event.oldVersion < 4) {
          const state = emptyState();
          initialProvider = state.providers.get(0);
          for (const [k, v] of state.providers) providers.put(v, k);
          for (const [k, v] of state.counters) {
            request.transaction!.objectStore("counters").put(v, k);
          }
        }
      };
      request.onerror = () => {
        opening = undefined;
        reject(request.error);
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          opening = undefined;
        };
        resolve(db);
      };
    });
  type Store = "providers" | "apps" | "files" | "counters" | "shares";
  type Selection = { store: Store; query?: IDBValidKey | IDBKeyRange };
  async function load(
    db: IDBDatabase,
    selections: Selection[],
  ): Promise<State> {
    const state: State = {
      shares: new Map(),
      providers: new Map(),
      apps: new Map(),
      files: new Map(),
      counters: new Map(),
    };
    await Promise.all(
      selections.map(({ store, query }) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(store, "readonly");
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
          const table = tx.objectStore(store);
          if (query !== undefined && !(query instanceof IDBKeyRange)) {
            const request = table.get(query);
            request.onsuccess = () => {
              if (request.result === undefined) return;
              const k = store === "apps" || store === "files"
                ? JSON.stringify(query)
                : query;
              (state[store] as Map<unknown, unknown>).set(k, request.result);
            };
          } else {
            const request = table.openCursor(query);
            request.onsuccess = () => {
              const cursor = request.result;
              if (!cursor) return;
              const k = store === "apps" || store === "files"
                ? JSON.stringify(cursor.key)
                : cursor.key;
              (state[store] as Map<unknown, unknown>).set(k, cursor.value);
              cursor.continue();
            };
          }
        })
      ),
    );
    return state;
  }
  async function save(db: IDBDatabase, before: State, state: State) {
    const changed =
      (["providers", "apps", "files", "counters", "shares"] as const)
        .filter((store) =>
          JSON.stringify([...before[store]]) !==
            JSON.stringify([...state[store]])
        );
    if (!changed.length) return;
    const stores: string[] = [...changed];
    if (changed.includes("apps")) stores.push("appIds");
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(stores, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
      for (const store of changed) {
        const table = tx.objectStore(store);
        for (const [k, old] of before[store]) {
          if (state[store].has(k as never)) continue;
          table.delete(
            store === "apps" || store === "files" ? JSON.parse(String(k)) : k,
          );
          if (store === "apps") {
            tx.objectStore("appIds").delete([
              JSON.parse(String(k))[0],
              parseAppId(String(old), { allowHttp: true }).id,
            ]);
          }
        }
        for (const [k, value] of state[store]) {
          if (
            JSON.stringify(before[store].get(k as never)) ===
              JSON.stringify(value)
          ) continue;
          const idbKey = store === "apps" || store === "files"
            ? JSON.parse(String(k))
            : k;
          table.put(value, idbKey);
          if (store === "apps") {
            tx.objectStore("appIds").put(idbKey, [
              idbKey[0],
              parseAppId(String(value), { allowHttp: true }).id,
            ]);
          }
        }
      }
    });
  }
  async function lookup(
    db: IDBDatabase,
    store: string,
    key: IDBValidKey,
    index?: string,
  ): Promise<IDBValidKey | undefined> {
    return await new Promise((resolve, reject) => {
      const table = db.transaction(store, "readonly").objectStore(store);
      const request = index ? table.index(index).getKey(key) : table.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  const contentStore = options.content ??
    createOpfsContentStore(name === "binette-apps" ? undefined : name);
  const clock = options.now ?? Date.now;
  const range = (owner: string, prefix = "/"): Selection[] =>
    prefix === "/"
      ? [{
        store: "files",
        query: IDBKeyRange.bound([owner], [owner, []], false, true),
      }]
      : [{ store: "files", query: [owner, prefix] }, {
        store: "files",
        query: IDBKeyRange.bound(
          [owner, `${prefix}/`],
          [owner, `${prefix}0`],
          false,
          true,
        ),
      }];
  // Arguments are validated by the typed backend before dynamic method dispatch.
  function execute(
    method: string,
    // deno-lint-ignore no-explicit-any
    args: any[],
    owner?: string,
  ): Promise<unknown> {
    const task = async () => {
      if (method === "findApp") {
        try {
          parseAppId(args[0], { allowHttp: true });
        } catch {
          return undefined;
        }
      }
      const db = await open();
      if (initialProvider) {
        const value = new TextEncoder().encode(JSON.stringify(initialProvider));
        await contentStore.write("_0/provider.json", value).then(() => {
          initialProvider = undefined;
        }, () => {});
      }
      if (owner === undefined && method === "syncProviders") {
        let previous: IDBValidKey | undefined;
        while (true) {
          const entry = await new Promise<
            | { key: IDBValidKey; value: Omit<ProviderRecord, "number"> }
            | undefined
          >((resolve, reject) => {
            const tx = db.transaction("providers", "readonly");
            tx.onabort = () => reject(tx.error);
            const request = tx.objectStore("providers").openCursor(
              previous === undefined
                ? undefined
                : IDBKeyRange.lowerBound(previous, true),
            );
            request.onsuccess = () =>
              resolve(
                request.result
                  ? { key: request.result.key, value: request.result.value }
                  : undefined,
              );
          });
          if (!entry) return;
          previous = entry.key;
          const path = `_${Number(entry.key).toString(16)}/provider.json`;
          const value = new TextEncoder().encode(JSON.stringify(entry.value));
          const existing = await contentStore.read(path);
          if (
            !existing || existing.length !== value.length ||
            existing.some((byte, index) => byte !== value[index])
          ) await contentStore.write(path, value);
        }
      }
      if (owner === undefined && method === "listApps") {
        return await new Promise((resolve, reject) => {
          const result: {
            id: string;
            owner: string;
            provider: ProviderRecord;
          }[] = [];
          const tx = db.transaction(["apps", "providers"], "readonly");
          tx.onabort = () => reject(tx.error);
          tx.oncomplete = () => resolve(result);
          const request = tx.objectStore("apps").openCursor();
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            const [number, app] = cursor.key as number[];
            const id = parseAppId(cursor.value, { allowHttp: true }).id;
            const provider = tx.objectStore("providers").get(number);
            provider.onsuccess = () => {
              const row = provider.result as Omit<ProviderRecord, "number">;
              result.push({
                id: formatAppId({
                  id,
                  ...(row.url.startsWith("binette:") ? {} : { list: row.url }),
                }, { allowHttp: true }),
                owner: `_${number.toString(16)}/-${app.toString(16)}`,
                provider: { number, ...row },
              });
              cursor.continue();
            };
          };
        });
      }
      let selections: Selection[] = [];
      if (owner !== undefined) {
        if (method === "list" || method === "replace") {
          selections = range(owner, args[0]);
        } else {
          const paths = method === "readFiles"
            ? args[0]
            : method === "writeFiles"
            ? [...args[0].keys(), ...(args[1] ?? [])]
            : method === "move"
            ? args
            : [args[0]];
          selections = paths.map((path: string) => ({
            store: "files",
            query: [owner, path],
          }));
        }
      } else if (method.includes("Share")) {
        selections = [{ store: "shares" }, { store: "files" }];
      } else if (method === "gc") selections = [{ store: "files" }];
      else if (method === "findAppByOwner") {
        const matched = /^_([0-9a-f]+)\/-([0-9a-f]+)$/.exec(args[0]);
        if (!matched) return undefined;
        const provider = parseInt(matched[1], 16);
        const app = parseInt(matched[2], 16);
        selections = [{ store: "providers", query: provider }, {
          store: "apps",
          query: [provider, app],
        }];
      } else {
        const urls = method === "moveProvider" ? args : [
          method === "appOwner" || method === "removeApp" ||
            method === "findApp"
            ? (args[1] && method === "appOwner"
              ? args[1]
              : parseAppId(args[0], { allowHttp: true }).list ??
                "binette:system")
            : args[0],
        ];
        if (method === "appOwner") {
          const idProvider = parseAppId(args[0], { allowHttp: true }).list ??
            "binette:system";
          if (!urls.includes(idProvider)) urls.unshift(idProvider);
        }
        const numbers: number[] = [];
        for (let url of urls) {
          if (url === "binette:bundled") url = "binette:system";
          const number = typeof url === "number"
            ? url
            : await lookup(db, "providers", url, "url") as number | undefined;
          if (number !== undefined) {
            numbers.push(number);
            selections.push({ store: "providers", query: number });
          }
        }
        if (method === "appOwner" || method === "registerProvider") {
          selections.push({ store: "counters", query: "provider" });
        }
        if (
          method === "appOwner" || method === "removeApp" ||
          method === "findApp"
        ) {
          const parsed = parseAppId(args[0], { allowHttp: true });
          for (const number of numbers) {
            if (method === "appOwner") {
              selections.push({ store: "counters", query: `app:${number}` });
            }
            const appKey = await lookup(db, "appIds", [number, parsed.id]) as
              | number[]
              | undefined;
            if (appKey) {
              selections.push({ store: "apps", query: appKey });
              if (method === "removeApp") {
                selections.push(
                  ...range(
                    `_${number.toString(16)}/-${appKey[1].toString(16)}`,
                  ),
                );
              }
            }
          }
        }
      }
      if (
        owner === undefined &&
        (method.includes("Share") || method === "removeApp")
      ) {
        selections.push({ store: "shares" }, { store: "files" });
        if (method === "moveShareFile" || method.startsWith("filerShare")) {
          selections.push({ store: "apps" }, { store: "providers" });
        }
      }
      if (method === "moveProvider") selections.push({ store: "shares" });
      const state = await load(db, selections);
      const before = structuredClone(state);
      const local = backend(
        {
          run: async (action, write) => {
            const result = await action(state);
            if (write) await save(db, before, state);
            for (const action of state.afterCommit ?? []) await action();
            if (write) {
              for (const [number, provider] of state.providers) {
                if (
                  JSON.stringify(before.providers.get(number)) !==
                    JSON.stringify(provider)
                ) {
                  await contentStore.write(
                    `_${number.toString(16)}/provider.json`,
                    new TextEncoder().encode(JSON.stringify(provider)),
                  ).catch(() => {});
                }
              }
            }
            return result;
          },
        },
        contentStore,
        clock,
      );
      const target = owner === undefined ? local : local.forOwner(owner);
      return await Reflect.apply(Reflect.get(target, method), target, args);
    };
    const locked = () =>
      globalThis.navigator?.locks
        ? navigator.locks.request(`binette-storage:${name}`, task)
        : task();
    const result = pending.then(locked);
    pending = result.then(() => {}, () => {});
    return result;
  }
  const resultBackend = new Proxy({} as StorageBackend, {
    get: (_, method: string) =>
      method === "then"
        ? undefined
        : method === "forOwner"
        ? (owner: string) => {
          // Validate the owner immediately, as the memory backend does.
          backend(
            {
              run: () => {
                throw new Error("Unexpected operation.");
              },
            },
            contentStore,
            clock,
          ).forOwner(owner);
          const validator = backend(
            { run: <T>() => Promise.resolve(undefined as T) },
            contentStore,
            clock,
          ).forOwner(owner);
          return new Proxy({} as OwnerStorage, {
            get: (_, operation: string) =>
              operation === "then"
                ? undefined
                : (...args: Parameters<typeof execute>[1]) => {
                  Reflect.apply(
                    Reflect.get(validator, operation),
                    validator,
                    args,
                  );
                  if (operation === "write") args[1] = args[1].slice();
                  if (operation === "writeFiles" || operation === "replace") {
                    const index = operation === "replace" ? 1 : 0;
                    args[index] = new Map(
                      [...args[index]].map((
                        [path, value]: [string, Uint8Array],
                      ) => [path, value.slice()]),
                    );
                    if (operation === "writeFiles" && args[1]) {
                      args[1] = [...args[1]];
                    }
                  }
                  if (operation === "readFiles") args[0] = [...args[0]];
                  return execute(operation, args, owner);
                },
          });
        }
        : method === "shareFiles"
        ? (id: string, appId: string) =>
          checkedShareFiles(resultBackend, id, appId)
        : (...args: Parameters<typeof execute>[1]) => execute(method, args),
  });
  return resultBackend;
}

/** Check membership and access for every shared file operation. */
function checkedShareFiles(
  storage: StorageBackend,
  id: string,
  appId: string,
): OwnerStorage {
  return new Proxy({} as OwnerStorage, {
    get(_, operation: keyof OwnerStorage) {
      if (String(operation) === "then") return undefined;
      return (...args: unknown[]) => {
        if (operation === "write") args[1] = (args[1] as Uint8Array).slice();
        if (operation === "readFiles") args[0] = [...args[0] as string[]];
        if (operation === "writeFiles" || operation === "replace") {
          const index = operation === "replace" ? 1 : 0;
          args[index] = new Map(
            [...(args[index] as ReadonlyMap<string, Uint8Array>)].map((
              [path, bytes],
            ) => [path, bytes.slice()]),
          );
          if (operation === "writeFiles" && args[1]) {
            args[1] = [...args[1] as string[]];
          }
        }
        return storage.accessShareFile(id, appId, operation, args);
      };
    },
  });
}
