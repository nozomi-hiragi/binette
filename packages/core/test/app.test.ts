import assert from "node:assert/strict";
import { test } from "node:test";
import { BinetteError, parseAppManifest } from "../src/index.ts";

const manifest = { id: "io.github.example.counter", name: "カウンター", entry: { html: "src/index.html", as: "src/main.ts" } };

test("app.json を読める", () => {
  const app = parseAppManifest(JSON.stringify({ ...manifest, entry: { ...manifest.entry, css: "src/style.css" } }));
  assert.equal(app.id, manifest.id);
  assert.equal(app.name, "カウンター");
  assert.deepEqual(app.entry, { html: "src/index.html", css: "src/style.css", as: "src/main.ts" });
});

test("検査しない欄はそのまま残る", () => {
  const app = parseAppManifest(JSON.stringify({ ...manifest, version: "0.1.0", permissions: { storage: { reason: "保存" } }, extra: [1] }));
  assert.equal(app.version, "0.1.0");
  assert.deepEqual(app.permissions, { storage: { reason: "保存" } });
  assert.deepEqual(app.extra, [1]);
});

test("形式が正しくない app.json は BinetteError になる", () => {
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
    assert.throws(() => parseAppManifest(text), (error: unknown) => error instanceof BinetteError && error.message === message, text);
  }
});
