// JSR の公開物を想定したファイルだけを抽出し、外部の利用者として動かして確かめる。
import { copy, exists } from "@std/fs";
import { join } from "@std/path";
import { PUBLISHED } from "./check-version.ts";

const ROOT = join(import.meta.dirname!, "..");

function run(command: string, args: string[], cwd: string): void {
  const process = new Deno.Command(command, {
    args,
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  }).outputSync();
  if (!process.success) {
    throw new Error(`Command failed with code ${process.code}: ${command} ${args.join(" ")}`);
  }
}

const temp = Deno.makeTempDirSync({ prefix: "binette-check-pack-" });
try {
  // 各パッケージの publish.include に含まれるファイルだけを一時ディレクトリに写す
  for (const [dir, name] of Object.entries(PUBLISHED)) {
    const pkgDir = join(ROOT, dir);
    const destDir = join(temp, dir);
    Deno.mkdirSync(destDir, { recursive: true });

    const denoJsonPath = join(pkgDir, "deno.json");
    const denoJson = JSON.parse(Deno.readTextFileSync(denoJsonPath)) as {
      publish?: { include?: string[] };
    };
    const includes = denoJson.publish?.include ?? [];
    for (const item of ["deno.json", ...includes]) {
      const src = join(pkgDir, item);
      const dest = join(destDir, item);
      if (await exists(src)) {
        await copy(src, dest);
      } else {
        throw new Error(`${name}: missing included file or directory ${item}`);
      }
    }
    console.log(`${name}: extracted included files`);
  }

  const consumer = join(temp, "consumer");
  Deno.mkdirSync(consumer, { recursive: true });

  Deno.writeTextFileSync(
    join(consumer, "deno.json"),
    JSON.stringify(
      {
        compilerOptions: {
          lib: ["esnext", "dom", "dom.iterable", "deno.ns"],
        },
        imports: {
          "@binette/core": "../packages/core/src/index.ts",
          "@binette/regie": "../packages/regie/src/index.ts",
          "@binette/scene": "../packages/scene/src/index.ts",
          "@binette/scene/cli": "../packages/scene/src/cli.ts",
          "@std/path": "jsr:@std/path@^1.1.6",
          "@binette/coulisses": "../packages/coulisses/src/index.ts",
          "@binette/replique": "../packages/replique/src/index.ts",
          "@std/assert": "jsr:@std/assert@1",
          valibot: "npm:valibot@1.5.0",
          "assemblyscript/asc": "npm:assemblyscript@0.28.20/asc",
        },
      },
      null,
      2,
    ),
  );

  Deno.writeTextFileSync(
    join(consumer, "consumer.ts"),
    `import { assertEquals, assertThrows } from "@std/assert";
import { BINETTE_VERSION, BinetteError, State, DestroyKind, DestroyCause, parseAppManifest, parseBinette, type AppManifest, type Binette } from "@binette/core";
import { startSystem, createMemoryAppStore, type SystemUi, type SystemView, startProcess, type Process, type ProcessOptions, launchApp, serveApp, type LaunchOptions, type RegieApp, type RegieWorker } from "@binette/regie";
import { buildApp, mountApp, type BuiltApp, type MountedApp } from "@binette/scene";
import { createCoulisses, createPanoplie, type Coulisses } from "@binette/coulisses";

const binette: Binette = parseBinette(JSON.stringify({ binette: BINETTE_VERSION, redirect: "/home" }));
assertEquals(binette.redirect, "/home");
assertThrows(() => parseBinette("{"), BinetteError);
assertThrows(() => parseAppManifest("{"), BinetteError);

// 公開物のファイルだけで、AS をビルドして Worker 相当（MessageChannel）で動かす
const files: Record<string, string> = {
  "app.json": JSON.stringify({ id: "example.counter", name: "カウンター", entry: { html: "src/index.html", as: "src/main.ts" } }),
  "src/index.html": '<p id="count">0</p>',
  "src/main.ts": 'import { App, Last, document, launch } from "jsr:@binette/replique";\\nclass Counter extends App { onCreate(_last: Last): void { document.getElementById("count").textContent = "0"; } }\\nlaunch(new Counter());\\n',
};
const replique = await Deno.readTextFile(new URL("../packages/replique/src/index.ts", import.meta.url));
const built = await buildApp(async (path) => files[path]!, { libraries: { "jsr:@binette/replique": replique } });
assertEquals(built.manifest.id, "example.counter");

function createWorker(): RegieWorker {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  serveApp(port1 as never);
  return {
    postMessage: (message, transfer) => port2.postMessage(message, transfer as never),
    addEventListener: (type, listener) => port2.addEventListener(type, listener as never),
    terminate: () => { port1.close(); port2.close(); },
  };
}

const batches: import("@binette/core").DomOp[][] = [];
const app = await launchApp(built.wasm, {
  createWorker,
  onDom: (ops) => batches.push(ops),
});
assertEquals([...app.exports], []);
await app.call("__bina_lifecycle", 1, 0, 1);
assertEquals(batches, [[{ op: "byId", handle: 1, id: "count" }, { op: "text", handle: 1, value: "0" }]]);
app.stop();

const coulisses = createCoulisses({ panoplie: createPanoplie({ index: { binette: BINETTE_VERSION, redirect: "/home" } }) });
const response = await coulisses.fetch(new Request("http://localhost/index.bina"));
assertEquals(response.status, 200);
assertEquals(parseBinette(await response.text()).redirect, "/home");

// 型の宣言・利用もチェック
const manifest: AppManifest = parseAppManifest(JSON.stringify({ id: "t", name: "t", entry: { html: "a", as: "b" } }));
const options: LaunchOptions = { onDom: (ops) => void ops, callTimeout: 5000, page: "consumer", onFinish: () => {} };
const launch: (wasm: Uint8Array) => Promise<RegieApp> = (wasm) => launchApp(wasm, options);
const build: (read: (path: string) => Promise<string>) => Promise<BuiltApp> = (read) => buildApp(read);
const mount: (element: HTMLElement, html: string, process: Process) => MountedApp = mountApp;
const processOptions: ProcessOptions = { createWorker, stopDelay: 10000 };
const process = await startProcess(built.wasm, processOptions);
const processBatches: import("@binette/core").DomOp[][] = [];
process.attach(ops => { if (ops.length) processBatches.push(ops); });
assertEquals(process.state, State.None);
await process.begin();
assertEquals(process.state, State.Resume);
assertEquals(processBatches, batches);
const destroy = (process: Process): Promise<void> => process.destroy(DestroyKind.System, DestroyCause.Stack);
await destroy(process);
const views: SystemView[] = [];
const ui: SystemUi = {
  present(_instance, process) { process.attach(() => {}); return { remove() {} }; },
  update(view) { views.push(view); },
  report(error) { throw error; },
};
const system = await startSystem({
  apps: [{ source: "binette:system", prebuilt: { ...built, manifest: { ...built.manifest, role: "home" } } }],
  store: createMemoryAppStore(), ui, createWorker,
});
assertEquals(views.at(-1)?.instances.length, 0);
await system.openHome();
assertEquals(views.at(-1)?.instances.length, 1);
system.setPage({ visible: false, frozen: true });
system.stop();
assertEquals(State.Resume, 3);
const c: Coulisses = createCoulisses();
void [manifest, launch, build, mount, destroy, c];

console.log("Consumer passed (core, regie, scene, coulisses, replique)");
`,
  );

  run(Deno.execPath(), ["check", "consumer.ts"], consumer);
  run(Deno.execPath(), ["run", "-A", "consumer.ts"], consumer);
  console.log("Check-pack consumer check passed");
} finally {
  Deno.removeSync(temp, { recursive: true });
}
