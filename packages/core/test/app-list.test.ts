import { assertEquals, assertThrows } from "@std/assert";
import { Window } from "happy-dom";
import { BinetteError, findAppList, parseAppList } from "../src/index.ts";

const page = "https://example.com/apps/";
const parse = (html: string) => new new Window().DOMParser().parseFromString(html, "text/html");
const fails = (fn: () => unknown, message?: string) => {
  const error = assertThrows(fn, BinetteError);
  assertEquals(error.code, "invalid_format");
  if (message !== undefined) assertEquals(error.message, message);
};
const hash = `sha256-${"A".repeat(43)}=`;

Deno.test("link の href をページの URL を基準に解決する", () => {
  const doc = parse('<html><head><link rel="stylesheet" href="s.css"><link rel="Foo BINETTE-APPS" href="data/apps.json"></head></html>');
  assertEquals(findAppList(doc, page), { kind: "link", url: "https://example.com/apps/data/apps.json" });
});

Deno.test("link が無ければ埋め込みの JSON を読み、link があれば link を優先する", () => {
  const embedded = '<script type="application/json" id="binette-apps">{"name":"n","apps":[]}</script>';
  assertEquals(findAppList(parse(`<html><body>${embedded}</body></html>`), page), { kind: "embedded", text: '{"name":"n","apps":[]}' });
  const both = parse(`<html><head><link rel="binette-apps" href="/a.json"></head><body>${embedded}</body></html>`);
  assertEquals(findAppList(both, page), { kind: "link", url: "https://example.com/a.json" });
});

Deno.test("提供リストでないページ、type や id の違う script、href の無い link は誤り", () => {
  fails(() => findAppList(parse("<html><body>x</body></html>"), page), "Binette の提供リストではありません。");
  fails(() => findAppList(parse('<script type="text/javascript" id="binette-apps">{}</script>'), page), "Binette の提供リストではありません。");
  fails(() => findAppList(parse('<script type="application/json" id="other">{}</script>'), page), "Binette の提供リストではありません。");
  fails(() => findAppList(parse('<link rel="binette-apps">'), page));
  fails(() => findAppList(parse('<link rel="binette-apps" href="http://example.com/a.json">'), page));
  assertEquals(findAppList(parse('<link rel="binette-apps" href="http://localhost/a.json">'), page, { allowHttp: true }), { kind: "link", url: "http://localhost/a.json" });
});

Deno.test("提供リストを読み、source を JSON の URL を基準に解決する", () => {
  const list = parseAppList(JSON.stringify({
    name: "のぞみのアプリ",
    apps: [
      { id: "memo", source: "https://raw.example.com/memo/0123abcd/", version: "1.2.0+0123abcd", integrity: { "/": hash } },
      { id: "メモ", source: "../memo2/", version: "1" },
    ],
  }), "https://example.com/apps/apps.json");
  assertEquals(list, {
    name: "のぞみのアプリ",
    apps: [
      { id: "memo", source: "https://raw.example.com/memo/0123abcd/", version: "1.2.0+0123abcd", integrity: { "/": hash } },
      { id: "%E3%83%A1%E3%83%A2", source: "https://example.com/memo2/", version: "1" },
    ],
  });
});

Deno.test("integrity はキーと値の形を検査する", () => {
  const withIntegrity = (integrity: unknown) =>
    parseAppList(JSON.stringify({ name: "n", apps: [{ id: "a", source: "s/", version: "1", integrity }] }), page);
  assertEquals(withIntegrity({ "/": hash, "src/": hash, "app.json": hash, "src/a/b.ts": hash }).apps[0].integrity, { "/": hash, "src/": hash, "app.json": hash, "src/a/b.ts": hash });
  for (const bad of [{ "/": "sha256-abc" }, { "/": "sha512-" + "A".repeat(43) + "=" }, { "/": 1 }, { "": hash }, { "/a": hash }, { "../a": hash }, { "a//b": hash }, { "./": hash }, [], null, "x"]) {
    fails(() => withIntegrity(bad));
  }
});

Deno.test("提供リストの形が正しくないと BinetteError", () => {
  const list = (value: unknown) => parseAppList(JSON.stringify(value), page);
  fails(() => parseAppList("{", page), "提供リストを JSON として読めません。");
  fails(() => list([]));
  fails(() => list({ apps: [] }), "提供リストの name を指定してください。");
  fails(() => list({ name: "n" }), "提供リストの apps は配列で指定してください。");
  fails(() => list({ name: "n", apps: [1] }));
  fails(() => list({ name: "n", apps: [{ source: "s", version: "1" }] }));
  fails(() => list({ name: "n", apps: [{ id: "a.b", source: "s", version: "1" }] }));
  fails(() => list({ name: "n", apps: [{ id: "", source: "s", version: "1" }] }));
  fails(() => list({ name: "n", apps: [{ id: "a", version: "1" }] }));
  fails(() => list({ name: "n", apps: [{ id: "a", source: "s" }] }));
  fails(() => list({ name: "n", apps: [{ id: "a", source: "s", version: "" }] }));
  fails(() => list({ name: "n", apps: [{ id: "a", source: "ftp://e.com/", version: "1" }] }));
  fails(() => list({ name: "n", apps: [{ id: "a", source: "http://e.com/", version: "1" }] }));
  fails(() => list({ name: "n", apps: [{ id: "a%e3", source: "s", version: "1" }, { id: "a%E3", source: "s", version: "1" }] }));
  assertEquals(parseAppList(JSON.stringify({ name: "n", apps: [{ id: "a", source: "http://e.com/", version: "1" }] }), page, { allowHttp: true }).apps[0].source, "http://e.com/");
});

Deno.test("movedTo があるリストは apps を読まない", () => {
  const moved = (movedTo: unknown, apps: unknown = [{ not: "valid" }]) => parseAppList(JSON.stringify({ name: "n", apps, movedTo }), page);
  assertEquals(moved("https://New.example.com/apps/"), { name: "n", apps: [], movedTo: "https://new.example.com/apps/" });
  assertEquals(moved("../new/"), { name: "n", apps: [], movedTo: "https://example.com/new/" });
  fails(() => moved("http://new.example.com/apps/"));
  fails(() => moved("https://new.example.com/apps/#x"));
  fails(() => moved("https://new.example.com/apps/?x"));
  fails(() => moved(1));
});

Deno.test("表示用の name・icon・description を読み、icon は JSON の URL を基準に解決する", () => {
  const list = parseAppList(JSON.stringify({ name: "n", apps: [{ id: "memo", source: "memo/", version: "1", name: "メモ", icon: "memo.svg", description: "書く" }] }), "https://example.com/apps/apps.json");
  assertEquals(list.apps[0], { id: "memo", source: "https://example.com/apps/memo/", version: "1", name: "メモ", icon: "https://example.com/apps/memo.svg", description: "書く" });
  fails(() => parseAppList(JSON.stringify({ name: "n", apps: [{ id: "a", source: "a/", version: "1", name: 1 }] }), page), "apps[0] の name は文字列で指定してください。");
  fails(() => parseAppList(JSON.stringify({ name: "n", apps: [{ id: "a", source: "a/", version: "1", icon: "" }] }), page), "apps[0] の icon は URL の文字列で指定してください。");
});
