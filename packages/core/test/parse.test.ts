import { assertEquals, assertThrows } from "@std/assert";
import { BINETTE_VERSION, BinetteError, parseBinette } from "../src/index.ts";

const page = { binette: BINETTE_VERSION, entry: "main", assets: { main: { type: "html", content: "<p>hi</p>" } } };

Deno.test("ページと転送のビネットを読める", () => {
  assertEquals(parseBinette(JSON.stringify(page)).entry, "main");
  assertEquals(parseBinette(JSON.stringify({ binette: BINETTE_VERSION, redirect: "/home" })).redirect, "/home");
});

Deno.test("形式が正しくないビネットは BinetteError になる", () => {
  for (const [text, message] of [
    ["{", "Binette を JSON として読めません。"],
    [JSON.stringify({ binette: "0.2", redirect: "/a" }), "対応していない Binette のバージョンです: 0.2"],
    [JSON.stringify({ binette: BINETTE_VERSION }), "entry と redirect のどちらか一方を指定してください。"],
    [JSON.stringify({ ...page, redirect: "/a" }), "entry と redirect のどちらか一方を指定してください。"],
    [JSON.stringify({ binette: BINETTE_VERSION, redirect: "//evil" }), "redirect は Scene 内のパスで指定してください。"],
  ] as const) {
    const error = assertThrows(() => parseBinette(text), BinetteError, undefined, text);
    assertEquals(error.message, message, text);
  }
});

Deno.test("どのビネットにも settings を書ける", () => {
  const binette = parseBinette(JSON.stringify({ ...page, settings: [{ type: "element", component: "logout" }] }));
  assertEquals(binette.settings?.length, 1);
});
