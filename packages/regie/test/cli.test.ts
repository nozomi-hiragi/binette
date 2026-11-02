import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { hashFile } from "@binette/core";
import { collectAppFiles, computeAppIntegrity } from "../src/cli.ts";

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
