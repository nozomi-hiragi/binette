import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { computeIntegrity, hashFile } from "@binette/core";
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

Deno.test("integrity: 既定は / で、キーごとのハッシュを返す", async () => {
  await withApp(async (dir) => {
    const files = [
      { path: "app.json", bytes: new TextEncoder().encode("{}") },
      { path: "src/main.ts", bytes: new TextEncoder().encode("main") },
      { path: "src/sub/a.ts", bytes: new TextEncoder().encode("a") },
    ];
    assertEquals(await computeAppIntegrity(dir), { "/": await computeIntegrity(files, "/") });
    assertEquals(await computeAppIntegrity(dir, ["src/", "app.json"]), {
      "src/": await computeIntegrity(files, "src/"),
      "app.json": await hashFile(new TextEncoder().encode("{}")),
    });
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
