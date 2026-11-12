import { buildApp } from "../packages/regie/src/build.ts";
import { readRepliqueLibraries } from "../packages/regie/src/cli.ts";
import { repliqueFiles } from "../packages/regie/test/replique.ts";
import { assert, assertEquals, assertThrows } from "@std/assert";
import { resolve } from "@std/path";
import { Window } from "happy-dom";
import { createAppStore, createMemoryFileTree, createProviderLists } from "../packages/regie/src/index.ts";
import { buildCompiler, bootLists } from "./build-system.ts";
import { catalogEntries, catalogHtml, catalogUrl } from "./catalog.ts";

const root = resolve(import.meta.dirname!, "..");
const commit = "0123456789abcdef0123456789abcdef01234567";

Deno.test("boot.json の提供リストは BINETTE_LISTS の https の URL だけを受け付ける", () => {
  const previous = Deno.env.get("BINETTE_LISTS");
  try {
    Deno.env.delete("BINETTE_LISTS");
    assertEquals(bootLists(), []);
  } finally {
    if (previous === undefined) Deno.env.delete("BINETTE_LISTS");
    else Deno.env.set("BINETTE_LISTS", previous);
  }
  assertEquals(bootLists(""), []);
  assertEquals(bootLists(" https://a.test/apps/ ,https://b.test/"), ["https://a.test/apps/", "https://b.test/"]);
  assertThrows(() => bootLists("http://a.test/"), Error, "https");
  assertThrows(() => bootLists("壊れた"), Error, "正しくありません");
});

Deno.test("既定の提供リストは catalog/ のアプリを commit の raw で載せ、OS が入れるときの integrity と一致する", async () => {
  const entries = await catalogEntries(root, commit);
  assertEquals(entries.map(entry => entry.id), ["docs"]);
  const libraries = await readRepliqueLibraries(resolve(root, "packages/replique"));
  for (const entry of entries) {
    const built = await buildApp(path => Deno.readTextFile(resolve(root, "catalog", entry.id, path)), { libraries });
    const imports = WebAssembly.Module.imports(await WebAssembly.compile(new Uint8Array(built.wasm)));
    const actual = Object.fromEntries(imports.filter(value => value.module !== "env").map(value => value.module.slice("binette:".length).split("@")));
    assertEquals(entry.requires, actual);
    assertEquals(Object.keys(entry.requires!), Object.keys(entry.requires!).sort());
    assert(!Object.hasOwn(entry.requires!, "env"));
    assert(entry.source.startsWith(`https://raw.githubusercontent.com/nozomi-hiragi/binette/${commit}/catalog/`));
    assert(entry.version.endsWith("+0123456"));
    assert(entry.integrity["/"]?.startsWith("sha256-"));
  }
  const listUrl = catalogUrl("v0.2.0");
  assertEquals(listUrl, "https://nozomi-hiragi.github.io/binette/apps/v0.2.0/");
  const html = catalogHtml("Binette v0.2.0", "v0.2.0", entries);
  // 埋め込みの JSON は、最初の </script> までで読み切れる
  const start = html.indexOf('id="binette-apps">') + 'id="binette-apps">'.length;
  assertEquals(JSON.parse(html.slice(start, html.indexOf("</script>", start))).apps, entries);
  assert(html.includes('<link rel="binette-apps" href="apps.json">'));

  const directory = await Deno.makeTempDir({ prefix: "binette-catalog-test-" });
  let compiler: Uint8Array;
  try { await buildCompiler(`${directory}/asc.js`); compiler = await Deno.readFile(`${directory}/asc.js`); }
  finally { await Deno.remove(directory, { recursive: true }); }
  const replique = await repliqueFiles();
  const window = new Window();
  const raw = `https://raw.githubusercontent.com/nozomi-hiragi/binette/${commit}/`;
  const lists = await createProviderLists({
    store: createAppStore(createMemoryFileTree()),
    // 一覧は JSON にリンクだけを残し、raw の代わりに作業ツリーのファイルを返す
    fetch: async input => {
      const url = String(input);
      if (url === listUrl) return new Response(html.replace(/<script type="application\/json"[\s\S]*?<\/script>/, ""));
      if (url === `${listUrl}apps.json`) return new Response(JSON.stringify({ name: "Binette v0.2.0", apps: entries }));
      if (url.startsWith(raw)) {
        try { return new Response(await Deno.readFile(resolve(root, decodeURIComponent(url.slice(raw.length))))); }
        catch { return new Response("無し", { status: 404 }); }
      }
      return new Response("無し", { status: 404 });
    },
    parseHtml: text => new window.DOMParser().parseFromString(text, "text/html") as unknown as Document,
    browserBuild: {
      distribution: { readSystem: path => Promise.resolve(path.endsWith("asc.js") ? compiler : replique.get(path)) },
      workerUrl: new URL("../packages/regie/test/fixtures/browser-build-worker.ts", import.meta.url),
    },
    report(error) { throw error; },
  });
  try {
    const list = await lists.add(listUrl);
    assertEquals(list.name, "Binette v0.2.0");
    for (const entry of entries) {
      const app = await lists.install(listUrl, entry.id);
      assertEquals(app.key, `${listUrl}#${entry.id}`);
      assertEquals(app.listVersion, entry.version);
    }
  } finally { lists.stop(); await window.happyDOM.close(); }
});
