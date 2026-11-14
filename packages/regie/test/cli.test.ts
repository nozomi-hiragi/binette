import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { hashFile } from "@binette/core";
import { collectAppFiles, computeAppIntegrity, readRepliqueLibraries } from "../src/cli.ts";

async function withApp(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "binette-integrity-" });
  try {
    await Deno.mkdir(join(dir, "src/sub"), { recursive: true });
    await Deno.mkdir(join(dir, ".git"));
    await Deno.writeTextFile(join(dir, "app.json"), "{}");
    await Deno.writeTextFile(join(dir, "src/main.ts"), "main");
    await Deno.writeTextFile(join(dir, "src/sub/a.ts"), "a");
    await Deno.writeTextFile(join(dir, ".DS_Store"), "junk");
    await Deno.writeTextFile(join(dir, ".git/HEAD"), "ref");
    await run(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("フォルダを再帰で集め、. で始まるものは含めない", async () => {
  await withApp(async (dir) => {
    assertEquals((await collectAppFiles(dir)).map((f) => f.path).sort(), ["app.json", "src/main.ts", "src/sub/a.ts"]);
  });
});

Deno.test("integrity: / とフォルダキーには Réplique を指定し、ファイルキーは直接読む", async () => {
  await withApp(async (dir) => {
    await assertRejects(() => computeAppIntegrity(dir), Error, "--replique");
    await assertRejects(() => computeAppIntegrity(dir, ["src/"]), Error, "フォルダキーのハッシュには --replique");
    await Deno.writeTextFile(join(dir, ".hidden"), "hidden");
    assertEquals(await computeAppIntegrity(dir, ["app.json", ".hidden"]), {
      "app.json": await hashFile(new TextEncoder().encode("{}")),
      ".hidden": await hashFile(new TextEncoder().encode("hidden")),
    });
    for (const key of ["../outside", "src/../app.json", "app.json?query", "app.json#fragment", "%61pp.json", "", "../", "src/../src/", "src/?query/", "src/#fragment/", "%73rc/", "//"]) {
      await assertRejects(() => computeAppIntegrity(dir, [key]), Error, "integrity のパスが正しくありません");
    }
    await assertRejects(() => computeAppIntegrity(dir, ["nope.ts"]));
  });
});

Deno.test("integrity: コマンドが JSON を出す", async () => {
  await withApp(async (dir) => {
    const run = (...args: string[]) => new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", join(import.meta.dirname!, "../src/cli.ts"), ...args], stdout: "piped", stderr: "piped",
    }).output();
    const ok = await run("integrity", dir, "app.json");
    assertEquals(ok.success, true);
    assertEquals(JSON.parse(new TextDecoder().decode(ok.stdout)), { "app.json": await hashFile(new TextEncoder().encode("{}")) });
    const bad = await run("integrity", dir, "nope.ts");
    assertEquals(bad.success, false);
    assertEquals(new TextDecoder().decode(bad.stderr).startsWith("ハッシュを求められません。"), true);
  });
});

Deno.test("--replique はパッケージルートの全機能を読み、旧ソースフォルダ・単一ファイル・欠損を拒む", async () => {
  const root = new URL("../../replique/", import.meta.url);
  const libraries = await readRepliqueLibraries(root);
  assertEquals(Object.keys(libraries).length, 15);
  assertEquals(libraries["jsr:@binette/replique"], await Deno.readTextFile(new URL("src/index.ts", root)));
  assertEquals(libraries["jsr:@binette/replique-ui@0.1.0"], await Deno.readTextFile(new URL("ui/src/index.ts", root)));
  for (const path of ["src/", "src/index.ts", "missing/"]) {
    await assertRejects(() => readRepliqueLibraries(new URL(path, root)), Error, "packages/replique");
  }
  const directory = await Deno.makeTempDir({ prefix: "binette-replique-" });
  try {
    await Deno.mkdir(join(directory, "src"));
    await Deno.writeTextFile(join(directory, "src/index.ts"), "export {};\n");
    await Deno.writeTextFile(join(directory, "deno.json"), JSON.stringify({ name: "@binette/replique", exports: "./src/index.ts" }));
    await assertRejects(() => readRepliqueLibraries(directory), Error, "app/deno.json");
    await Deno.mkdir(join(directory, "app/src"), { recursive: true });
    await Deno.writeTextFile(join(directory, "app/deno.json"), JSON.stringify({ name: "@binette/wrong", exports: "./src/index.ts", version: "0.1.0" }));
    await assertRejects(() => readRepliqueLibraries(directory), Error, "name または exports");
  } finally { await Deno.remove(directory, { recursive: true }); }
});

Deno.test("旧 import の原文を保ち、指定された integrity に一致する", async () => {
  const libraries = await readRepliqueLibraries(new URL("../../replique/", import.meta.url));
  await withApp(async (dir) => {
    await Deno.writeTextFile(join(dir, "app.json"), "{\"id\":\"legacy-import\",\"name\":\"旧 import\",\"entry\":{\"as\":\"src/main.ts\"}}");
    const source = `import { App, launch } from "jsr:@binette/replique";
import { View, text } from "jsr:@binette/replique/ui";
class Page extends App {
  build(): View { return text("旧 import"); }
}
launch(new Page());
`;
    await Deno.writeTextFile(join(dir, "src/main.ts"), source);
    assertEquals(await computeAppIntegrity(dir, [], { libraries }), { "/": "sha256-7IASST4H2I6kXEyhf5E61wQ9MRFTYUElVmbiGMt+/Wk=" });
    assertEquals(await Deno.readTextFile(join(dir, "src/main.ts")), source);
  });
});
