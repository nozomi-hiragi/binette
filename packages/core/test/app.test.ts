import { assertEquals, assertThrows } from "@std/assert";
import { BinetteError, parseAppManifest } from "../src/index.ts";

const manifest = { id: "io.github.example.counter", name: "カウンター", entry: { html: "src/index.html", as: "src/main.ts" } };

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
    [JSON.stringify({ ...manifest, entry: { as: "a.ts" } }), "entry の html にはファイルのパスを指定してください。"],
    [JSON.stringify({ ...manifest, entry: { html: "a.html", as: "" } }), "entry の as にはファイルのパスを指定してください。"],
    [JSON.stringify({ ...manifest, entry: { ...manifest.entry, css: 1 } }), "entry の css は文字列で指定してください。"],
  ] as const) {
    const error = assertThrows(() => parseAppManifest(text), BinetteError, undefined, text);
    assertEquals(error.message, message, text);
  }
});
