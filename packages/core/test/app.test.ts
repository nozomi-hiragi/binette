import { assertEquals, assertThrows } from "@std/assert";
import { BinetteError, parseAppManifest } from "../src/index.ts";

const manifest = { id: "counter", name: "カウンター", entry: { html: "src/index.html", as: "src/main.ts" } };

Deno.test("app.json を読める", () => {
  const app = parseAppManifest(JSON.stringify({ ...manifest, entry: { ...manifest.entry, css: "src/style.css" } }));
  assertEquals(app.id, manifest.id);
  assertEquals(app.name, "カウンター");
  assertEquals(app.entry, { html: "src/index.html", css: "src/style.css", as: "src/main.ts" });
});

Deno.test("検査しない欄はそのまま残る", () => {
  const app = parseAppManifest(JSON.stringify({ ...manifest, version: "0.1.0", permissions: { storage: { reason: "保存" } }, extra: [1] }));
  assertEquals(app.version, "0.1.0");
  assertEquals(app.permissions, { storage: { reason: "保存" } });
  assertEquals(app.extra, [1]);
});

Deno.test("icon は任意の文字列で、ほかの型は BinetteError になる", () => {
  assertEquals(parseAppManifest(JSON.stringify(manifest)).icon, undefined);
  for (const icon of ["icon.svg", ""]) {
    assertEquals(parseAppManifest(JSON.stringify({ ...manifest, icon })).icon, icon);
  }
  for (const icon of [null, 1, true, [], {}]) {
    const error = assertThrows(() => parseAppManifest(JSON.stringify({ ...manifest, icon })), BinetteError);
    assertEquals(error.code, "invalid_format");
    assertEquals(error.message, "icon は文字列で指定してください。");
  }
});

Deno.test("形式が正しくない app.json は BinetteError になる", () => {
  for (const [text, message] of [
    ["{", "app.json を JSON として読めません。"],
    ["[]", "app.json はオブジェクトで指定してください。"],
    [JSON.stringify({ ...manifest, id: "" }), "id を指定してください。"],
    [JSON.stringify({ ...manifest, name: 1 }), "name を指定してください。"],
    [JSON.stringify({ id: manifest.id, name: manifest.name }), "entry はオブジェクトで指定してください。"],
    [JSON.stringify({ ...manifest, entry: { html: "", as: "a.ts" } }), "entry の html にはファイルのパスを指定してください。"],
    [JSON.stringify({ ...manifest, entry: { html: "a.html", as: "" } }), "entry の as にはファイルのパスを指定してください。"],
    [JSON.stringify({ ...manifest, entry: { ...manifest.entry, css: 1 } }), "entry の css は文字列で指定してください。"],
  ] as const) {
    const error = assertThrows(() => parseAppManifest(text), BinetteError, undefined, text);
    assertEquals(error.message, message, text);
  }
});

Deno.test("roles は任意の文字列の配列で、ほかの型は BinetteError になる", () => {
  assertEquals(parseAppManifest(JSON.stringify(manifest)).roles, undefined);
  for (const roles of [[], ["home"], ["home", "settings", "", "unknown"]]) {
    assertEquals(parseAppManifest(JSON.stringify({ ...manifest, roles })).roles, roles);
  }
  for (const roles of [null, 1, true, "home", {}, [1], ["home", null]]) {
    const error = assertThrows(() => parseAppManifest(JSON.stringify({ ...manifest, roles })), BinetteError);
    assertEquals(error.code, "invalid_format");
    assertEquals(error.message, "roles は文字列の配列で指定してください。");
  }
});

Deno.test("旧名の role は読み替えずに拒む", () => {
  const error = assertThrows(() => parseAppManifest(JSON.stringify({ ...manifest, role: "home" })), BinetteError);
  assertEquals(error.code, "invalid_format");
  assertEquals(error.message, "role は roles（文字列の配列）に変わりました。");
});

Deno.test("entry.html を省略できる", () => {
  assertEquals(parseAppManifest(JSON.stringify({ ...manifest, entry: { as: "src/main.ts" } })).entry, { as: "src/main.ts" });
});

Deno.test("sub を読み、識別子を正規化する", () => {
  const app = parseAppManifest(JSON.stringify({
    id: "cadre", name: "Cadre", entry: { as: "src/main.ts" },
    sub: { home: { name: "ホーム", icon: "home.svg", roles: ["home"] }, "設定": { name: "設定", listed: false } },
  }));
  assertEquals(app.sub, {
    home: { name: "ホーム", icon: "home.svg", roles: ["home"] },
    "%E8%A8%AD%E5%AE%9A": { name: "設定", listed: false },
  });
  assertEquals(parseAppManifest(JSON.stringify({ ...manifest, sub: {} })).sub, {});
  assertEquals(parseAppManifest(JSON.stringify(manifest)).sub, undefined);
});

Deno.test("sub の形が正しくないと BinetteError", () => {
  const sub = (value: unknown) => parseAppManifest(JSON.stringify({ ...manifest, sub: value }));
  for (const bad of [null, [], "x", { "a.b": { name: "n" } }, { "": { name: "n" } }, { "%2e": { name: "n" } },
    { a: null }, { a: {} }, { a: { name: "" } }, { a: { name: "n", icon: 1 } }, { a: { name: "n", roles: "home" } },
    { a: { name: "n", listed: "yes" } }, { "a%e3": { name: "n" }, "a%E3": { name: "n" } }]) {
    assertEquals(assertThrows(() => sub(bad), BinetteError).code, "invalid_format");
  }
});

Deno.test("既定で id の . を誤りにし、旧形式は明示したときだけ読める", () => {
  assertEquals(parseAppManifest(JSON.stringify(manifest)).id, manifest.id);
  assertEquals(parseAppManifest(JSON.stringify({ ...manifest, id: "memo" }), { strictId: true }).id, "memo");
  for (const id of ["io.github.example", "a%2Eb"]) {
    assertEquals(parseAppManifest(JSON.stringify({ ...manifest, id }), { strictId: false }).id, id);
    assertEquals(assertThrows(() => parseAppManifest(JSON.stringify({ ...manifest, id })), BinetteError).code, "invalid_format");
    assertEquals(assertThrows(() => parseAppManifest(JSON.stringify({ ...manifest, id }), { strictId: true }), BinetteError).code, "invalid_format");
  }
});
