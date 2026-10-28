import { assert, assertRejects } from "@std/assert";
import { buildApp } from "../src/build.ts";

const libraries = { "jsr:@binette/replique": await Deno.readTextFile(new URL("../../replique/src/index.ts", import.meta.url)) };
const files: Record<string, string> = {
  "app.json": JSON.stringify({ id: "click-state", name: "クリックの状態", entry: { html: "index.html", as: "main.ts" } }),
  "index.html": "<p></p>",
};

Deno.test("ビルドに失敗する AS は Error になる", async () => {
  const error = await assertRejects(() => buildApp(path => Promise.resolve({ ...files, "main.ts": 'export function initialize(): void { const n: i32 = "文字"; }' }[path]!), { libraries }), Error, "アプリをビルドできません。");
  assert(error.message.includes("TS2322"));
});

