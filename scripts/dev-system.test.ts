import { assert, assertRejects } from "@std/assert";
import { createServer } from "vite";

Deno.test("開発用 HTML は生成目録の版を毎回読み、本番のカーネルの印と分ける", async () => {
  const publicDir = await Deno.makeTempDir({ prefix: "binette-dev-system-" });
  const server = await createServer({
    configFile: new URL("../vite.config.ts", import.meta.url).pathname,
    publicDir,
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  try {
    for (const version of ["a".repeat(64), "b".repeat(64)]) {
      await Deno.writeTextFile(`${publicDir}/manifest.json`, JSON.stringify({ version, kernel: "production-kernel", files: [] }));
      const html = await server.transformIndexHtml("/", "<html><head></head><body></body></html>");
      assert(html.includes(`<meta name="binette-dev-system" content="${version}">`));
      assert(!html.includes("binette-kernel"));
    }
    await Deno.writeTextFile(`${publicDir}/manifest.json`, JSON.stringify({ version: "invalid" }));
    await assertRejects(() => server.transformIndexHtml("/", "<head></head>"), Error, "開発用のシステムの版が不正");
    await Deno.remove(`${publicDir}/manifest.json`);
    await assertRejects(() => server.transformIndexHtml("/", "<head></head>"), Deno.errors.NotFound);
  } finally {
    await server.close();
    await Deno.remove(publicDir, { recursive: true });
  }
});
