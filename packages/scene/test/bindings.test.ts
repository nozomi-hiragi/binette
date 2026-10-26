import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { Window } from "happy-dom";
import { buildApp, generateBindingsSource, type HtmlParser, parseBindings } from "../src/index.ts";
import { writeBindings } from "../src/cli.ts";
import { appPath } from "../src/paths.ts";

const window = new Window();
const parser = new window.DOMParser() as unknown as HtmlParser;
const replique = await Deno.readTextFile(new URL("../../replique/src/index.ts", import.meta.url));
const libraries = { "jsr:@binette/replique": replique };
const header = '// bina.ts（HTML から自動生成。手で書き換えない）\nimport { elem } from "jsr:@binette/replique";\n';

Deno.test("HTML の名前・数・種類・クリックを出現順で集める", () => {
  const bindings = parseBindings('<p bina="x"></p><input bina="x"><input bina="x" type="NUMBER"><input bina="x" type="number"><span bina="toString" bina-on-click="elem"></span><button bina-on-click="run"></button><i bina-on-click="elem"></i>', parser);
  assertEquals<unknown>({ ...bindings.elements }, {
    x: { count: 4, kinds: [{ tag: "p" }, { tag: "input", type: "text" }, { tag: "input", type: "number" }] },
    toString: { count: 1, kinds: [{ tag: "span" }] },
  });
  assertEquals(bindings.clicks, ["elem", "run"]);
});

Deno.test("使えない名前は理由と名前を示す", () => {
  for (const attr of ["bina", "bina-on-click"]) {
    for (const name of ["", "1x", "x-y", "class", "readonly", "i32", "__x"]) {
      assertThrows(() => parseBindings(`<p ${attr}="${name}"></p>`, parser), Error, `「${name}」`);
    }
  }
  assertThrows(() => parseBindings('<p bina="elem"></p>', parser), Error, "import");
  assertThrows(() => parseBindings('<p bina-on-click="_start"></p>', parser), Error, "初期化");
});

Deno.test("生成するソースは名前順で末尾改行が 1 つ", () => {
  assertEquals(generateBindingsSource(parseBindings('<p bina="z"></p><p bina="a"></p>', parser)), header + '\nexport const a = elem("a");\nexport const z = elem("z");\n');
  assertEquals(generateBindingsSource(parseBindings("", parser)), header);
});

function files(html: string, source: string): Record<string, string> {
  return {
    "app.json": JSON.stringify({ id: "x", name: "x", entry: { html: "index.html", as: "./src/sub/../main.ts" } }),
    "index.html": html,
    "src/main.ts": source,
  };
}

Deno.test("生成した bina と相対 import を使い、古いファイルは読まない", async () => {
  const app = files('<p bina="count"></p>', 'import { count } from "./bina"; import { value } from "./sub/../util"; export function start(): void { count.text = value(); }');
  app["src/util.ts"] = 'export function value(): string { return "ok"; }';
  app["src/bina.ts"] = "これは古いファイル";
  const reads: string[] = [];
  const built = await buildApp(async (path) => { reads.push(path); if (!(path in app)) throw new Error(path); return app[path]!; }, { libraries, parser });
  assertEquals(built.bindings.elements.count, { count: 1, kinds: [{ tag: "p" }] });
  assertEquals(reads.includes("src/bina.ts"), false);
  assertEquals(reads.includes("src/util.ts"), true);
});

Deno.test("HTML に無い名前の import と export の無いクリックはビルドを止める", async () => {
  for (const [html, source, message] of [
    ['<p bina="count"></p>', 'import { absent } from "./bina"; export function start(): void { absent.text = "x"; }', "アプリをビルドできません。"],
    ['<button bina-on-click="missing"></button>', 'export function start(): void {}', "missing"],
  ]) {
    const app = files(html!, source!);
    await assertRejects(() => buildApp(async (path) => app[path]!, { libraries, parser }), Error, message);
  }
});

Deno.test("フォルダ外の import を read に渡さず、空の生成ファイルもビルドできる", async () => {
  const app = files("", 'import "./bina"; export function start(): void {}');
  await buildApp(async (path) => app[path]!, { libraries, parser });
  app["src/main.ts"] = 'import { value } from "../../outside"; export function start(): void { value(); }';
  const reads: string[] = [];
  await assertRejects(() => buildApp(async (path) => { reads.push(path); return app[path]!; }, { libraries, parser }), Error, "アプリをビルドできません。");
  assertEquals(reads.some((path) => path.includes("outside") || path.startsWith("..")), false);
});

Deno.test("CLI は HTML と同じソースを書き出す", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/src`);
    const app = files('<p bina="count"></p>', "");
    for (const [path, value] of Object.entries(app)) await Deno.writeTextFile(`${dir}/${path}`, value);
    const output = await writeBindings(dir);
    assertEquals(output, `${dir}/src/bina.ts`);
    assertEquals(await Deno.readTextFile(output), generateBindingsSource(parseBindings(app["index.html"]!, parser)));
  } finally { await Deno.remove(dir, { recursive: true }); }
});

Deno.test("カウンターの生成ファイルが HTML と一致する", async () => {
  const root = new URL("../../../examples/counter/", import.meta.url);
  const html = await Deno.readTextFile(new URL("src/index.html", root));
  assertEquals(await Deno.readTextFile(new URL("src/bina.ts", root)), generateBindingsSource(parseBindings(html, parser)));
});

Deno.test("エンコードした .. や % を含むパスは受け付けない", async () => {
  for (const path of ["./%2e%2e/x.ts", "%2E%2E/x.ts", "src/%2f../x.ts", "src/a%20b.ts"]) assertEquals(appPath(path), null, path);
  const app = files("", "export function start(): void {}");
  app["app.json"] = JSON.stringify({ id: "x", name: "x", entry: { html: "%2e%2e/index.html", as: "src/main.ts" } });
  const reads: string[] = [];
  await assertRejects(() => buildApp(async (path) => { reads.push(path); return app[path]!; }, { libraries, parser }), Error, "フォルダ内の相対パス");
  assertEquals(reads, ["app.json"]);
});

Deno.test("entry.as が bina.ts だと、ビルドも書き出しも止まり、入口を上書きしない", async () => {
  const app = files('<p bina="count"></p>', "export function start(): void {}");
  app["app.json"] = JSON.stringify({ id: "x", name: "x", entry: { html: "index.html", as: "src/bina.ts" } });
  app["src/bina.ts"] = "export function start(): void {}";
  await assertRejects(() => buildApp(async (path) => app[path]!, { libraries, parser }), Error, "bina.ts という名前は使えません");
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/src`);
    for (const [path, value] of Object.entries(app)) await Deno.writeTextFile(`${dir}/${path}`, value);
    await assertRejects(() => writeBindings(dir), Error, "bina.ts という名前は使えません");
    assertEquals(await Deno.readTextFile(`${dir}/src/bina.ts`), app["src/bina.ts"]);
  } finally { await Deno.remove(dir, { recursive: true }); }
});
