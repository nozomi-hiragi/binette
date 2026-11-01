import { assertEquals, assertThrows } from "@std/assert";
import { createMemoryFileTree } from "../src/fs.ts";

Deno.test("File trees validate canonical paths, preserve prefix boundaries, and copy values", async () => {
  const tree = createMemoryFileTree();
  for (
    const path of [
      "relative",
      "/a/",
      "/a//b",
      "/a/./b",
      "/a/../b",
      "/a\\b",
      "/a\0b",
    ]
  ) {
    assertThrows(() => tree.write(path, new Uint8Array()));
    assertThrows(() => tree.read(path));
  }
  const bytes = new Uint8Array([1]);
  await tree.write("/data/a", bytes);
  bytes[0] = 2;
  const saved = (await tree.read("/data/a"))!;
  saved[0] = 3;
  assertEquals(await tree.read("/data/a"), new Uint8Array([1]));
  await tree.write("/database/b", bytes);
  assertEquals(await tree.list("/data"), ["/data/a"]);
  await tree.delete("/data/a");
  assertEquals(await tree.read("/data/a"), undefined);
});

Deno.test("Overlays prefer user files, restore deleted overrides, and protect settings", async () => {
  const tree = createMemoryFileTree();
  await tree.replaceSystem(
    new Map([["/system/apps/home/app.json", new Uint8Array([1])], [
      "/system/apps/settings/app.json",
      new Uint8Array([2]),
    ]]),
  );
  await tree.replaceSystem(
    new Map([["/system/boot.json", new Uint8Array([9])], [
      "/system/apps/home/app.json",
      new Uint8Array([1]),
    ], ["/system/apps/settings/app.json", new Uint8Array([2])]]),
  );
  await tree.write("/user/apps/home/app.json", new Uint8Array([3]));
  await tree.write("/user/apps/settings/app.json", new Uint8Array([4]));
  await tree.write("/user/apps/settings/extra", new Uint8Array([5]));
  assertEquals(
    await tree.readOverlay("/apps/home/app.json"),
    new Uint8Array([3]),
  );
  assertEquals(
    await tree.readOverlay("/apps/settings/app.json"),
    new Uint8Array([2]),
  );
  assertEquals(await tree.listOverlay("/apps"), [
    "/apps/home/app.json",
    "/apps/settings/app.json",
  ]);
  assertEquals(await tree.listOverlay("/"), [
    "/apps/home/app.json",
    "/apps/settings/app.json",
    "/boot.json",
  ]);
  assertEquals(await tree.readOverlay("/boot.json"), new Uint8Array([9]));
  assertEquals(await tree.readOverlay("/"), undefined);
  await tree.delete("/user/apps/home/app.json");
  assertEquals(
    await tree.readOverlay("/apps/home/app.json"),
    new Uint8Array([1]),
  );
});

Deno.test("System replacement validates first and preserves unrelated files", async () => {
  const tree = createMemoryFileTree();
  await tree.replaceSystem(new Map([["/system/old", new Uint8Array([1])]]));
  await tree.write("/user/keep", new Uint8Array([2]));
  for (const path of ["/system", "/system/old"]) {
    assertThrows(() => tree.write(path, new Uint8Array()));
    assertThrows(() => tree.delete(path));
    assertThrows(() => tree.update(path, () => new Uint8Array()));
  }
  assertThrows(() =>
    tree.replaceSystem(
      new Map([["/system/new", new Uint8Array()], [
        "/other",
        new Uint8Array(),
      ]]),
    )
  );
  assertEquals(await tree.read("/system/old"), new Uint8Array([1]));
  const data = new Uint8Array([3]);
  await tree.replaceSystem(new Map([["/system/new", data]]));
  data[0] = 4;
  assertEquals(await tree.list("/"), ["/system/new", "/user/keep"]);
  assertEquals(await tree.read("/system/new"), new Uint8Array([3]));
});

Deno.test("Concurrent updates retain earlier updates and failures preserve stored values", async () => {
  const tree = createMemoryFileTree();
  await Promise.all(
    Array.from(
      { length: 20 },
      () =>
        tree.update(
          "/data/count",
          (value) => new Uint8Array([(value?.[0] ?? 0) + 1]),
        ),
    ),
  );
  assertEquals(await tree.read("/data/count"), new Uint8Array([20]));
  assertThrows(() =>
    tree.update("/data/count", (value) => {
      value![0] = 0;
      throw new Error("failure");
    })
  );
  assertEquals(await tree.read("/data/count"), new Uint8Array([20]));
});

Deno.test("writeFiles validates the whole batch before changing files and copies its values", async () => {
  const tree = createMemoryFileTree();
  await tree.write("/apps/a/record.json", new Uint8Array([1]));
  assertThrows(() =>
    tree.writeFiles(
      new Map([
        ["/apps/a/record.json", new Uint8Array([2])],
        ["/system/app.wasm", new Uint8Array([3])],
      ]),
    )
  );
  assertEquals(await tree.read("/apps/a/record.json"), new Uint8Array([1]));
  assertEquals(await tree.read("/system/app.wasm"), undefined);
  const bytes = new Uint8Array([4]);
  await tree.writeFiles(
    new Map([
      ["/apps/a/record.json", new Uint8Array([2])],
      ["/apps/a/app.wasm", bytes],
    ]),
  );
  bytes[0] = 9;
  assertEquals(await tree.read("/apps/a/record.json"), new Uint8Array([2]));
  assertEquals(await tree.read("/apps/a/app.wasm"), new Uint8Array([4]));
});

Deno.test("readFiles preserves order, missing files, and independent copies", async () => {
  const tree = createMemoryFileTree();
  await tree.writeFiles(
    new Map([["/data/a", new Uint8Array([1])], [
      "/data/b",
      new Uint8Array([2]),
    ]]),
  );
  assertThrows(() => tree.readFiles(["/data/a", "relative"]));
  const result = await tree.readFiles([
    "/data/b",
    "/missing",
    "/data/a",
    "/data/b",
  ]);
  assertEquals(result, [
    new Uint8Array([2]),
    undefined,
    new Uint8Array([1]),
    new Uint8Array([2]),
  ]);
  result[0]![0] = 9;
  assertEquals(result[3], new Uint8Array([2]));
  assertEquals(await tree.read("/data/b"), new Uint8Array([2]));
  assertEquals(await tree.readFiles([]), []);
});
