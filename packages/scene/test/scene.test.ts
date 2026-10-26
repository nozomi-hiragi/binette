import { assert, assertEquals, assertMatch, assertRejects } from "@std/assert";
import { serveApp, type RegieWorker } from "@binette/regie";
import { DOMParser } from "@b-fuze/deno-dom";
// 描画とクリックは happy-dom で試す。deno-dom には style が無く、click のイベントも届かないため
import { Window } from "happy-dom";
import { buildApp, type HtmlParser, mountApp } from "../src/index.ts";

const root = new URL("../../..", import.meta.url);
const replique = await Deno.readTextFile(new URL("packages/replique/src/index.ts", root));
const parser = new DOMParser() as unknown as HtmlParser;
const libraries = { "jsr:@binette/replique": replique };
const files: Record<string, string> = {
  "app.json": JSON.stringify({ id: "click-state", name: "クリックの状態", entry: { html: "index.html", as: "main.ts" } }),
  "index.html": '<p bina="count">0</p><button bina-on-click="increment">+1</button>',
  "main.ts": `import { count } from "./bina";
let value = 0;
export function start(): void { count.text = "0"; }
export function increment(): void { value++; count.text = value.toString(); }
`,
};
const read = (path: string) => Promise.resolve(files[path]!);

/** 同じスレッドの MessageChannel に serveApp をつないだ Worker */
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

/** 条件が成り立つまで待つ */
async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert(condition(), "待っても表示が変わりませんでした");
}

Deno.test("文字列のアプリをビルドし、連続クリックで状態を更新できる", async () => {
  const built = await buildApp(read, { libraries, parser });
  assertEquals(built.manifest.id, "click-state");
  assertMatch(built.html, /bina-on-click="increment"/);
  assertEquals(built.bindings.elements.count, { count: 1, kinds: [{ tag: "p" }] });
  assertEquals(built.bindings.clicks, ["increment"]);

  const window = new Window();
  try {
    const element = window.document.createElement("div") as unknown as HTMLElement;
    window.document.body.append(element as never);
    const errors: unknown[] = [];
    const mounted = await mountApp(element, built, { createWorker, onError: (error) => errors.push(error) });
    try {
      const text = element.querySelector("[bina=count]")!;
      const button = element.querySelector("button")!;
      assertEquals(text.textContent, "0");
      button.click();
      await waitFor(() => text.textContent === "1");
      button.click();
      await waitFor(() => text.textContent === "2");
      assertEquals(errors, []);
    } finally {
      mounted.stop();
    }
  } finally {
    await window.happyDOM.close();
  }
});

Deno.test("同じ名前の要素はまとめて変わり、text を読むと最後に書いた値が返る", async () => {
  const files: Record<string, string> = {
    "app.json": JSON.stringify({ id: "x", name: "x", entry: { html: "i.html", as: "m.ts" } }),
    "i.html": '<h1 bina="name"></h1><p bina="name"></p><p bina="echo"></p><button bina-on-click="copy">写す</button>',
    "m.ts": `import { elem } from "jsr:@binette/replique";
export function start(): void { elem("name").text = "あ"; }
export function copy(): void { elem("echo").text = elem("name").text + "[" + elem("unset").text + "]"; }
`,
  };
  const built = await buildApp(async (path) => files[path]!, { libraries, parser });
  const window = new Window();
  try {
    // アプリの領域の外にある同じ名前の要素は変えない
    const outside = window.document.createElement("p");
    outside.setAttribute("bina", "name");
    outside.textContent = "外";
    const element = window.document.createElement("div") as unknown as HTMLElement;
    window.document.body.append(outside, element as never);
    const mounted = await mountApp(element, built, { createWorker });
    try {
      assertEquals([...element.querySelectorAll("[bina=name]")].map((target) => target.textContent), ["あ", "あ"]);
      assertEquals(outside.textContent, "外");
      element.querySelector("button")!.click();
      const echo = element.querySelector("[bina=echo]")!;
      await waitFor(() => echo.textContent === "あ[]");
    } finally {
      mounted.stop();
    }
  } finally {
    await window.happyDOM.close();
  }
});

Deno.test("ビルドに失敗する AS は Error になる", async () => {
  const files: Record<string, string> = {
    "app.json": JSON.stringify({ id: "x", name: "x", entry: { html: "i.html", as: "m.ts" } }),
    "i.html": "<p></p>",
    "m.ts": 'export function start(): void { const n: i32 = "文字"; }',
  };
  const error = await assertRejects(
    () => buildApp(async (path) => files[path]!, { libraries, parser }),
    Error,
    "アプリをビルドできません。",
  );
  assert(error.message.includes("TS2322"));
});

Deno.test("行は template の後ろに増え、文字・アイコン・クリックが行だけに届き clear で消える", async () => {
  const files = {
    "app.json": JSON.stringify({ id: "list", name: "一覧", entry: { html: "i.html", as: "m.ts" } }),
    "i.html": '<p bina="name">外</p><div><template bina="tiles"><button bina-on-click="openApp"><img bina-icon alt=""><span bina="name"></span></button><i bina="name"></i></template><b>末尾</b></div>',
    "m.ts": `import { tiles } from "./bina"; import { apps, elem } from "jsr:@binette/replique";
export function start(): void { for (let i = 0; i < apps.count(); i++) { const item = tiles.add(); item.elem("name").text = apps.name(i); item.icon(i); } elem("name").text = "外だけ"; }
export function openApp(row: i32): void { apps.open(row); }
export function clear(): void { tiles.clear(); }
export function again(): void { const item = tiles.add(); item.elem("name").text = "再開"; item.icon(1); }
`,
  };
  const built = await buildApp(async (path) => files[path as keyof typeof files], { libraries, parser });
  const window = new Window(); const element = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.append(element as never); const opened: number[] = [];
  const icon = '<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>';
  let init: Record<string, unknown> | undefined;
  const mounted = await mountApp(element, built, { createWorker() {
    const worker = createWorker();
    return { ...worker, postMessage(message, transfer) {
      if ((message as { type: string }).type === "init") init = message as Record<string, unknown>;
      worker.postMessage(message, transfer);
    } };
  }, apps: [{ id: "a", name: "一", icon }, { id: "b", name: "二" }], onOpen: (i) => opened.push(i) });
  try {
    assertEquals(init!.apps, [{ id: "a", name: "一" }, { id: "b", name: "二" }]);
    assertEquals(element.querySelector("p")!.textContent, "外だけ");
    assertEquals([...element.querySelectorAll("span")].map((e) => e.textContent), ["一", "二"]);
    assertEquals([...element.querySelectorAll("i")].map((e) => e.textContent), ["一", "二"]);
    assertEquals([...element.querySelector("div")!.children].map((e) => e.tagName.toLowerCase()), ["template", "button", "i", "button", "i", "b"]);
    assertEquals(element.querySelector("img")!.getAttribute("src"), `data:image/svg+xml;charset=utf-8,${encodeURIComponent(icon)}`);
    assertEquals(element.querySelectorAll("img")[1]!.getAttribute("src"), null);
    assertEquals(element.querySelector("script"), null);
    element.querySelectorAll<HTMLButtonElement>("button")[1]!.querySelector("span")!.click();
    await waitFor(() => opened.length === 1); assertEquals(opened, [1]);
    await mounted.app.call("clear"); assertEquals(element.querySelectorAll("button").length, 0);
    assertEquals(element.querySelector("template")!.content.querySelector("span")!.textContent, "");
    await mounted.app.call("again"); assertEquals(element.querySelector("span")!.textContent, "再開");
    element.querySelector<HTMLButtonElement>("button")!.click(); await waitFor(() => opened.length === 2); assertEquals(opened, [1, 0]);
  } finally { mounted.stop(); await window.happyDOM.close(); }
});
