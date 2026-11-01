import { assertEquals, assertRejects } from "@std/assert";
import { createIndexedDbFileTree } from "../src/fs.ts";
import { createIndexedDbAppStore, installedAppKey, type InstalledApp } from "../src/index.ts";

/** Deno に無い IndexedDB の要求・トランザクション・版更新の境界を代用する。 */
function databaseFixture(installed: InstalledApp, initialVersion = 1, system = new Map<string, unknown>()) {
  const tables = new Map<string, Map<string, unknown>>([["apps", new Map([[installed.key, structuredClone(installed)]])]]);
  if (initialVersion >= 2) tables.set("system", structuredClone(system));
  let version = initialVersion;
  let tail = Promise.resolve();
  let writeFailure: Error | undefined;
  let writesBeforeFailure = 0;
  const opened: number[] = [];
  const transaction = () => {
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
        return {
          get: (key: string) => request(() => structuredClone(values.get(name)!.get(key))),
          getAll: () => request(() => structuredClone([...values.get(name)!.values()])),
          getAllKeys: () => request(() => [...values.get(name)!.keys()].sort()),
          put: (value: unknown, key?: string) => {
            const copy = structuredClone(value);
            return request(() => { const at = key ?? (copy as InstalledApp).key; values.get(name)!.set(at, copy); return at; }, true);
          },
          delete: (key: string) => request(() => { values.get(name)!.delete(key); }, true),
          openCursor() {
            let keys: string[] | undefined;
            let index = 0;
            const cursor = (): unknown => {
              const key = keys![index++];
              return key === undefined ? null : {
                key, value: structuredClone(values.get(name)!.get(key)),
                continue() { request(() => { cursorRequest.result = cursor(); cursorRequest.onsuccess?.(); }); },
              };
            };
            const cursorRequest = request(() => {
              keys = [...values.get(name)!.keys()].sort();
              return cursor();
            });
            return cursorRequest;
          },
        };
      },
    };
    return tx;
  };
  let upgrade: ReturnType<typeof transaction> | undefined;
  const db = {
    objectStoreNames: { contains: (name: string) => tables.has(name) },
    createObjectStore(name: string) {
      if (tables.has(name)) throw new Error("表はすでにあります。");
      tables.set(name, new Map());
      return upgrade!.objectStore(name);
    },
    close() {},
    transaction,
  };
  return {
    tables, opened,
    failNextWrite(error: Error, after = 0) { writeFailure = error; writesBeforeFailure = after; },
    factory: { open(_name: string, next: number) {
      opened.push(next);
      const request = {
        result: db, transaction: undefined as ReturnType<typeof transaction> | undefined,
        onupgradeneeded: undefined as (() => void) | undefined,
        onsuccess: undefined as (() => void) | undefined,
        onerror: undefined as (() => void) | undefined,
      };
      queueMicrotask(() => {
        if (next > version) {
          request.transaction = upgrade = transaction();
          request.transaction.oncomplete = () => { version = next; request.onsuccess?.(); };
          request.onupgradeneeded?.();
        } else request.onsuccess?.();
      });
      return request;
    } } as unknown as IDBFactory,
  };
}

const installed: InstalledApp = {
  key: installedAppKey("test", "a"), source: "test", manifest: { id: "a", name: "A", entry: { html: "index.html", as: "main.ts" } },
  html: "<p>以前のアプリ</p>", wasm: new Uint8Array([1, 2, 3]), icon: undefined, installedAt: 1,
};

async function withDatabase(fixture: ReturnType<typeof databaseFixture>, test: () => Promise<void>) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fixture.factory });
  try { await test(); } finally {
    if (descriptor) Object.defineProperty(globalThis, "indexedDB", descriptor);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  }
}

for (const version of [1, 2]) Deno.test(`IndexedDB migrates v${version} apps and OS records to files and preserves them across connections`, async () => {
  const record = { state: 4, done: false, page: "ページ", reason: { kind: 1, cause: 2 } };
  const settings = { stackSize: 2, historyLimit: 2, home: installed.key };
  const fixture = databaseFixture(installed, version, new Map<string, unknown>([
    [`last:${installed.key}`, record], ["settings", settings], ["launches", [{ time: 0, app: installed.key }]],
  ]));
  await withDatabase(fixture, async () => {
    const store = createIndexedDbAppStore();
    assertEquals(fixture.opened, []);
    assertEquals(await store.get(installed.key), installed);
    assertEquals(fixture.opened, [3]);
    assertEquals(fixture.tables.has("files"), true);
    const tree = createIndexedDbFileTree();
    const recordPath = "/apps/a/test/record.json";
    const wasmPath = "/apps/a/test/app.wasm";
    const { wasm, ...metadata } = installed;
    assertEquals(JSON.parse(new TextDecoder().decode(await tree.read(recordPath))), JSON.parse(JSON.stringify(metadata)));
    assertEquals(await tree.read(wasmPath), wasm);
    assertEquals(await tree.list("/apps"), [wasmPath, recordPath]);
    assertEquals(await tree.read("/data/apps/index.json"), undefined);
    if (version === 2) {
      assertEquals(await store.system.getLast(installed.key), record);
      assertEquals(await store.system.getSettings(), settings);
      assertEquals(await store.system.listLaunches(), [{ time: 0, app: installed.key }]);
    }
    await store.system.putLast(installed.key, record);
    await store.system.putSettings(settings);
    const reopened = createIndexedDbAppStore();
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
    assertEquals(await tree.read(wasmPath), wasm);
    assertEquals(await tree.read("/data/apps/index.json"), undefined);
  });
});

Deno.test("IndexedDB persists file updates across connections and rolls back failed system replacements", async () => {
  const fixture = databaseFixture(installed);
  await withDatabase(fixture, async () => {
    const tree = createIndexedDbFileTree();
    await tree.replaceSystem(new Map([["/system/apps/a", new Uint8Array([1])]]));
    await tree.write("/user/apps/a", new Uint8Array([2]));
    const reopened = createIndexedDbFileTree();
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
    const writer = createIndexedDbFileTree();
    const reader = createIndexedDbFileTree();
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
