import assert from "node:assert/strict";
import { test } from "node:test";
import { BINETTE_VERSION, BinetteError, parseBinette } from "../src/index.ts";

const page = { binette: BINETTE_VERSION, entry: "main", assets: { main: { type: "html", content: "<p>hi</p>" } } };

test("ページと転送のビネットを読める", () => {
  assert.equal(parseBinette(JSON.stringify(page)).entry, "main");
  assert.equal(parseBinette(JSON.stringify({ binette: BINETTE_VERSION, redirect: "/home" })).redirect, "/home");
});

test("形式が正しくないビネットは BinetteError になる", () => {
  for (const [text, message] of [
    ["{", "Binette を JSON として読めません。"],
    [JSON.stringify({ binette: "0.2", redirect: "/a" }), "対応していない Binette のバージョンです: 0.2"],
    [JSON.stringify({ binette: BINETTE_VERSION }), "entry と redirect のどちらか一方を指定してください。"],
    [JSON.stringify({ ...page, redirect: "/a" }), "entry と redirect のどちらか一方を指定してください。"],
    [JSON.stringify({ binette: BINETTE_VERSION, redirect: "//evil" }), "redirect は Scene 内のパスで指定してください。"],
  ] as const) {
    assert.throws(() => parseBinette(text), (error: unknown) => error instanceof BinetteError && error.message === message, text);
  }
});

test("どのビネットにも settings を書ける", () => {
  const binette = parseBinette(JSON.stringify({ ...page, settings: [{ type: "element", component: "logout" }] }));
  assert.equal(binette.settings?.length, 1);
});
