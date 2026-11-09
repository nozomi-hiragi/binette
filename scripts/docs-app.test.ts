import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { BLOCK, blocks, DOCS, FIELD, inline, OUTPUT, pageId, readPages, render, resolveLink, SPAN, TARGET } from "./docs-app.ts";

const ids = new Set(["", "spec/", "spec/app-id", "spec/regie/", "spec/regie/run"]);

Deno.test("ドキュメントアプリの中身は docs/ から生成したものと一致する", async () => {
  assertEquals(await Deno.readTextFile(OUTPUT), render(await readPages(fromFileUrl(DOCS))), "deno task docs:app で作り直してください");
});

Deno.test("ページの ID は README と index をフォルダにする", () => {
  assertEquals(pageId("index.md"), "");
  assertEquals(pageId("spec/README.md"), "spec/");
  assertEquals(pageId("spec/regie/run.md"), "spec/regie/run");
});

Deno.test("リンクは docs のページ、API、GitHub に分ける", () => {
  assertEquals(resolveLink("../regie/run.md#開始", "spec/apps/home.md", ids), { page: "spec/regie/run", anchor: "開始" });
  assertEquals(resolveLink("./spec/", "index.md", ids), { page: "spec/", anchor: "" });
  assertEquals(resolveLink("#方針", "spec/app-id.md", ids), { page: "spec/app-id", anchor: "方針" });
  assertEquals(resolveLink("README.md", "spec/regie/run.md", ids), { page: "spec/regie/", anchor: "" });
  assertEquals(resolveLink("./api/", "index.md", ids), { url: "https://nozomi-hiragi.github.io/binette/v0.2.0/api/" });
  assertEquals(resolveLink("../../packages/core/src/index.ts", "spec/app.md", ids), { url: "https://github.com/nozomi-hiragi/binette/blob/v0.2.0/packages/core/src/index.ts" });
  assertEquals(resolveLink("https://example.com/", "index.md", ids), { url: "https://example.com/" });
});

Deno.test("段落の中の code、太字、リンクを区切る", () => {
  assertEquals(inline("a `x|y` **b** [c `d`](./run.md) *e* \\*", "spec/regie/README.md", ids).split(SPAN), [
    "ta ", "cx|y", "t ", "bb", "t ", `lspec/regie/run#${TARGET}c d`, "t e *",
  ]);
});

Deno.test("見出し、箇条書き、表、コード、引用、区切り線を読む", () => {
  const md = [
    "# 題 `x`", "", "前の行", "つづき", "and", "more", "", "- 一", "  続き", "  - 二", "1. 三", "",
    "| 名前 | 説明 |", "| --- | --- |", "| `a\\|b` | c |", "",
    "```ts", "  const a = 1;", "```", "", "> [!NOTE]", "> メモです", "", "---", "", "## 題 x",
  ].join("\n");
  const out = blocks(md, "spec/app-id.md", ids).map((block) => block.split(FIELD));
  assertEquals(out, [
    ["h", "1", "題-x", `t題 ${SPAN}cx`],
    ["p", "t前の行つづきand more"],
    ["u", "0", "t一続き"],
    ["u", "1", "t二"],
    ["o", "0", "1", "t三"],
    ["t", "96,96", "t名前", "t説明"],
    ["r", "ca|b", "tc"],
    ["c", "  const a = 1;"],
    ["q", "メモ", "tメモです"],
    ["-"],
    ["h", "2", "題-x-1", "t題 x"],
  ]);
  assertEquals(BLOCK.length, 1);
});
