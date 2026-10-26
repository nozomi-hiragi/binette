import { assertEquals, assertThrows } from "@std/assert";
import { createCoulisses, createPanoplie, parsePanoplie } from "../src/index.ts";

const get = (coulisses: ReturnType<typeof createCoulisses>, path: string, method = "GET") =>
  coulisses.fetch(new Request(`http://localhost${path}`, { method }));

Deno.test("ビネットとファイルを配る", async () => {
  const panoplie = parsePanoplie(JSON.stringify({ index: { binette: "0.1", redirect: "/home" } }));
  const coulisses = createCoulisses({ panoplie: createPanoplie(panoplie.binettes, { "files/a.js": "export {}" }) });
  const index = await get(coulisses, "/index.bina");
  assertEquals(index.status, 200);
  assertEquals(JSON.parse(await index.text()).redirect, "/home");
  const file = await get(coulisses, "/files/a.js");
  assertEquals(file.headers.get("content-type"), "text/javascript; charset=utf-8");
  assertEquals((await get(coulisses, "/missing.bina")).status, 404);
  assertEquals((await get(coulisses, "/files/a.js", "POST")).status, 405);
  assertEquals(await (await get(coulisses, "/files/a.js", "HEAD")).text(), "");
});

Deno.test("あとから足したものを返し、同じ名前は置き換える", async () => {
  const coulisses = createCoulisses();
  coulisses.addBinette("notes/1", { binette: "0.1", redirect: "/a" });
  coulisses.addBinette("notes/1", { binette: "0.1", redirect: "/b" });
  coulisses.addFile("files/b.css", "p{}");
  assertEquals(JSON.parse(await (await get(coulisses, "/notes/1.bina")).text()).redirect, "/b");
  assertEquals(await (await get(coulisses, "/files/b.css")).text(), "p{}");
});

Deno.test("正しくない名前やビネットは足せない", () => {
  const coulisses = createCoulisses();
  assertThrows(() => coulisses.addBinette("/home", { binette: "0.1", redirect: "/a" }), Error, "ビネットの名前が正しくありません");
  assertThrows(() => coulisses.addBinette("x", { binette: "0.1" }), Error, "entry と redirect");
  assertThrows(() => coulisses.addFile("../x", "y"), Error, "ファイルの名前が正しくありません");
  assertThrows(() => coulisses.addFile("a.bina", "{}"), Error, "ビネットとして足してください");
});

Deno.test("渡したパノプリや配列はあとで変えても影響しない", async () => {
  const body = new TextEncoder().encode("abc");
  const panoplie = createPanoplie({}, { "a.txt": body });
  const coulisses = createCoulisses({ panoplie });
  body[0] = 0x7a;
  panoplie.binettes.index = { binette: "0.1", redirect: "/x", assets: {} };
  assertEquals(await (await get(coulisses, "/a.txt")).text(), "abc");
  assertEquals((await get(coulisses, "/index.bina")).status, 404);
});
