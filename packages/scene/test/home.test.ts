import { assert, assertEquals } from "@std/assert";
import { createMemoryAppStore, installedAppKey, type AppStore, type InstalledApp, type RegieWorker, serveApp } from "@binette/regie";
import { DOMParser } from "@b-fuze/deno-dom";
import { Window } from "happy-dom";
import { buildApp, type Compiler, type HtmlParser, loadCompiler, mountHome } from "../src/index.ts";

const root = new URL("../../..", import.meta.url);
const parser = new DOMParser() as unknown as HtmlParser;
const libraries = { "jsr:@binette/replique": await Deno.readTextFile(new URL("packages/replique/src/index.ts", root)) };
const apps = ["counter", "hello"].map((name) => ({
  source: `https://example.com/${name}/`,
  read: (path: string) => Deno.readTextFile(new URL(`apps/${name}/${path}`, root)),
}));
const fixtures: InstalledApp[] = [];
for (const app of apps) {
  const built = await buildApp(app.read, { parser, libraries });
  fixtures.push({ manifest: built.manifest, html: built.html, wasm: built.wasm, key: installedAppKey(app.source, built.manifest.id), source: app.source,
    icon: await app.read(built.manifest.icon!), installedAt: 1 });
}
async function savedStore(): Promise<AppStore> {
  const store = createMemoryAppStore();
  for (const app of fixtures) await store.put(app);
  return store;
}
function elementIn(window: Window): HTMLElement {
  const element = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.append(element as never);
  return element;
}
async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert(condition(), "待ってもホームの状態が変わりませんでした");
}
function workers() {
  let live = 0;
  let maximum = 0;
  let created = 0;
  let terminated = 0;
  let ready = 0;
  return {
    get live() { return live; }, get maximum() { return maximum; },
    get created() { return created; }, get terminated() { return terminated; },
    get ready() { return ready; },
    createWorker(): RegieWorker {
      live++; created++; maximum = Math.max(maximum, live);
      const { port1, port2 } = new MessageChannel();
      port1.start(); port2.start();
      serveApp(port1 as never);
      let stopped = false;
      return {
        postMessage: (message, transfer) => port2.postMessage(message, transfer as never),
        addEventListener: (type, listener) => port2.addEventListener(type, ((event: MessageEvent) => {
          if (event.data.type === "ready") ready++;
          listener(event);
        }) as never),
        terminate() {
          if (stopped) return;
          stopped = true; live--; terminated++;
          port1.close(); port2.close();
        },
      };
    },
  };
}
function heldWorker() {
  let listener: ((event: MessageEvent) => void) | undefined;
  const messages: unknown[] = [];
  let terminated = 0;
  return {
    messages, get terminated() { return terminated; },
    emit(data: unknown) { listener?.({ data } as MessageEvent); },
    createWorker: (): RegieWorker => ({
      postMessage: (message) => { messages.push(message); },
      addEventListener: (_type, callback) => { listener = callback; },
      terminate: () => { terminated++; },
    }),
  };
}

Deno.test("2 つ並び、アイコンは img の data URL、開いて戻ると Worker が止まる", async () => {
  const window = new Window();
  const element = elementIn(window);
  const worker = workers();
  const errors: unknown[] = [];
  const store = createMemoryAppStore();
  const asc = await loadCompiler();
  let builds = 0;
  const compiler: Compiler = { ...asc, main(argv, options) { builds++; return asc.main(argv, options); } };
  const before = Date.now();
  const home = await mountHome(element, { apps, store, parser, compiler, libraries,
    createWorker: worker.createWorker, onError: (error) => errors.push(error) });
  try {
    const tiles = element.querySelectorAll<HTMLButtonElement>(".bina-home-tile");
    assertEquals([...tiles].map((button) => button.textContent), ["カウンター", "ハロー"]);
    assertEquals(builds, 2);
    const records = await store.list();
    assertEquals(records.length, 2);
    assert(records.every((app) => app.installedAt >= before && app.installedAt <= Date.now()));
    assertEquals(element.querySelector("svg"), null);
    assertEquals(tiles[0]!.querySelector("img")!.getAttribute("src"),
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fixtures[0]!.icon!)}`);
    tiles[0]!.click();
    await waitFor(() => worker.ready === 1 && element.querySelector("[bina=count]")?.textContent === "0");
    tiles[1]!.click();
    assertEquals(worker.created, 1);
    element.querySelector<HTMLButtonElement>("[bina-on-click=increment]")!.click();
    await waitFor(() => element.querySelector("[bina=count]")?.textContent === "1");
    element.querySelector<HTMLButtonElement>(".bina-home-back")!.click();
    assertEquals(worker.live, 0);
    assertEquals(element.querySelector("[bina=count]"), null);
    assertEquals(element.querySelector<HTMLElement>(".bina-home-grid")!.hidden, false);
    tiles[1]!.click();
    await waitFor(() => worker.ready === 2);
    element.querySelector<HTMLButtonElement>("[bina-on-click=greet]")!.click();
    await waitFor(() => element.querySelector("[bina=greeting]")?.textContent === "ハロー、Binette！");
    home.stop(); home.stop();
    assertEquals(worker.live, 0);
    assertEquals(worker.maximum, 1);
    assertEquals(worker.terminated, 2);
    assertEquals(element.childNodes.length, 0);
    tiles[0]!.click();
    assertEquals(worker.created, 2);
    assertEquals(errors, []);

    const noBuild: Compiler = { ...asc, main() { throw new Error("再ビルドしてはいけません"); } };
    const cachedApps = apps.map((app) => ({ ...app, async read(path: string) {
      assertEquals(path, "app.json");
      return await app.read(path);
    } }));
    const again = await mountHome(element, { apps: cachedApps, store, compiler: noBuild, createWorker: worker.createWorker,
      onError: (error) => errors.push(error) });
    try {
      assertEquals(element.querySelectorAll(".bina-home-tile").length, 2);
      element.querySelector<HTMLButtonElement>(".bina-home-tile")!.click();
      await waitFor(() => worker.ready === 3 && element.querySelector("[bina=count]")?.textContent === "0");
      assertEquals(errors, []);
    } finally { again.stop(); }
  } finally { home.stop(); await window.happyDOM.close(); }
});

Deno.test("版が変わるとビルドし直して保存する", async () => {
  const window = new Window();
  const element = elementIn(window);
  const store = await savedStore();
  const asc = await loadCompiler();
  let builds = 0;
  const compiler: Compiler = { ...asc, main(argv, options) { builds++; return asc.main(argv, options); } };
  const app = apps[1]!;
  const home = await mountHome(element, { apps: [{ ...app, async read(path) {
    const text = await app.read(path);
    return path === "app.json" ? JSON.stringify({ ...JSON.parse(text), version: "0.2.0" }) : text;
  } }], store, parser, compiler, libraries });
  try {
    assertEquals(builds, 1);
    assertEquals((await store.get(fixtures[1]!.key))!.manifest.version, "0.2.0");
    assertEquals(element.querySelectorAll(".bina-home-tile").length, 1);
  } finally { home.stop(); await window.happyDOM.close(); }
});

Deno.test("アプリごとの読み込み・保存の失敗があっても残りを使える", async () => {
  const window = new Window();
  const element = elementIn(window);
  const errors: unknown[] = [];
  const store = await savedStore();
  const home = await mountHome(element, { apps: [
    { source: "bad", read: () => Promise.resolve("{") },
    apps[0]!, apps[1]!,
  ], store: { ...store, get(key) {
    if (key === fixtures[0]!.key) return Promise.reject(new Error("保存先を読めません"));
    return store.get(key);
  } }, onError: (error) => errors.push(error) });
  try {
    assertEquals(errors.length, 2);
    assertEquals(element.querySelector(".bina-home-tile")!.textContent, "ハロー");
    assertEquals(element.querySelectorAll(".bina-home-tile").length, 1);
  } finally { home.stop(); await window.happyDOM.close(); }
});

Deno.test("フォルダの外を指す icon は読まずに誤りにする", async () => {
  const window = new Window();
  const element = elementIn(window);
  const errors: unknown[] = [];
  const read: string[] = [];
  const app = apps[0]!;
  const home = await mountHome(element, { apps: [{ source: app.source, async read(path) {
    read.push(path);
    const text = await app.read(path);
    return path === "app.json" ? JSON.stringify({ ...JSON.parse(text), icon: "../secret.svg" }) : text;
  } }], store: createMemoryAppStore(), parser, libraries, onError: (error) => errors.push(error) });
  try {
    assertEquals(read, ["app.json"]);
    assertEquals(errors.map((error) => (error as Error).message), ["アプリのアイコンは app.json のフォルダ内の相対パスにしてください。"]);
    assertEquals(element.querySelectorAll(".bina-home-tile").length, 0);
  } finally { home.stop(); await window.happyDOM.close(); }
});

Deno.test("名前や SVG をホームの HTML として差し込まない", async () => {
  const window = new Window();
  const element = elementIn(window);
  const store = await savedStore();
  const app = structuredClone(fixtures[0]!);
  app.manifest.name = '<img src=x onerror="alert(1)">';
  app.icon = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
  await store.put(app);
  const home = await mountHome(element, { apps: [apps[0]!], store });
  try {
    const tile = element.querySelector(".bina-home-tile")!;
    assertEquals(tile.textContent, app.manifest.name);
    assertEquals(tile.querySelectorAll("img").length, 1);
    assertEquals(tile.querySelector("script"), null);
    assertEquals(tile.querySelector("img")!.getAttribute("src"), `data:image/svg+xml;charset=utf-8,${encodeURIComponent(app.icon)}`);
  } finally { home.stop(); await window.happyDOM.close(); }
});

for (const action of ["back", "stop"] as const) {
  for (const phase of ["ready", "resolved", "start"] as const) {
    Deno.test(`${phase} 待ちの間に ${action} しても Worker や遅い描画が残らない`, async () => {
      const window = new Window();
      const element = elementIn(window);
      const worker = heldWorker();
      const errors: unknown[] = [];
      const home = await mountHome(element, { apps: [apps[0]!], store: await savedStore(), parser,
        createWorker: worker.createWorker, onError: (error) => errors.push(error) });
      try {
        element.querySelector<HTMLButtonElement>(".bina-home-tile")!.click();
        if (phase === "resolved") worker.emit({ type: "ready", exports: [] });
        if (phase === "start") {
          worker.emit({ type: "ready", exports: ["start"] });
          await waitFor(() => worker.messages.length === 2);
        }
        if (action === "stop") home.stop();
        else element.querySelector<HTMLButtonElement>(".bina-home-back")!.click();
        assertEquals(worker.terminated, 1);
        worker.emit({ type: "ready", exports: ["start"] });
        worker.emit({ type: "text", name: "count", value: "遅い表示" });
        worker.emit({ type: "done", id: 1 });
        await new Promise((resolve) => setTimeout(resolve, 0));
        assertEquals(element.querySelector(".bina-home-app"), null);
        assertEquals(worker.terminated, 1);
        assertEquals(errors, []);
        assertEquals(element.querySelectorAll(".bina-home-tile").length, action === "stop" ? 0 : 1);
      } finally { home.stop(); await window.happyDOM.close(); }
    });
  }
}

Deno.test("起動に失敗したらホームへ戻り、ほかのアプリを開ける", async () => {
  const window = new Window();
  const element = elementIn(window);
  const worker = heldWorker();
  const good = workers();
  const errors: unknown[] = [];
  let first = true;
  const home = await mountHome(element, { apps, store: await savedStore(), parser,
    createWorker() {
      if (first) { first = false; return worker.createWorker(); }
      return good.createWorker();
    }, onError: (error) => errors.push(error) });
  try {
    const tiles = element.querySelectorAll<HTMLButtonElement>(".bina-home-tile");
    tiles[0]!.click();
    worker.emit({ type: "failed", message: "起動の失敗" });
    await waitFor(() => errors.length === 1);
    assertEquals(worker.terminated, 1);
    assertEquals(element.querySelector(".bina-home-app"), null);
    assertEquals(element.querySelector<HTMLElement>(".bina-home-grid")!.hidden, false);
    tiles[1]!.click();
    await waitFor(() => good.ready === 1);
    element.querySelector<HTMLButtonElement>("[bina-on-click=greet]")!.click();
    await waitFor(() => element.querySelector("[bina=greeting]")?.textContent === "ハロー、Binette！");
    assertEquals(errors.length, 1);
  } finally { home.stop(); await window.happyDOM.close(); }
});

Deno.test("プリビルドは compiler を呼ばず保存し、開いて動く。同じ版は保存結果を使い、違う版は置き換える", async () => {
  const window = new Window();
  const element = elementIn(window);
  const store = createMemoryAppStore();
  const worker = workers();
  const errors: unknown[] = [];
  const compiler: Compiler = {
    main() { throw new Error("compiler を呼んではいけません"); },
    createMemoryStream() { throw new Error("compiler を呼んではいけません"); },
  };
  const prebuiltApps = fixtures.map((app) => ({ source: app.source, prebuilt: app }));
  let home = await mountHome(element, { apps: prebuiltApps, store, compiler, createWorker: worker.createWorker, onError: (error) => errors.push(error) });
  try {
    assertEquals(element.querySelectorAll(".bina-home-tile").length, 2);
    assertEquals((await store.list()).length, 2);
    element.querySelector<HTMLButtonElement>(".bina-home-tile")!.click();
    await waitFor(() => worker.ready === 1 && element.querySelector("[bina=count]")?.textContent === "0");
    element.querySelector<HTMLButtonElement>("[bina-on-click=increment]")!.click();
    await waitFor(() => element.querySelector("[bina=count]")?.textContent === "1");
    home.stop();
    // 同じ版でも、保存結果は prebuilt で入れ直す。入れた日時は保つ
    const saved = (await store.get(fixtures[0]!.key))!;
    await store.put({ ...saved, html: "古い保存結果", installedAt: 123 });
    home = await mountHome(element, { apps: prebuiltApps, store, compiler });
    assertEquals((await store.get(saved.key))!.html, fixtures[0]!.html);
    assertEquals((await store.get(saved.key))!.installedAt, 123);
    home.stop();
    const changed = { ...fixtures[0]!, manifest: { ...fixtures[0]!.manifest, version: "0.3.0" } };
    home = await mountHome(element, { apps: [{ source: changed.source, prebuilt: changed }], store, compiler });
    assertEquals((await store.get(saved.key))!.manifest.version, "0.3.0");
    assertEquals((await store.get(saved.key))!.html, changed.html);
    assertEquals((await store.get(saved.key))!.installedAt, 123);
    assertEquals(errors, []);
  } finally { home.stop(); await window.happyDOM.close(); }
});
