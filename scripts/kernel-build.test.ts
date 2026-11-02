import { assert, assertEquals } from "@std/assert";
import { build } from "vite";
import { kernelVersion, systemLabel } from "./system-metadata.ts";

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
    await Deno.writeTextFile(`${publicDir}/manifest.json`, JSON.stringify({ version: "system-hash", files: [] }));
    await build({
      configFile: new URL("../vite.config.ts", import.meta.url).pathname,
      publicDir,
      logLevel: "silent",
      build: { outDir },
    });
    const source = await Deno.readTextFile(`${outDir}/sw.js`);
    assert(/^const CACHE = "binette-test-[0-9a-f]{16}";$/m.test(source));
    assert((await Deno.readTextFile(`${outDir}/index.html`)).includes(`<meta name="binette-kernel" content="${kernelVersion(source)}">`));
    const manifest = JSON.parse(await Deno.readTextFile(`${outDir}/manifest.json`));
    const { version } = JSON.parse(await Deno.readTextFile(new URL("../packages/regie/deno.json", import.meta.url)));
    assertEquals(manifest, { version: "system-hash", files: [], kernel: kernelVersion(source), label: await systemLabel(version, "system-hash", kernelVersion(source)) });
  } finally {
    await Deno.remove(outDir, { recursive: true });
    await Deno.remove(publicDir, { recursive: true });
  }
});

Deno.test("system だけの変更はカーネルの版を維持し、固定物だけの変更はカーネルと表示の版を変える", async () => {
  const stamps: string[] = [];
  const labels: string[] = [];
  for (const [icon, version] of [["<svg>a</svg>", "system-a"], ["<svg>a</svg>", "system-b"], ["<svg>b</svg>", "system-b"], ["<svg>b</svg>", "system-b"]]) {
    const outDir = await Deno.makeTempDir({ prefix: "binette-kernel-test-" });
    const publicDir = await Deno.makeTempDir({ prefix: "binette-public-test-" });
    try {
      await Deno.writeTextFile(`${publicDir}/sw.js`, 'const CACHE = "binette-test";\n');
      await Deno.writeTextFile(`${publicDir}/icon.svg`, icon);
      await Deno.writeTextFile(`${publicDir}/manifest.json`, JSON.stringify({ version, files: [] }));
      await build({
        configFile: new URL("../vite.config.ts", import.meta.url).pathname,
        publicDir,
        logLevel: "silent",
        build: { outDir },
      });
      stamps.push((await Deno.readTextFile(`${outDir}/sw.js`)).match(/const CACHE = "([^"]+)";/)![1]!);
      const manifest = JSON.parse(await Deno.readTextFile(`${outDir}/manifest.json`));
      assertEquals(manifest.kernel, stamps.at(-1));
      assertEquals(manifest.version, version);
      labels.push(manifest.label);
    } finally {
      await Deno.remove(outDir, { recursive: true });
      await Deno.remove(publicDir, { recursive: true });
    }
  }
  assertEquals(stamps[0], stamps[1]);
  assert(labels[0] !== labels[1]);
  assert(stamps[1] !== stamps[2]);
  assert(labels[1] !== labels[2]);
  assertEquals(stamps[2], stamps[3]);
  assertEquals(labels[2], labels[3]);
});
