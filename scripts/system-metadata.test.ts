import { assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import { kernelVersion, systemLabel } from "./system-metadata.ts";

Deno.test("カーネルの版は SW のキャッシュ名の全文と一致する", () => {
  assertEquals(kernelVersion('const CACHE = "binette-v0.2.0-3-0123456789abcdef";'), "binette-v0.2.0-3-0123456789abcdef");
  assertThrows(() => kernelVersion("// missing"), Error, "キャッシュの版がありません");
});

Deno.test("表示する版はパッケージの版と短いハッシュで、system と kernel の両方に依存する", async () => {
  const label = await systemLabel("0.2.0", "system-a", "kernel-a");
  assertEquals(/^0\.2\.0\+[0-9a-f]{8}$/.test(label), true);
  assertEquals(await systemLabel("0.2.0", "system-a", "kernel-a"), label);
  assertNotEquals(await systemLabel("0.2.0", "system-b", "kernel-a"), label);
  assertNotEquals(await systemLabel("0.2.0", "system-a", "kernel-b"), label);
  assertEquals((await systemLabel("0.3.0", "system-a", "kernel-a")).split("+")[0], "0.3.0");
});
