import { assertEquals } from "@std/assert";
import { selectTests } from "./affected-tests.ts";

const graphs = new Map([
  ["packages/core/test/a.test.ts", new Set(["packages/core/test/a.test.ts", "packages/core/src/index.ts"])],
  ["packages/coulisses/test/b.test.ts", new Set(["packages/coulisses/test/b.test.ts", "packages/coulisses/src/index.ts", "packages/core/src/index.ts"])],
  ["packages/regie/test/c.test.ts", new Set(["packages/regie/test/c.test.ts", "packages/regie/src/index.ts", "packages/core/src/index.ts"])],
]);

Deno.test("文書と Pages だけの変更ではテストを走らせない", () => {
  assertEquals(selectTests(["README.md", "docs/spec/net.md", "landing/index.html", ".github/workflows/docs.yml"], graphs), { kind: "some", files: [] });
});

Deno.test("import の木に入っているテストだけを選ぶ", () => {
  assertEquals(selectTests(["packages/coulisses/src/index.ts"], graphs), { kind: "some", files: ["packages/coulisses/test/b.test.ts"] });
  assertEquals(selectTests(["packages/core/src/index.ts"], graphs), {
    kind: "some", files: ["packages/core/test/a.test.ts", "packages/coulisses/test/b.test.ts", "packages/regie/test/c.test.ts"],
  });
});

Deno.test("実行時に読まれるファイルの変更は、それを読む場所のテストを全部選ぶ", () => {
  assertEquals(selectTests(["apps/cadre/src/main.ts"], graphs), { kind: "some", files: ["packages/regie/test/c.test.ts"] });
});

Deno.test("規則に当たらない変更は全テストにする", () => {
  assertEquals(selectTests(["README.md", "deno.lock"], graphs), { kind: "all", reason: "deno.lock" });
  assertEquals(selectTests(["packages/coulisses/demo/server.ts"], graphs), { kind: "all", reason: "packages/coulisses/demo/server.ts" });
});
