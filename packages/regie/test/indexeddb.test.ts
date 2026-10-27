import { assertEquals, assertRejects } from "@std/assert";
import { createIndexedDbAppStore, installedAppKey, type InstalledApp } from "../src/index.ts";

/** Deno には IndexedDB が無いので、接続・版の更新・トランザクションの境界を代用する */
function databaseFixture(installed: InstalledApp) {
  const tables = new Map<string, Map<string, unknown>>([["apps", new Map([[installed.key, structuredClone(installed)]])]]);
  let version = 1;
  let tail = Promise.resolve();
  const opened: number[] = [];
  const db = {
    objectStoreNames: { contains: (name: string) => tables.has(name) },
    createObjectStore(name: string) {
      if (tables.has(name)) throw new Error("表はすでにあります。");
      tables.set(name, new Map());
    },
    close() {},
    transaction(name: string) {
      const values = tables.get(name)!;
      if (!values) throw new Error("表がありません。");
      let release!: () => void;
      const before = tail;
      tail = new Promise<void>(resolve => { release = resolve; });
      let pending = 0;
      const tx: { oncomplete?: () => void; objectStore: () => unknown } = {
        objectStore() {
          const request = (action: () => unknown) => {
            pending++;
            const result: { result?: unknown; onsuccess?: () => void } = {};
            void before.then(() => {
              result.result = structuredClone(action());
              result.onsuccess?.();
              if (--pending === 0) { tx.oncomplete?.(); release(); }
            });
            return result;
          };
          return {
            get: (key: string) => request(() => values.get(key)),
            getAll: () => request(() => [...values.values()]),
            put: (value: unknown, key?: string) => {
              const copy = structuredClone(value);
              return request(() => { const at = key ?? (copy as InstalledApp).key; values.set(at, copy); return at; });
            },
          };
        },
      };
      return tx;
    },
  };
  return {
    tables, opened,
    factory: { open(_name: string, next: number) {
      opened.push(next);
      const request: { result: typeof db; onupgradeneeded?: () => void; onsuccess?: () => void } = { result: db };
      queueMicrotask(() => {
        if (next > version) { request.onupgradeneeded?.(); version = next; }
        request.onsuccess?.();
      });
      return request;
    } } as unknown as IDBFactory,
  };
}

Deno.test("IndexedDB の v1 のアプリを残して v2 に表を足し、再接続して OS の記録を読む", async () => {
  const installed: InstalledApp = {
    key: installedAppKey("test", "a"), source: "test", manifest: { id: "a", name: "A", entry: { html: "index.html", as: "main.ts" } },
    html: "<p>以前のアプリ</p>", wasm: new Uint8Array([1, 2, 3]), icon: undefined, installedAt: 1,
  };
  const fixture = databaseFixture(installed);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fixture.factory });
  try {
    const store = createIndexedDbAppStore();
    assertEquals(fixture.opened, []);
    assertEquals(await store.get(installed.key), installed);
    assertEquals(fixture.opened, [2]);
    assertEquals([...fixture.tables.keys()], ["apps", "system"]);
    const record = { state: 4, done: false, page: "ページ", reason: { kind: 1, cause: 2 } };
    await store.system.putLast(installed.key, record);
    await store.system.putSettings({ stackSize: 2, historyLimit: 2, home: installed.key });
    await Promise.all([1, 2, 3].map(time => store.system.recordLaunch({ time, app: installed.key }, 2)));
    const reopened = createIndexedDbAppStore();
    assertEquals(await reopened.list(), [installed]);
    assertEquals(await reopened.system.getLast(installed.key), record);
    assertEquals(await reopened.system.getSettings(), { stackSize: 2, historyLimit: 2, home: installed.key });
    assertEquals(await reopened.system.listLaunches(), [{ time: 2, app: installed.key }, { time: 3, app: installed.key }]);
    await reopened.put({ ...installed, html: "更新" });
    assertEquals((await store.get(installed.key))!.html, "更新");
    assertEquals(await store.system.getLast("missing"), undefined);
    await assertRejects(() => store.system.putSettings({ stackSize: 0 }), Error, "範囲外");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "indexedDB", descriptor);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});
