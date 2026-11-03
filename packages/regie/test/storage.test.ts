import { assertEquals, assertRejects } from "@std/assert";
import {
  createMemoryContentStore,
  createMemoryStorage,
} from "../src/storage.ts";

Deno.test("storage stores immutable owner-scoped content, bounded history, and restores deletions", async () => {
  const content = createMemoryContentStore();
  let now = 1;
  const storage = createMemoryStorage({ content, now: () => now });
  const owner = storage.forOwner(
    await storage.appOwner("https://example.test/list#notes"),
  );
  for (let i = 0; i < 13; i++) {
    now++;
    await owner.write("/data/note", new Uint8Array([i]));
  }
  const metadata = (await owner.metadata("/data/note"))!;
  assertEquals(metadata.history.length, 10);
  assertEquals(
    (await content.list()).filter((k) => k.endsWith(metadata.hash)).length,
    1,
  );
  await owner.write("/data/copy", new Uint8Array([12]));
  assertEquals(
    (await content.list()).filter((k) => k.endsWith(metadata.hash)).length,
    1,
  );
  await owner.delete("/data/note");
  assertEquals(await owner.list("/data"), ["/data/copy"]);
  await owner.restore("/data/note", metadata.history[0]);
  assertEquals(await owner.read("/data/note"), new Uint8Array([11]));
  await owner.move("/data/note", "/data/renamed");
  assertEquals(await owner.read("/data/note"), undefined);
  assertEquals(await owner.read("/data/renamed"), new Uint8Array([11]));
  assertEquals(
    await storage.forOwner("shared/group").read("/data/copy"),
    undefined,
  );
});

Deno.test("storage provider moves preserve owners and allocation never reuses removed apps", async () => {
  const storage = createMemoryStorage();
  const old = "https://old.test/list";
  const next = "https://new.test/list";
  const owner = await storage.appOwner(`${old}#notes`);
  assertEquals(await storage.appOwner(`${old}#notes.editor`), owner);
  await storage.moveProvider(old, next);
  assertEquals((await storage.listApps())[0].id, `${next}#notes`);
  assertEquals(await storage.appOwner(`${next}#notes`), owner);
  await storage.removeApp(`${next}#notes`);
  assertEquals((await storage.listApps()).length, 0);
  assertEquals(await storage.appOwner(`${next}#notes`), "_1/-1");
});

Deno.test("uninstall removes registry and rows; content is collected or removed immediately", async () => {
  const content = createMemoryContentStore();
  const storage = createMemoryStorage({ content });
  const first = "https://example.test/list#first";
  const firstOwner = await storage.appOwner(first);
  await storage.forOwner(firstOwner).write("/data/a", new Uint8Array([1]));
  await storage.removeApp(first);
  assertEquals(await storage.listApps(), []);
  assertEquals(await storage.forOwner(firstOwner).read("/data/a"), undefined);
  assertEquals((await content.list()).length, 1);
  await storage.gc();
  assertEquals(await content.list(), []);

  const second = "https://example.test/list#second";
  const secondOwner = await storage.appOwner(second);
  await storage.forOwner(secondOwner).write("/data/b", new Uint8Array([2]));
  await storage.removeApp(second, true);
  assertEquals(await storage.forOwner(secondOwner).read("/data/b"), undefined);
  assertEquals(await content.list(), []);
});

Deno.test("storage failed content batches leave metadata intact and GC removes only unreferenced content", async () => {
  const memory = createMemoryContentStore();
  let fail = false;
  let now = 100;
  const storage = createMemoryStorage({
    now: () => now,
    content: {
      ...memory,
      write: async (k, v) => {
        if (fail && v[0] === 9) throw new Error("disk full");
        await memory.write(k, v);
      },
    },
  });
  const owner = storage.forOwner("_0/-0");
  await owner.write("/data/a", new Uint8Array([1]));
  fail = true;
  await assertRejects(
    () =>
      owner.writeFiles(
        new Map([["/data/a", new Uint8Array([2])], [
          "/data/b",
          new Uint8Array([9]),
        ]]),
      ),
    Error,
    "disk full",
  );
  assertEquals(await owner.read("/data/a"), new Uint8Array([1]));
  assertEquals(await owner.read("/data/b"), undefined);
  assertEquals((await memory.list()).length, 2);
  await storage.gc();
  assertEquals((await memory.list()).length, 1);
  await owner.delete("/data/a");
  await storage.gc();
  assertEquals((await memory.list()).length, 1);
  now += 30 * 86400000;
  await storage.gc();
  assertEquals((await memory.list()).length, 0);
});

Deno.test("system replacement retains history and snapshots serialize concurrent updates", async () => {
  const storage = createMemoryStorage();
  const owner = storage.forOwner("_0/-0");
  await owner.replace(
    "/system",
    new Map([["/system/a", new Uint8Array([1])], [
      "/system/b",
      new Uint8Array([2]),
    ]]),
  );
  await owner.replace("/system", new Map([["/system/a", new Uint8Array([3])]]));
  assertEquals(await owner.list("/system"), ["/system/a"]);
  const old = (await owner.metadata("/system/a"))!.history[0];
  await owner.restore("/system/a", old);
  assertEquals(await owner.read("/system/a"), new Uint8Array([1]));
  await Promise.all(
    Array.from(
      { length: 20 },
      () =>
        owner.update("/data/count", (v) => new Uint8Array([(v?.[0] ?? 0) + 1])),
    ),
  );
  assertEquals(await owner.read("/data/count"), new Uint8Array([20]));
});

Deno.test("OPFS namespaces and GC preserve other databases and unrelated root files", async () => {
  class Directory {
    kind = "directory";
    children = new Map<
      string,
      Directory | { kind: string; bytes: Uint8Array }
    >();
    // deno-lint-ignore require-await -- Match the asynchronous OPFS contract.
    async getDirectoryHandle(
      name: string,
      options?: { create?: boolean },
    ): Promise<Directory> {
      let child = this.children.get(name);
      if (!child && options?.create) {
        child = new Directory();
        this.children.set(name, child);
      }
      if (!(child instanceof Directory)) {
        throw new DOMException("Missing directory", "NotFoundError");
      }
      return child;
    }
    // deno-lint-ignore require-await -- Match the asynchronous OPFS contract.
    async getFileHandle(name: string, options?: { create?: boolean }) {
      let child = this.children.get(name);
      if (!child && options?.create) {
        child = { kind: "file", bytes: new Uint8Array() };
        this.children.set(name, child);
      }
      if (!child || child instanceof Directory) {
        throw new DOMException("Missing file", "NotFoundError");
      }
      const file = child;
      return {
        getFile: () => Promise.resolve(new Blob([file.bytes.slice().buffer])),
        createWritable: () =>
          Promise.resolve({
            write: (buffer: ArrayBuffer) => {
              file.bytes = new Uint8Array(buffer);
              return Promise.resolve();
            },
            close: () => Promise.resolve(),
            abort: () => Promise.resolve(),
          }),
      };
    }
    async *entries() {
      for (const pair of this.children) yield pair;
    }
    removeEntry(name: string) {
      this.children.delete(name);
      return Promise.resolve();
    }
  }
  const root = new Directory();
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "storage");
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: {
      getDirectory: () =>
        Promise.resolve(root as unknown as FileSystemDirectoryHandle),
    },
  });
  try {
    const { createOpfsContentStore } = await import("../src/storage.ts");
    const primary = createOpfsContentStore();
    const other = createOpfsContentStore("other");
    const digest = "a".repeat(64);
    await other.write(`_0/-0/${digest}`, new Uint8Array([1]));
    await primary.write(`elsewhere/${digest}`, new Uint8Array([2]));
    await primary.write(`_1/-0/${digest}`, new Uint8Array([3]));
    assertEquals(
      (await primary.list()).some((k) => k.startsWith("databases/")),
      false,
    );
    await createMemoryStorage({ content: primary }).gc();
    assertEquals(await other.read(`_0/-0/${digest}`), new Uint8Array([1]));
    assertEquals(
      await primary.read(`elsewhere/${digest}`),
      new Uint8Array([2]),
    );
    assertEquals(await primary.read(`_1/-0/${digest}`), undefined);
    assertEquals(root.children.has("_1"), false);
  } finally {
    if (descriptor) Object.defineProperty(navigator, "storage", descriptor);
    else Reflect.deleteProperty(navigator, "storage");
  }
});

Deno.test("bundled and system apps share provider zero and reserve the kernel owner", async () => {
  const storage = createMemoryStorage();
  const bundled = await storage.appOwner("designer", "binette:bundled");
  const system = await storage.appOwner("cadre", "binette:system");
  assertEquals(bundled, "_0/-1");
  assertEquals(system, "_0/-2");
  assertEquals(await storage.appOwner("designer", "binette:system"), bundled);
  assertEquals(
    await storage.appOwner("cadre.settings", "binette:bundled"),
    system,
  );
  assertEquals((await storage.listApps()).map((app) => app.provider.number), [
    0,
    0,
  ]);
});
