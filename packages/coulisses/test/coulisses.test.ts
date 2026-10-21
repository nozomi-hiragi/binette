import assert from "node:assert/strict";
import { test } from "node:test";
import { createCoulisses, createPanoplie, parsePanoplie } from "../src/index.ts";

const get = (coulisses: ReturnType<typeof createCoulisses>, path: string, method = "GET") =>
  coulisses.fetch(new Request(`http://localhost${path}`, { method }));

test("ビネットとファイルを配る", async () => {
  const panoplie = parsePanoplie(JSON.stringify({ index: { binette: "0.1", redirect: "/home" } }));
  const coulisses = createCoulisses({ panoplie: createPanoplie(panoplie.binettes, { "files/a.js": "export {}" }) });
  const index = await get(coulisses, "/index.bina");
  assert.equal(index.status, 200);
  assert.equal(JSON.parse(await index.text()).redirect, "/home");
  const file = await get(coulisses, "/files/a.js");
  assert.equal(file.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal((await get(coulisses, "/missing.bina")).status, 404);
  assert.equal((await get(coulisses, "/files/a.js", "POST")).status, 405);
  assert.equal(await (await get(coulisses, "/files/a.js", "HEAD")).text(), "");
});

test("あとから足したものを返し、同じ名前は置き換える", async () => {
  const coulisses = createCoulisses();
  coulisses.addBinette("notes/1", { binette: "0.1", redirect: "/a" });
  coulisses.addBinette("notes/1", { binette: "0.1", redirect: "/b" });
  coulisses.addFile("files/b.css", "p{}");
  assert.equal(JSON.parse(await (await get(coulisses, "/notes/1.bina")).text()).redirect, "/b");
  assert.equal(await (await get(coulisses, "/files/b.css")).text(), "p{}");
});

test("正しくない名前やビネットは足せない", () => {
  const coulisses = createCoulisses();
  assert.throws(() => coulisses.addBinette("/home", { binette: "0.1", redirect: "/a" }), /ビネットの名前が正しくありません/);
  assert.throws(() => coulisses.addBinette("x", { binette: "0.1" }), /entry と redirect/);
  assert.throws(() => coulisses.addFile("../x", "y"), /ファイルの名前が正しくありません/);
  assert.throws(() => coulisses.addFile("a.bina", "{}"), /ビネットとして足してください/);
});

test("渡したパノプリや配列はあとで変えても影響しない", async () => {
  const body = new TextEncoder().encode("abc");
  const panoplie = createPanoplie({}, { "a.txt": body });
  const coulisses = createCoulisses({ panoplie });
  body[0] = 0x7a;
  panoplie.binettes.index = { binette: "0.1", redirect: "/x", assets: {} };
  assert.equal(await (await get(coulisses, "/a.txt")).text(), "abc");
  assert.equal((await get(coulisses, "/index.bina")).status, 404);
});
