import { assertEquals, assertThrows } from "@std/assert";
import { BinetteError, formatAppId, normalizeAppIdentifier, normalizeAppListUrl, parseAppId } from "../src/index.ts";

const fails = (fn: () => unknown, message?: string) => {
  const error = assertThrows(fn, BinetteError);
  assertEquals(error.code, "invalid_format");
  if (message !== undefined) assertEquals(error.message, message);
};

Deno.test("識別子: 使える記号はそのまま、それ以外は UTF-8 の % エンコードになる", () => {
  assertEquals(normalizeAppIdentifier("Memo-1_~!$&'()*+,;=:@/?"), "Memo-1_~!$&'()*+,;=:@/?");
  assertEquals(normalizeAppIdentifier("メモ"), "%E3%83%A1%E3%83%A2");
  assertEquals(normalizeAppIdentifier("a b#c[d]\"<>"), "a%20b%23c%5Bd%5D%22%3C%3E");
  assertEquals(normalizeAppIdentifier("😀"), "%F0%9F%98%80");
});

Deno.test("識別子: 既存の % の 16 進は大文字にするだけで復号しない", () => {
  assertEquals(normalizeAppIdentifier("%e3%83%a1"), "%E3%83%A1");
  assertEquals(normalizeAppIdentifier("%41"), "%41");
  assertEquals(normalizeAppIdentifier("%E3%e3"), "%E3%E3");
});

Deno.test("識別子: 16 進が続かない % は %25 になる", () => {
  assertEquals(normalizeAppIdentifier("100%"), "100%25");
  assertEquals(normalizeAppIdentifier("%zz"), "%25zz");
  assertEquals(normalizeAppIdentifier("%4"), "%254");
  assertEquals(normalizeAppIdentifier("%%41"), "%25%41");
});

Deno.test("識別子: 大文字と小文字は区別し、正規化は冪等", () => {
  assertEquals(normalizeAppIdentifier("Memo") === normalizeAppIdentifier("memo"), false);
  for (const s of ["メモ", "a b", "%e3", "100%", "x%zz/y"]) {
    assertEquals(normalizeAppIdentifier(normalizeAppIdentifier(s)), normalizeAppIdentifier(s));
  }
});

Deno.test("識別子: 空と . は誤り（%2E も同じ）", () => {
  fails(() => normalizeAppIdentifier(""), "識別子が空です。");
  fails(() => normalizeAppIdentifier("."));
  fails(() => normalizeAppIdentifier("a.b"));
  fails(() => normalizeAppIdentifier("a%2eb"));
  fails(() => normalizeAppIdentifier("a%2Eb"));
});

Deno.test("提供リストの URL: https だけで、href に正規化する", () => {
  assertEquals(normalizeAppListUrl("HTTPS://Example.COM:443/apps/"), "https://example.com/apps/");
  assertEquals(normalizeAppListUrl("https://example.com"), "https://example.com/");
  fails(() => normalizeAppListUrl("http://example.com/apps/"));
  assertEquals(normalizeAppListUrl("http://localhost:8080/apps/", { allowHttp: true }), "http://localhost:8080/apps/");
  fails(() => normalizeAppListUrl("ftp://example.com/", { allowHttp: true }));
  fails(() => normalizeAppListUrl("example.com/apps/"));
  fails(() => normalizeAppListUrl(""));
});

Deno.test("提供リストの URL: クエリとフラグメントは（空でも）誤り", () => {
  for (const s of ["https://e.com/a/?x=1", "https://e.com/a/#m", "https://e.com/a/?", "https://e.com/a/#", "https://e.com/a?#"]) {
    fails(() => normalizeAppListUrl(s));
  }
});

Deno.test("完全な ID: URL の ID を作って読み戻せる", () => {
  const url = formatAppId({ list: "https://Example.com/apps/", id: "メモ" });
  assertEquals(url, "https://example.com/apps/#%E3%83%A1%E3%83%A2");
  assertEquals(parseAppId(url), { list: "https://example.com/apps/", id: "%E3%83%A1%E3%83%A2" });
  const sub = formatAppId({ list: "https://example.com/apps/", id: "memo", sub: "widget" });
  assertEquals(sub, "https://example.com/apps/#memo.widget");
  assertEquals(parseAppId(sub), { list: "https://example.com/apps/", id: "memo", sub: "widget" });
  assertEquals(formatAppId(parseAppId(sub)), sub);
});

Deno.test("完全な ID: 識別子に : や ? や / があっても URL の ID として読める", () => {
  const id = formatAppId({ list: "https://example.com/apps/", id: "a:b/c?d" });
  assertEquals(id, "https://example.com/apps/#a:b/c?d");
  assertEquals(parseAppId(id), { list: "https://example.com/apps/", id: "a:b/c?d" });
});

Deno.test("完全な ID: 生の ID と、そのサブアプリ", () => {
  assertEquals(formatAppId({ id: "cadre" }), "cadre");
  assertEquals(formatAppId({ id: "cadre", sub: "home" }), "cadre.home");
  assertEquals(parseAppId("cadre"), { id: "cadre" });
  assertEquals(parseAppId("cadre.home"), { id: "cadre", sub: "home" });
  assertEquals(parseAppId("メモ"), { id: "%E3%83%A1%E3%83%A2" });
});

Deno.test("完全な ID: 生の ID に : は使えず、: があれば URL の ID として読む", () => {
  fails(() => formatAppId({ id: "a:b" }), "生の ID に : は使えません。");
  fails(() => parseAppId("cadre:x"));
  fails(() => parseAppId("https://example.com/apps/"));
  fails(() => parseAppId("https://example.com/apps/#"));
  fails(() => parseAppId("https://example.com/apps/#memo.a.b"));
  fails(() => parseAppId("https://example.com/apps/#memo."));
  fails(() => parseAppId("https://example.com/apps/?x#memo"));
  fails(() => parseAppId("http://example.com/apps/#memo"));
  assertEquals(parseAppId("http://localhost/apps/#memo", { allowHttp: true }), { list: "http://localhost/apps/", id: "memo" });
  fails(() => parseAppId(""));
  fails(() => parseAppId("a.b.c"));
});
