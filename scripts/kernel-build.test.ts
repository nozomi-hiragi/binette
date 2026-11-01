import { assert, assertEquals } from "@std/assert";
import { build } from "vite";

Deno.test("配布カーネルと Worker は独立した固定名で、HTML の SRI が実バイトと一致する", async () => {
  const outDir = await Deno.makeTempDir({ prefix: "binette-kernel-test-" });
  try {
    await build({
      configFile: new URL("../vite.config.ts", import.meta.url).pathname,
      publicDir: false,
      logLevel: "silent",
      build: { outDir },
    });
    const files = Array.from(Deno.readDirSync(outDir), (entry) => entry.name).sort();
    assertEquals(files, ["build-worker.js", "index.html", "regie-worker.js", "regie.js"]);
    const kernel = await Deno.readFile(`${outDir}/regie.js`);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-384", kernel));
    const expected = `sha384-${btoa(String.fromCharCode(...digest))}`;
    const html = await Deno.readTextFile(`${outDir}/index.html`);
    const script = html.match(/<script\b[^>]*src="\.\/regie\.js"[^>]*>/)?.[0];
    assert(script?.includes(`integrity="${expected}"`));
    const source = new TextDecoder().decode(kernel);
    assert(source.includes("regie-worker.js"));
    assert(!source.includes("createObjectURL"));
    // 圧縮後の Worker も実際に起動し、WASM の ready と call を確かめる。
    const worker = new Worker(new URL(`file://${outDir}/regie-worker.js`), { type: "module" });
    try {
      const next = () => new Promise<MessageEvent>((resolve, reject) => {
        worker.addEventListener("message", resolve, { once: true });
        worker.addEventListener("error", reject, { once: true });
      });
      let reply = next();
      worker.postMessage({ type: "init", wasm: new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]).buffer });
      assertEquals((await reply).data, { type: "ready", exports: [] });
      reply = next();
      worker.postMessage({ type: "call", id: 1, name: "missing", args: [] });
      assertEquals((await reply).data.type, "fail");
    } finally { worker.terminate(); }
  } finally { await Deno.remove(outDir, { recursive: true }); }
});

Deno.test("ビルドは sw.js のキャッシュの版にカーネルのハッシュを足す", async () => {
  const outDir = await Deno.makeTempDir({ prefix: "binette-kernel-test-" });
  const publicDir = await Deno.makeTempDir({ prefix: "binette-public-test-" });
  try {
    await Deno.writeTextFile(`${publicDir}/sw.js`, 'const CACHE = "binette-test";\n');
    await build({
      configFile: new URL("../vite.config.ts", import.meta.url).pathname,
      publicDir,
      logLevel: "silent",
      build: { outDir },
    });
    const source = await Deno.readTextFile(`${outDir}/sw.js`);
    assert(/^const CACHE = "binette-test-[0-9a-f]{16}";$/m.test(source));
    const files = await Promise.all(["regie.js", "regie-worker.js", "build-worker.js"].map((name) => Deno.readFile(`${outDir}/${name}`)));
    const bytes = new Uint8Array(files.reduce((size, file) => size + file.byteLength, 0));
    let offset = 0;
    for (const file of files) {
      bytes.set(file, offset);
      offset += file.byteLength;
    }
    const stamp = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
    assertEquals(source, `const CACHE = "binette-test-${stamp}";\n`);
  } finally {
    await Deno.remove(outDir, { recursive: true });
    await Deno.remove(publicDir, { recursive: true });
  }
});

Deno.test("ビルドは入口のほかの固定物が変わっても sw.js のキャッシュの版を変える", async () => {
  const stamps: string[] = [];
  for (const icon of ["<svg>a</svg>", "<svg>b</svg>"]) {
    const outDir = await Deno.makeTempDir({ prefix: "binette-kernel-test-" });
    const publicDir = await Deno.makeTempDir({ prefix: "binette-public-test-" });
    try {
      await Deno.writeTextFile(`${publicDir}/sw.js`, 'const CACHE = "binette-test";\n');
      await Deno.writeTextFile(`${publicDir}/icon.svg`, icon);
      await build({
        configFile: new URL("../vite.config.ts", import.meta.url).pathname,
        publicDir,
        logLevel: "silent",
        build: { outDir },
      });
      stamps.push((await Deno.readTextFile(`${outDir}/sw.js`)).match(/const CACHE = "([^"]+)";/)![1]!);
    } finally {
      await Deno.remove(outDir, { recursive: true });
      await Deno.remove(publicDir, { recursive: true });
    }
  }
  assert(stamps[0] !== stamps[1]);
});
