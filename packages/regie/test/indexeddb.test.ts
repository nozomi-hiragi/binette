import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { createMemoryContentStore, createMemoryStorage, createIndexedDbStorage, type OwnerStorage } from "../src/storage.ts";
import { createIndexedDbFileTree } from "../src/fs.ts";
import { createIndexedDbAppStore, createIndexedDbPigeonStore, appId, type InstalledApp } from "../src/index.ts";

/** Deno に無い IndexedDB の要求・トランザクション・版更新の境界を代用する。 */
function databaseFixture(installed: InstalledApp, initialVersion = 1, system = new Map<string, unknown>()) {
  const tables = new Map<string, Map<string, unknown>>([["apps", new Map([[installed.key, structuredClone(installed)]])]]);
  if (initialVersion >= 2) tables.set("system", structuredClone(system));
  let version = initialVersion;
  let tail = Promise.resolve();
  let writeFailure: Error | undefined;
  let writesBeforeFailure = 0;
  const opened: number[] = [];
  const operations: { transaction: number; mode: string; store: string; method: string; key?: unknown }[] = [];
  const transactions: { stores: string[]; mode: string }[] = [];
  const indexes = new Map<string, Map<string, string | string[]>>();
  const transaction = (stores: string | string[] = [], mode = stores.length ? "readonly" : "versionchange") => {
    const id = transactions.push({ stores: typeof stores === "string" ? [stores] : stores, mode });
    const before = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    let values: typeof tables;
    let pending = 0;
    let finished = false;
    const tx = {
      error: null as Error | null,
      oncomplete: undefined as (() => void) | undefined,
      onabort: undefined as (() => void) | undefined,
      onerror: undefined as (() => void) | undefined,
      abort() {
        if (finished) return;
        finished = true;
        tx.onabort?.();
        release();
      },
      objectStore(name: string) {
        const request = (action: () => unknown, write = false) => {
          pending++;
          const result = { result: undefined as unknown, error: null as Error | null, onsuccess: undefined as (() => void) | undefined };
          void before.then(() => {
            if (finished) return;
            values ??= structuredClone(tables);
            try {
              if (write && writeFailure && writesBeforeFailure-- === 0) { const error = writeFailure; writeFailure = undefined; throw error; }
              result.result = action();
              result.onsuccess?.();
            } catch (error) {
              tx.error = result.error = error as Error;
              tx.abort();
              return;
            }
            if (--pending === 0) queueMicrotask(() => {
              if (pending || finished) return;
              finished = true;
              tables.clear();
              for (const [key, table] of values) tables.set(key, table);
              tx.oncomplete?.();
              release();
            });
          });
          return result;
        };
        const track = (method: string, key?: unknown) => {
          operations.push({ transaction: id, mode, store: name, method, key: structuredClone(key) });
        };
        const matches = (key: unknown, range?: unknown): boolean => {
          if (range === undefined || range === null) return true;
          if (typeof range === "object" && "includes" in range) return (range as { includes(key: unknown): boolean }).includes(key);
          return JSON.stringify(key) === JSON.stringify(range);
        };
        const compare = (a: unknown, b: unknown): number => {
          if (Array.isArray(a) && Array.isArray(b)) {
            for (let i = 0; i < Math.min(a.length, b.length); i++) { const result = compare(a[i], b[i]); if (result) return result; }
            return a.length - b.length;
          }
          if (Array.isArray(a)) return 1;
          if (Array.isArray(b)) return -1;
          return a === b ? 0 : a! < b! ? -1 : 1;
        };
        const openCursor = (range?: unknown, indexName?: string) => {
          track(indexName ? `index:${indexName}:openCursor` : "openCursor", range);
          let keys: string[] | undefined;
          let position = 0;
          const cursor = (): unknown => {
            const key = keys![position++];
            return key === undefined ? null : {
              key: JSON.parse(key), primaryKey: JSON.parse(key), value: structuredClone(values.get(name)!.get(key)),
              continue() { request(() => { cursorRequest.result = cursor(); cursorRequest.onsuccess?.(); }); },
              delete() { track("delete", JSON.parse(key)); return request(() => values.get(name)!.delete(key), true); },
            };
          };
          const cursorRequest = request(() => {
            keys = [...values.get(name)!.keys()].filter(key => {
              let candidate: unknown = JSON.parse(key);
              if (indexName) {
                const path = indexes.get(name)!.get(indexName)!;
                const row = values.get(name)!.get(key) as Record<string, unknown>;
                candidate = Array.isArray(path) ? path.map(part => row[part]) : row[path];
              }
              return matches(candidate, range);
            }).sort((a, b) => compare(JSON.parse(a), JSON.parse(b)));
            return cursor();
          });
          return cursorRequest;
        };
        return {
          createIndex(indexName: string, path: string | string[]) { const definitions = indexes.get(name) ?? new Map(); definitions.set(indexName, path); indexes.set(name, definitions); },
          indexNames: { contains: (indexName: string) => indexes.get(name)?.has(indexName) ?? false },
          index(indexName: string) { return {
            openCursor: (range?: unknown) => openCursor(range, indexName),
            getKey(key: unknown) {
              track(`index:${indexName}:getKey`, key);
              return request(() => {
                const path = indexes.get(name)!.get(indexName)!;
                const found = [...values.get(name)!].find(([, value]) => {
                  const row = value as Record<string, unknown>;
                  return matches(Array.isArray(path) ? path.map(part => row[part]) : row[path], key);
                });
                return found ? JSON.parse(found[0]) : undefined;
              });
            },
            get(key: unknown) {
              track(`index:${indexName}:get`, key);
              return request(() => {
                const path = indexes.get(name)!.get(indexName)!;
                return structuredClone([...values.get(name)!.values()].find(value => {
                  const row = value as Record<string, unknown>;
                  return matches(Array.isArray(path) ? path.map(part => row[part]) : row[path], key);
                }));
              });
            },
          }; },
          clear: () => { track("clear"); return request(() => { values.get(name)!.clear(); }, true); },
          get: (key: unknown) => { track("get", key); return request(() => structuredClone(values.get(name)!.get(JSON.stringify(key)))); },
          getAll: () => { track("getAll"); return request(() => structuredClone([...values.get(name)!.values()])); },
          getAllKeys: () => { track("getAllKeys"); return request(() => [...values.get(name)!.keys()].sort()); },
          put: (value: unknown, key?: unknown) => {
            track("put", key ?? (value as InstalledApp).key);
            const copy = structuredClone(value);
            return request(() => { const at = key ?? (copy as InstalledApp).key; values.get(name)!.set(JSON.stringify(at), copy); return at; }, true);
          },
          delete: (key: unknown) => { track("delete", key); return request(() => { values.get(name)!.delete(JSON.stringify(key)); }, true); },
          openCursor,

        };
      },
    };
    return tx;
  };
  let upgrade: ReturnType<typeof transaction> | undefined;
  const db = {
    objectStoreNames: { contains: (name: string) => tables.has(name), [Symbol.iterator]: () => tables.keys() },
    deleteObjectStore(name: string) { tables.delete(name); },
    createObjectStore(name: string) {
      if (tables.has(name)) throw new Error("表はすでにあります。");
      tables.set(name, new Map());
      return upgrade!.objectStore(name);
    },
    close() {},
    transaction,
  };
  return {
    tables, opened, operations, transactions, content: createMemoryContentStore(),
    failNextWrite(error: Error, after = 0) { writeFailure = error; writesBeforeFailure = after; },
    factory: { open(_name: string, next: number) {
      opened.push(next);
      const request = {
        result: db, transaction: undefined as ReturnType<typeof transaction> | undefined,
        onupgradeneeded: undefined as ((event: { oldVersion: number }) => void) | undefined,
        onsuccess: undefined as (() => void) | undefined,
        onerror: undefined as (() => void) | undefined,
      };
      queueMicrotask(() => {
        if (next > version) {
          request.transaction = upgrade = transaction();
          request.transaction.oncomplete = () => { version = next; request.onsuccess?.(); };
          request.onupgradeneeded?.({ oldVersion: version });
        } else request.onsuccess?.();
      });
      return request;
    } } as unknown as IDBFactory,
  };
}

const installed: InstalledApp = {
  key: appId("https://example.test/apps/", "a"), source: "https://example.test/apps/", manifest: { id: "a", name: "A", entry: { html: "index.html", as: "main.ts" } },
  html: "<p>以前のアプリ</p>", wasm: new Uint8Array([1, 2, 3]), icon: undefined, installedAt: 1,
};

async function withDatabase(fixture: ReturnType<typeof databaseFixture>, test: () => Promise<void>) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const rangeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "IDBKeyRange");
  const compare = (a: unknown, b: unknown): number => {
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let i = 0; i < Math.min(a.length, b.length); i++) { const result = compare(a[i], b[i]); if (result) return result; }
      return a.length - b.length;
    }
    if (Array.isArray(a)) return 1;
    if (Array.isArray(b)) return -1;
    return a === b ? 0 : a! < b! ? -1 : 1;
  };
  class Range {
    constructor(readonly lower: unknown, readonly upper: unknown, readonly lowerOpen = false, readonly upperOpen = false) {}
    includes(key: unknown) {
      const lower = this.lower === undefined ? 1 : compare(key, this.lower);
      const upper = this.upper === undefined ? -1 : compare(key, this.upper);
      return (lower > 0 || lower === 0 && !this.lowerOpen) && (upper < 0 || upper === 0 && !this.upperOpen);
    }
    static bound(lower: unknown, upper: unknown, lowerOpen = false, upperOpen = false) { return new Range(lower, upper, lowerOpen, upperOpen); }
    static lowerBound(lower: unknown, open = false) { return new Range(lower, undefined, open); }
    static only(value: unknown) { return new Range(value, value); }
  }
  Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: Range });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fixture.factory });
  try { await test(); } finally {
    if (rangeDescriptor) Object.defineProperty(globalThis, "IDBKeyRange", rangeDescriptor);
    else Reflect.deleteProperty(globalThis, "IDBKeyRange");
    if (descriptor) Object.defineProperty(globalThis, "indexedDB", descriptor);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  }
}

for (const version of [1, 2]) Deno.test(`IndexedDB resets v${version} storage and preserves newly installed apps across connections`, async () => {
  const record = { state: 4, done: false, page: "ページ", reason: { kind: 1, cause: 2 } };
  const settings = { stackSize: 2, historyLimit: 2, roles: { home: installed.key } };
  const fixture = databaseFixture(installed, version, new Map<string, unknown>([
    [`last:${installed.key}`, record], ["settings", settings], ["launches", [{ time: 0, app: installed.key }]],
  ]));
  await withDatabase(fixture, async () => {
    const store = createIndexedDbAppStore({ content: fixture.content });
    assertEquals(fixture.opened, []);
    assertEquals(await store.get(installed.key), undefined);
    assertEquals(fixture.opened, [5]);
    await store.put(installed);
    assertEquals(fixture.tables.has("files"), true);
    const tree = createIndexedDbFileTree({ content: fixture.content });
    const owner = tree.storage!.forOwner(await tree.storage!.appOwner(installed.key, installed.source));
    const recordPath = "/build/record.json";
    const wasmPath = "/build/app.wasm";
    const { wasm, ...metadata } = installed;
    assertEquals(JSON.parse(new TextDecoder().decode(await owner.read(recordPath))), JSON.parse(JSON.stringify(metadata)));
    assertEquals(await owner.read(wasmPath), wasm);
    assertEquals(await tree.list("/apps"), []);
    assertEquals(await store.system.getLast(installed.key), undefined);
    assertEquals(await store.system.getSettings(), undefined);
    assertEquals(await store.system.listLaunches(), []);
    await store.system.putLast(installed.key, record);
    await store.system.putSettings(settings);
    const reopened = createIndexedDbAppStore({ content: fixture.content });
    assertEquals(await reopened.list(), [installed]);
    await Promise.all([1, 2, 3].map(time => (time === 2 ? reopened : store).system.recordLaunch({ time, app: installed.key }, 2)));
    assertEquals(await reopened.list(), [installed]);
    assertEquals(await reopened.system.getLast(installed.key), record);
    assertEquals(await reopened.system.getSettings(), settings);
    assertEquals(await reopened.system.listLaunches(), [{ time: 2, app: installed.key }, { time: 3, app: installed.key }]);
    await reopened.put({ ...installed, html: "更新" });
    assertEquals((await store.get(installed.key))!.html, "更新");
    assertEquals(await store.system.getLast("missing"), undefined);
    await assertRejects(() => store.system.putSettings({ stackSize: 0 }), Error, "範囲外");
    const error = new Error("保存失敗");
    fixture.failNextWrite(error, 1);
    await assertRejects(() => reopened.put({ ...installed, html: "失敗する更新", wasm: new Uint8Array([9]) }), Error, "保存失敗");
    assertEquals(await store.get(installed.key), { ...installed, html: "更新" });
    assertEquals(await owner.read(wasmPath), wasm);
    assertEquals(await tree.read("/data/apps/index.json"), undefined);
  });
});

Deno.test("IndexedDB persists file updates across connections and rolls back failed system replacements", async () => {
  const fixture = databaseFixture(installed);
  await withDatabase(fixture, async () => {
    const tree = createIndexedDbFileTree({ content: fixture.content });
    await tree.replaceSystem(new Map([["/system/apps/a", new Uint8Array([1])]]));
    await tree.write("/user/apps/a", new Uint8Array([2]));
    const reopened = createIndexedDbFileTree({ content: fixture.content });
    assertEquals(await reopened.readOverlay("/apps/a"), new Uint8Array([2]));
    fixture.failNextWrite(new Error("置換失敗"), 1);
    await assertRejects(() => tree.replaceSystem(new Map([["/system/apps/b", new Uint8Array([3])]])), Error, "置換失敗");
    assertEquals(await reopened.read("/system/apps/a"), new Uint8Array([1]));
    assertEquals(await reopened.read("/system/apps/b"), undefined);
    assertEquals(await reopened.read("/user/apps/a"), new Uint8Array([2]));
    fixture.failNextWrite(new Error("複数保存失敗"), 1);
    await assertRejects(() => tree.writeFiles(new Map([
      ["/user/apps/a", new Uint8Array([9])], ["/data/new", new Uint8Array([8])],
    ])), Error, "複数保存失敗");
    assertEquals(await reopened.read("/user/apps/a"), new Uint8Array([2]));
    assertEquals(await reopened.read("/data/new"), undefined);
    await Promise.all([tree, reopened, tree].map(target => target.update("/data/count", value => new Uint8Array([(value?.[0] ?? 0) + 1]))));
    assertEquals(await tree.read("/data/count"), new Uint8Array([3]));
    const data = (await tree.read("/data/count"))!;
    data[0] = 99;
    assertEquals(await tree.read("/data/count"), new Uint8Array([3]));
    await reopened.delete("/user/apps/a");
    assertEquals(await tree.readOverlay("/apps/a"), new Uint8Array([1]));
    assertEquals(await tree.list("/system/apps"), ["/system/apps/a"]);
  });
});

Deno.test("IndexedDB reads a single generation while other connections replace multiple files", async () => {
  const fixture = databaseFixture(installed);
  await withDatabase(fixture, async () => {
    const writer = createIndexedDbFileTree({ content: fixture.content });
    const reader = createIndexedDbFileTree({ content: fixture.content });
    const paths = ["/data/first", "/data/second"];
    await writer.writeFiles(new Map(paths.map(path => [path, new Uint8Array([0])])));
    await reader.readFiles(paths);
    const reads: Promise<(Uint8Array | undefined)[]>[] = [];
    const writes: Promise<void>[] = [];
    for (let generation = 1; generation <= 5; generation++) {
      reads.push(reader.readFiles(paths));
      writes.push(writer.writeFiles(new Map(paths.map(path => [path, new Uint8Array([generation])]))));
    }
    const snapshots = await Promise.all(reads);
    await Promise.all(writes);
    for (const snapshot of snapshots) assertEquals(snapshot[0], snapshot[1]);
    assertEquals(await reader.readFiles(paths), [new Uint8Array([5]), new Uint8Array([5])]);
  });
});

Deno.test("Provider moves change the registry URL atomically and preserve owner data and OS records", async () => {
  const fixture = databaseFixture(installed);
  await withDatabase(fixture, async () => {
    const store = createIndexedDbAppStore({ content: fixture.content });
    const app = { ...installed, source: "https://old.test/apps/", key: "https://old.test/apps/#memo", manifest: { ...installed.manifest, id: "memo", sub: { "日本語": { name: "子" } } } };
    await store.put(app);
    const next = "https://new.test/apps/";
    const oldSub = app.key + ".%E6%97%A5%E6%9C%AC%E8%AA%9E";
    await store.system.putLists([{ url: app.source }]);
    await store.system.putSettings({ roles: { home: oldSub } });
    await store.data.write(app.key, "値", "内容");
    await store.system.putPermissions(app.key, ["fs"]);
    const record = { state: 3, done: true, page: "ページ", reason: { kind: 1, cause: 2 } };
    await store.system.putLast(oldSub, record);
    fixture.failNextWrite(new Error("移転失敗"));
    await assertRejects(() => store.moveSource(app.source, next, [{ url: next }]), Error, "移転失敗");
    assertEquals(await store.get(app.key), app);
    assertEquals(await store.get(next + "#memo"), undefined);
    assertEquals(await store.system.getLists(), [{ url: app.source }]);
    assertEquals(await store.data.read(app.key), new Map([["値", "内容"]]));
    await store.moveSource(app.source, next, [{ url: next }]);
    const reopened = createIndexedDbAppStore({ content: fixture.content });
    assertEquals(await reopened.get(app.key), undefined);
    assertEquals((await reopened.get(next + "#memo"))?.source, next);
    assertEquals(await reopened.system.getLists(), [{ url: next }]);
    assertEquals(await reopened.data.read(app.key), new Map());
    assertEquals(await reopened.data.read(next + "#memo"), new Map([["値", "内容"]]));
    assertEquals(await reopened.system.getLast(next + "#memo.%E6%97%A5%E6%9C%AC%E8%AA%9E"), record);
    assertEquals((await reopened.system.getSettings())?.roles, { home: next + "#memo.%E6%97%A5%E6%9C%AC%E8%AA%9E" });
    assertEquals(await reopened.system.getPermissions(next + "#memo"), ["fs"]);
  });
});

Deno.test("IndexedDB single-file operations touch only the requested metadata and do not rewrite providers", async () => {
  const fixture = databaseFixture(installed);
  const contentWrites: string[] = [];
  const writeContent = fixture.content.write.bind(fixture.content);
  fixture.content.write = (key, value) => { contentWrites.push(key); return writeContent(key, value); };
  await withDatabase(fixture, async () => {
    const tree = createIndexedDbFileTree({ content: fixture.content });
    const storage = tree.storage!;
    const other = storage.forOwner(await storage.appOwner("https://other.test/#other", "https://other.test/"));
    await other.write("/unrelated", new Uint8Array([7]));
    await tree.writeFiles(new Map([
      ["/data/target", new Uint8Array([1])], ["/data/unrelated", new Uint8Array([2])],
    ]));
    const unrelated = structuredClone([...fixture.tables.get("files")!].filter(([key]) => !key.includes("/data/target")));
    fixture.operations.length = 0;
    contentWrites.length = 0;
    await tree.write("/data/target", new Uint8Array([3]));
    assertEquals([...fixture.tables.get("files")!].filter(([key]) => !key.includes("/data/target")), unrelated);
    assertEquals(fixture.operations.filter(operation => operation.method === "clear" || operation.method === "getAll" || operation.method === "getAllKeys"), []);
    assertEquals(fixture.operations.filter(operation => operation.method === "openCursor" && operation.key === undefined), []);
    assertEquals(fixture.operations.filter(operation => operation.method === "put" || operation.method === "delete").map(operation => [operation.store, operation.key]), [["files", ["_0/-0", "/data/target"]]]);
    assertEquals(contentWrites.filter(key => key.endsWith("provider.json")), []);
    fixture.operations.length = 0;
    assertEquals(await tree.read("/data/target"), new Uint8Array([3]));
    assertEquals(fixture.operations.filter(operation => operation.store === "files").map(operation => [operation.method, operation.key]), [["get", ["_0/-0", "/data/target"]]]);
  });
});

Deno.test("IndexedDB batch writes and system replacement commit metadata in one transaction with bounded prefix scans", async () => {
  const fixture = databaseFixture(installed);
  await withDatabase(fixture, async () => {
    const tree = createIndexedDbFileTree({ content: fixture.content });
    await tree.write("/data/untouched", new Uint8Array([7]));
    fixture.operations.length = 0;
    await tree.writeFiles(new Map([["/data/a", new Uint8Array([1])], ["/data/b", new Uint8Array([2])]]));
    const writes = fixture.operations.filter(operation => operation.mode === "readwrite");
    assertEquals(new Set(writes.map(operation => operation.transaction)).size, 1);
    assertEquals(writes.filter(operation => operation.method === "put").map(operation => operation.key), [["_0/-0", "/data/a"], ["_0/-0", "/data/b"]]);
    await tree.replaceSystem(new Map([["/system/a", new Uint8Array([1])]]));
    fixture.operations.length = 0;
    await tree.replaceSystem(new Map([["/system/b", new Uint8Array([2])], ["/system/日本語", new Uint8Array([3])]]));
    const replacement = fixture.operations.filter(operation => operation.mode === "readwrite");
    assertEquals(new Set(replacement.map(operation => operation.transaction)).size, 1);
    assertEquals(replacement.filter(operation => operation.method === "clear"), []);
    assertEquals(fixture.operations.filter(operation => operation.method === "openCursor" && operation.key === undefined), []);
    assertEquals(await tree.read("/data/untouched"), new Uint8Array([7]));
    await tree.writeFiles(new Map([
      ["/data/prefix/a", new Uint8Array([1])], ["/data/prefix/ab", new Uint8Array([2])],
      ["/data/prefix/a/日本語", new Uint8Array([3])], ["/data/prefix/a\uffff", new Uint8Array([4])],
    ]));
    assertEquals(await tree.list("/data/prefix/a"), ["/data/prefix/a", "/data/prefix/a/日本語"]);
  });
});


Deno.test("IndexedDB owner methods synchronously reject invalid paths like memory storage", () => {
  const fixture = databaseFixture(installed);
  const memory = createMemoryStorage().forOwner("_0/-0");
  const indexed = createIndexedDbStorage({ content: fixture.content }).forOwner("_0/-0");
  const bytes = new Uint8Array([1]);
  const calls: ((owner: OwnerStorage) => unknown)[] = [
    owner => owner.read("relative"),
    owner => owner.readFiles(["/valid", "/bad/../path"]),
    owner => owner.write("/", bytes),
    owner => owner.writeFiles(new Map([["relative", bytes]])),
    owner => owner.writeFiles(new Map(), ["relative"]),
    owner => owner.list("relative"),
    owner => owner.delete("relative"),
    owner => owner.update("relative", () => bytes),
    owner => owner.metadata("relative"),
    owner => owner.restore("relative"),
    owner => owner.move("relative", "/valid"),
    owner => owner.move("/valid", "/"),
    owner => owner.replace("relative", new Map()),
    owner => owner.replace("/data", new Map([["/outside", bytes]])),
  ];
  for (const call of calls) {
    const expected = assertThrows(() => call(memory), Error);
    const actual = assertThrows(() => call(indexed), Error);
    assertEquals(actual.message, expected.message);
  }
  assertEquals(fixture.opened, []);
});

Deno.test("IndexedDB app lookups read only target keys before and after provider moves", async () => {
  const fixture = databaseFixture(installed);
  await withDatabase(fixture, async () => {
    const storage = createIndexedDbStorage({ content: fixture.content });
    await storage.appOwner("https://unrelated.test/apps/#other");
    const source = "https://target.test/apps/";
    const id = `${source}#memo`;
    const owner = await storage.appOwner(id);
    await storage.appOwner(`${source}#another`);
    const provider = (await storage.provider(source))!;
    const appKey = [provider.number, Number.parseInt(owner.split("/-")[1], 16)];
    const expected = { id, owner, provider };
    const byId = async (appId: string, expectedRecord: typeof expected) => {
      fixture.operations.length = 0;
      assertEquals(await storage.findApp(appId), expectedRecord);
      assertEquals(fixture.operations.map(operation => [operation.store, operation.method, operation.key]), [
        ["providers", "index:url:getKey", expectedRecord.provider.url],
        ["appIds", "get", [provider.number, "memo"]],
        ["providers", "get", provider.number],
        ["apps", "get", appKey],
      ]);
    };
    const byOwner = async (expectedRecord: typeof expected) => {
      fixture.operations.length = 0;
      assertEquals(await storage.findAppByOwner(owner), expectedRecord);
      assertEquals(fixture.operations.map(operation => [operation.store, operation.method, operation.key]), [
        ["providers", "get", provider.number], ["apps", "get", appKey],
      ]);
    };
    await byId(id, expected);
    await byOwner(expected);
    const moved = "https://moved.test/apps/";
    await storage.moveProvider(source, moved);
    const next = { ...expected, id: `${moved}#memo`, provider: { ...provider, url: moved } };
    await byId(next.id, next);
    await byOwner(next);
    fixture.operations.length = 0;
    assertEquals(await storage.findApp(id), undefined);
    assertEquals(fixture.operations.map(operation => [operation.store, operation.method, operation.key]), [
      ["providers", "index:url:getKey", source],
    ]);
  });
});

Deno.test("IndexedDB writes provider.json only when that provider changes", async () => {
  const fixture = databaseFixture(installed);
  const contentWrites: { key: string; value: Uint8Array }[] = [];
  const writeContent = fixture.content.write.bind(fixture.content);
  fixture.content.write = (key, value) => {
    contentWrites.push({ key, value: value.slice() });
    return writeContent(key, value);
  };
  await withDatabase(fixture, async () => {
    const storage = createIndexedDbStorage({ content: fixture.content });
    const source = "https://provider.test/apps/";
    const provider = await storage.registerProvider(source, "Provider");
    await storage.registerProvider("https://unrelated.test/apps/", "Unrelated");
    const id = `${source}#memo`;
    const ownerName = await storage.appOwner(id);
    const owner = storage.forOwner(ownerName);
    await owner.write("/data/value", new Uint8Array([1]));
    const unchanged = async (action: () => Promise<unknown>) => {
      contentWrites.length = 0;
      await action();
      assertEquals(contentWrites.filter(write => write.key.endsWith("/provider.json")), []);
    };
    await unchanged(() => storage.registerProvider(source, "Provider"));
    await unchanged(() => storage.appOwner(id));
    await unchanged(async () => {
      assertEquals(await storage.provider(source), provider);
      assertEquals((await storage.findApp(id))?.owner, ownerName);
      assertEquals((await storage.findAppByOwner(ownerName))?.id, id);
      assertEquals(await owner.read("/data/value"), new Uint8Array([1]));
    });
    await unchanged(() => owner.write("/data/value", new Uint8Array([2])));
    const destination = "https://moved.test/apps/";
    contentWrites.length = 0;
    await storage.moveProvider(source, destination);
    assertEquals(contentWrites.map(write => write.key), [`_${provider.number.toString(16)}/provider.json`]);
    const { number: _number, ...record } = provider;
    assertEquals(JSON.parse(new TextDecoder().decode(contentWrites[0].value)), { ...record, url: destination });
  });
});


Deno.test("Pigeon IndexedDB serializes concurrent delivery and preserves IDs across connections", async () => {
  const fixture = databaseFixture(installed, 2);
  for (const name of ["inbox", "muted", "sequence"]) fixture.tables.set(name, new Map());
  await withDatabase(fixture, async () => {
    const first = createIndexedDbPigeonStore("pigeon-test");
    const second = createIndexedDbPigeonStore("pigeon-test");
    const letter = { id: 0, from: "sender", to: "receiver", kind: "open", title: "", body: "data" };
    await Promise.all(Array.from({ length: 105 }, (_, i) => (i % 2 ? first : second).append("receiver", letter)));
    const snapshot = await first.read("receiver");
    assertEquals(snapshot.length, 100);
    assertEquals(new Set(snapshot.map(letter => letter.id)).size, 100);
    assertEquals(snapshot[0]!.id, 6);
    const reopened = createIndexedDbPigeonStore("pigeon-test");
    await reopened.append("receiver", letter);
    assertEquals((await reopened.read("receiver")).at(-1)!.id, 106);
    await first.done("receiver", 55);
    assertEquals((await second.read("receiver")).filter(letter => letter.id === 55), []);
    await first.mute("sender", true);
    assertEquals(await reopened.muted("sender"), true);
    assertEquals(fixture.transactions.filter(tx => tx.mode === "readwrite" && tx.stores.includes("sequence")).every(tx => tx.stores.includes("inbox")), true);
  });
});
