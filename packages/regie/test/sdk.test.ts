import { BinetteError } from "@binette/core";
import { assertEquals, assertRejects } from "@std/assert";
import { buildApp, type Compiler } from "../src/build.ts";
import { readRepliqueLibraries } from "../src/cli.ts";
import { parseRepliqueVersions, REPLIQUE_FEATURES, repliqueVersions, resolveSdkSpecifier, satisfiesSdkVersion, sourceImports } from "../src/sdk.ts";

Deno.test("SDK 範囲は exact・^・~ の境界を SemVer と同じに扱う", () => {
  const cases: [string, string, boolean | undefined][] = [
    ["0.1.0", "0.1.0", true], ["0.1.1", "0.1.0", false],
    ["0.1.0", "^0.1", true], ["0.1.9", "^0.1.0", true], ["0.2.0", "^0.1", false], ["0.0.9", "^0.1", false],
    ["0.1.1", "~0.1", true], ["0.2.0", "~0.1.0", false], ["0.1.0", "~0.1.1", false],
    ["0.0.1", "^0.0.1", true], ["0.0.2", "^0.0.1", false], ["0.0.9", "^0.0", true], ["0.1.0", "^0.0", false],
    ["1.9.9", "^1.2.3", true], ["2.0.0", "^1.2.3", false], ["1.2.9", "~1.2.3", true], ["1.3.0", "~1.2.3", false],
    ["0.9.9", "^0", true], ["1.0.0", "^0", false], ["1.9.9", "~1", true], ["2.0.0", "~1", false],
    ...["", "0.1", "01.1.0", "^0.01", "~", "*", ">=0.1.0", "^0.1 || ^0.2", "0.1.0-beta", "0.1.0+build", " 0.1.0", "0.1.0\n", "^9007199254740992"].map(range => ["0.1.0", range, undefined] as [string, string, undefined]),
  ];
  for (const [version, range, expected] of cases) assertEquals(satisfiesSdkVersion(version, range), expected, `${version} / ${range}`);
});

Deno.test("不正・未知・範囲外の SDK は再 export や依存ソースでもコンパイラを呼ぶ前に拒む", async () => {
  const libraries = await readRepliqueLibraries(new URL("../../replique/", import.meta.url));
  for (const [specifier, message] of [
    ["jsr:@binette/replique-ui@^0.2", "要求 ^0.2、提供 0.1.0"],
    ["jsr:@binette/replique-storage@0.1.1", "要求 0.1.1、提供 0.1.0"],
    ["jsr:@binette/replique-app@~0.0", "要求 ~0.0、提供 0.1.0"],
    ["jsr:@binette/replique-unknown@^0.1", "機能「unknown」"],
    ["jsr:@binette/replique/unknown", "機能「unknown」"],
    ["jsr:@binette/replique-unknown", "機能「unknown」"],
    ...["jsr:@binette/replique-ui/extra", "jsr:@binette/replique-ui\n", "jsr:@binette/replique-ui@", "jsr:@binette/replique-ui@*", "jsr:@binette/replique-ui@0.1", "jsr:@binette/replique-ui@^0.1/foo", "jsr:@binette/replique/ui/extra", "jsr:@binette/replique/ui@^0.1", "jsr:@binette/replique/ui\n"].map(specifier => [specifier, "指定が正しくありません"]),
  ]) {
    for (const nested of [false, true]) {
      let called = false;
      const compiler: Compiler = { createMemoryStream() { called = true; throw new Error("コンパイラを呼びました"); }, main() { called = true; throw new Error("コンパイラを呼びました"); } };
      const sources: Record<string, string> = {
        "app.json": JSON.stringify({ id: "sdk", name: "SDK", entry: { as: "src/main.ts" } }),
        "src/main.ts": nested ? 'import "./nested";' : `export * from ${JSON.stringify(specifier)};`,
        "src/nested.ts": `export * from ${JSON.stringify(specifier)};`,
      };
      const error = await assertRejects(() => buildApp(path => Promise.resolve(sources[path]), { libraries, compiler }), BinetteError, message);
      assertEquals(error.code, "unsupported_sdk");
      assertEquals(called, false);
    }
  }
});

Deno.test("SDK の版一覧は配布した完全な版から作り、配列や欠損・余分な機能・範囲指定を拒む", async () => {
  const versions = repliqueVersions(await readRepliqueLibraries(new URL("../../replique/", import.meta.url)));
  assertEquals(parseRepliqueVersions(versions), versions);
  for (const bad of [{ ...versions, ui: "^0.1" }, { ...versions, ui: "0.1" }, { ...versions, ui: 1 }, { ...versions, unknown: "0.1.0" }, { ...versions, ui: undefined }]) {
    let rejected = false;
    try { parseRepliqueVersions(bad); } catch { rejected = true; }
    assertEquals(rejected, true);
  }
});

Deno.test("静的 import の検査はコメントと文字列を無視し、引用符のエスケープを解く", () => {
  const source = `// import "ignored";
/* export * from "ignored"; */
const text = 'import "ignored";';
const template = \`export * from "ignored";\`;
import /* コメント */ { View } from "jsr:@binette/replique-ui@^0.1";
export * from 'jsr:@binette/replique-app@0.1.0';
import './side';
import "\\u002e/escaped";`;
  assertEquals(sourceImports(source).map(value => value.specifier), ["jsr:@binette/replique-ui@^0.1", "jsr:@binette/replique-app@0.1.0", "./side", "./escaped"]);
});

Deno.test("版なしの全機能は固定の初期版でなく提供中の版へ解決し、旧入口・完全版と一致する", () => {
  const versions = Object.fromEntries(REPLIQUE_FEATURES.map((feature, i) => [feature, i % 2 ? "0.1.7" : "1.2.3"]));
  for (const feature of REPLIQUE_FEATURES) {
    const exact = `jsr:@binette/replique-${feature}@${versions[feature]}`;
    assertEquals(resolveSdkSpecifier(`jsr:@binette/replique-${feature}`, versions), exact);
    assertEquals(resolveSdkSpecifier(`jsr:@binette/replique/${feature}`, versions), exact);
    assertEquals(resolveSdkSpecifier(exact, versions), exact);
  }
});
