import { assertEquals, assertThrows } from "@std/assert";
import { parsePrebuiltApp, type PrebuiltApp, stringifyPrebuiltApp } from "../src/prebuilt.ts";
import { writePrebuiltApp } from "../src/cli.ts";

const app: PrebuiltApp = {
  manifest: { id: "example", name: "例", entry: { html: "index.html", as: "main.ts" } },
  html: "<p>例</p>", icon: "<svg/>", wasm: new Uint8Array([0, 1, 127, 128, 254, 255]),
};
Deno.test(".binapp は全バイトと日本語、任意の icon を往復できる", () => {
  assertEquals(parsePrebuiltApp(stringifyPrebuiltApp(app)), app);
  const { icon: _, ...withoutIcon } = app;
  assertEquals(parsePrebuiltApp(stringifyPrebuiltApp(withoutIcon)), withoutIcon);
  assertEquals(parsePrebuiltApp(stringifyPrebuiltApp({ ...withoutIcon, wasm: new Uint8Array() })).wasm, new Uint8Array());
});
Deno.test(".binapp の形式名・版・欄・manifest の誤りは日本語の Error", () => {
  const valid = JSON.parse(stringifyPrebuiltApp(app));
  for (const text of ["{", "null", "[]", ...[
    { format: "other" }, { version: "0.3" }, { html: null }, { icon: null }, { wasm: 1 }, { wasm: "!" },
    { wasm: "a" }, { manifest: null }, { manifest: { ...app.manifest, name: 1 } },
  ].map((patch) => JSON.stringify({ ...valid, ...patch }))]) {
    const error = assertThrows(() => parsePrebuiltApp(text), Error);
    assertEquals(/[ぁ-んァ-ヶ一-龠]/.test(error.message), true);
  }
  for (const field of ["format", "version", "manifest", "html", "wasm"]) {
    const value = { ...valid };
    delete value[field];
    assertThrows(() => parsePrebuiltApp(JSON.stringify(value)), Error);
  }
});
Deno.test("CLI build は .binapp を書き、manifest と SVG が一致する", async () => {
  const dir = await Deno.makeTempDir();
  const root = new URL("../../..", import.meta.url);
  try {
    const out = `${dir}/apps/counter.binapp`;
    const command = new Deno.Command(Deno.execPath(), { args: ["run", "-A", "packages/scene/src/cli.ts", "build", "examples/counter", "--out", out,
      "--replique", "packages/replique/src/index.ts"], cwd: root });
    const result = await command.output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    const built = parsePrebuiltApp(await Deno.readTextFile(out));
    assertEquals(built.manifest, JSON.parse(await Deno.readTextFile(new URL("examples/counter/app.json", root))));
    assertEquals(built.icon, await Deno.readTextFile(new URL(`examples/counter/${built.manifest.icon}`, root)));
    assertEquals(WebAssembly.validate(built.wasm as Uint8Array<ArrayBuffer>), true);
  } finally { await Deno.remove(dir, { recursive: true }); }
});
Deno.test("CLI はフォルダ外のアイコンをビルド前に拒む", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/app.json`, JSON.stringify({ ...app.manifest, icon: "../secret.svg" }));
    try {
      await writePrebuiltApp(dir, `${dir}/app.binapp`, "存在しないファイル");
      throw new Error("拒まれませんでした");
    } catch (error) {
      assertEquals((error as Error).message, "アプリのアイコンは app.json のフォルダ内の相対パスにしてください。");
    }
  } finally { await Deno.remove(dir, { recursive: true }); }
});
