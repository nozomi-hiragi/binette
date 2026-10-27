import { assert, assertEquals, assertRejects } from "@std/assert";
import { serveApp, type RegieWorker } from "@binette/regie";
import { Window } from "happy-dom";
import { buildApp, mountApp } from "../src/index.ts";

const libraries = { "jsr:@binette/replique": await Deno.readTextFile(new URL("../../replique/src/index.ts", import.meta.url)) };
const files: Record<string, string> = {
  "app.json": JSON.stringify({ id: "click-state", name: "クリックの状態", entry: { html: "index.html", as: "main.ts" } }),
  "index.html": '<p id="count">0</p><button id="button">+1</button>',
  "main.ts": `import { document, Event } from "jsr:@binette/replique";
let value = 0;
export function start(): void { document.getElementById("button").addEventListener("click", increment); }
function increment(event: Event): void {
 assert(event.type == "click"); assert(event.currentTarget === document.getElementById("button"));
 value++; document.getElementById("count").textContent = value.toString();
}`,
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

Deno.test("document の同じ id は同じ Element で、クリックの currentTarget と状態を保つ", async () => {
  const built = await buildApp(read, { libraries });
  const window = new Window(); const element = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.append(element as never);
  const errors: unknown[] = [];
  const mounted = await mountApp(element, built, { createWorker, onError: e => errors.push(e) });
  try {
    assert(!mounted.app.exports.includes("__bina_event"));
    const button = element.querySelector<HTMLButtonElement>("button")!;
    button.click(); await waitFor(() => element.querySelector("p")!.textContent === "1");
    button.click(); await waitFor(() => element.querySelector("p")!.textContent === "2");
    assertEquals(errors, []);
    mounted.stop(); button.click(); await new Promise(resolve => setTimeout(resolve, 0));
    assertEquals(errors, []);
  } finally { mounted.stop(); await window.happyDOM.close(); }
});

Deno.test("作成・追加・削除、文字と class の読み書き、アイコンを反映する", async () => {
  const source = `import { document, apps, Element, Event } from "jsr:@binette/replique";
const tiles = document.getElementById("tiles");
const button = document.createElement("BUTTON");
const indices = new Map<Element, i32>();
export function start(): void {
 assert(tiles === document.getElementById("tiles"));
 assert(tiles.textContent == ""); assert(tiles.className == "");
 tiles.textContent = "";
 button.className = "tile"; assert(button.className == "tile");
 const img = document.createElement("img"); apps.icon(img, 0); button.appendChild(img);
 const span = document.createElement("span"); span.textContent = "あ"; assert(span.textContent == "あ");
 assert(button.appendChild(span) === span);
 indices.set(button, 0); button.addEventListener("click", open); tiles.appendChild(button);
}
function open(event: Event): void { assert(event.currentTarget === button); apps.open(indices.get(event.currentTarget)); }
export function remove(): void { button.remove(); }
export function again(): void { tiles.appendChild(button); button.textContent = "文字だけ"; }
export function clearIcon(): void { apps.icon(document.getElementById("old-icon"), 1); apps.icon(tiles, 0); }
`;
  const built = await buildApp(path => Promise.resolve({ ...files, "index.html": '<div id="tiles"><p>消える</p></div><img id="old-icon" src="old">', "main.ts": source }[path]!), { libraries });
  const window = new Window(); const element = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.append(element as never); const opened: number[] = [];
  const icon = '<svg><script>bad()</script></svg>';
  const mounted = await mountApp(element, built, { createWorker, apps: [{ id: "a", name: "一", icon }, { id: "b", name: "二" }], onOpen: i => opened.push(i) });
  try {
    const button = element.querySelector<HTMLButtonElement>("button")!;
    assertEquals(button.type, "button"); assertEquals(button.className, "tile"); assertEquals(button.textContent, "あ");
    assertEquals(element.querySelector("p"), null);
    assertEquals(element.querySelector("img")!.getAttribute("src"), `data:image/svg+xml;charset=utf-8,${encodeURIComponent(icon)}`);
    assertEquals(element.querySelector("img")!.getAttribute("alt"), ""); assertEquals(element.querySelector("script"), null);
    button.querySelector<HTMLSpanElement>("span")!.click(); await waitFor(() => opened.length === 1); assertEquals(opened, [0]);
    await mounted.app.call("remove"); assertEquals(element.querySelector("button"), null);
    await mounted.app.call("again"); assertEquals(button.textContent, "文字だけ"); assertEquals(button.children.length, 0);
    await mounted.app.call("clearIcon"); assertEquals(element.querySelector("#old-icon")!.getAttribute("src"), null);
    assertEquals(element.querySelector("#tiles")!.hasAttribute("src"), false);
  } finally { mounted.stop(); await window.happyDOM.close(); }
});

Deno.test("無い id・枠自身・枠外には届かず、byId は毎回探し直す", async () => {
  const special = 'a"\\]#あ';
  const source = `import { document } from "jsr:@binette/replique";
const e = document.getElementById("same");
export function start(): void {
 document.getElementById("host").textContent = "壊す";
 document.getElementById("host").remove();
 e.appendChild(document.getElementById("host"));
 document.getElementById("missing").textContent = "無い";
 document.getElementById("missing").remove();
 document.getElementById("missing").addEventListener("click", () => {});
 e.textContent = "内";
 document.getElementById(${JSON.stringify(special)}).textContent = "特殊";
}
export function update(): void { e.textContent = "再検索"; }
`;
  const built = await buildApp(path => Promise.resolve({ ...files, "index.html": '<p id="same"></p>', "main.ts": source }[path]!), { libraries });
  const window = new Window(); const element = window.document.createElement("div") as unknown as HTMLElement;
  element.id = "host"; const outside = window.document.createElement("p"); outside.id = "same"; outside.textContent = "外";
  const missing = window.document.createElement("p"); missing.id = "missing"; missing.textContent = "外";
  window.document.body.append(outside, missing, element as never);
  const mounted = await mountApp(element, built, { createWorker });
  try {
    assertEquals(outside.textContent, "外"); assertEquals(missing.textContent, "外"); assertEquals(element.querySelector("p")!.textContent, "内");
    element.querySelector("p")!.remove(); const replacement = window.document.createElement("p"); replacement.id = "same"; element.append(replacement as never);
    await mounted.app.call("update"); assertEquals(replacement.textContent, "再検索");
    const escaped = window.document.createElement("p"); escaped.id = special; element.append(escaped as never);
    await mounted.app.call("start"); assertEquals(escaped.textContent, "特殊");
  } finally { mounted.stop(); await window.happyDOM.close(); }
});

Deno.test("禁止タグと click 以外は onError に届き、アプリは動き続ける", async () => {
  const source = `import { document } from "jsr:@binette/replique";
export function start(): void {
 const tags = ["script", "iframe", "object", "a", "style", "template"];
 for (let i = 0; i < tags.length; i++) {
   const bad = document.createElement(tags[i]); bad.textContent = "危険"; bad.className = "bad";
   document.getElementById("count").appendChild(bad); bad.remove();
 }
 document.getElementById("button").addEventListener("input", () => {});
}
export function next(): void { document.getElementById("count").textContent = "続く"; }`;
  const built = await buildApp(path => Promise.resolve({ ...files, "main.ts": source }[path]!), { libraries });
  const window = new Window(); const element = window.document.createElement("div") as unknown as HTMLElement;
  const errors: unknown[] = []; const mounted = await mountApp(element, built, { createWorker, onError: e => errors.push(e) });
  try {
    assertEquals(errors.length, 7); assertEquals(element.querySelector(".bad"), null);
    await mounted.app.call("next"); assertEquals(element.querySelector("p")!.textContent, "続く");
  } finally { mounted.stop(); await window.happyDOM.close(); }
});

Deno.test("ビルドに失敗する AS は Error になる", async () => {
  const error = await assertRejects(() => buildApp(path => Promise.resolve({ ...files, "main.ts": 'export function start(): void { const n: i32 = "文字"; }' }[path]!), { libraries }), Error, "アプリをビルドできません。");
  assert(error.message.includes("TS2322"));
});

for (const phase of ["ready", "start", "mounted"] as const) {
  Deno.test(phase + " の終了は元のエラーを保ち、クリックと重複通知を止める", async () => {
    const window = new Window();
    const element = window.document.createElement("div") as unknown as HTMLElement;
    const errors: unknown[] = []; const exits: Error[] = []; const messages: unknown[] = [];
    const listeners = new Map<string, (event: never) => void>();
    const emit = (type: string, event: unknown) => listeners.get(type)?.(event as never);
    let terminated = 0;
    const built = await buildApp(read, { libraries });
    const mounting = mountApp(element, built, {
      createWorker: () => ({
        postMessage(message) { messages.push(message); },
        addEventListener(type, listener) { listeners.set(type, listener as (event: never) => void); },
        terminate() { terminated++; },
      }),
      onError: e => errors.push(e), onExit: e => exits.push(e),
    });
    emit("message", { data: { type: "ready", exports: ["start", "increment"] } });
    if (phase !== "ready") await waitFor(() => messages.length === 2);
    let mounted: Awaited<ReturnType<typeof mountApp>> | undefined;
    try {
      if (phase === "mounted") {
        emit("message", { data: { type: "dom", ops: [{ op: "byId", handle: 1, id: "button" }, { op: "listen", handle: 1, type: "click", listener: 0 }] } });
        emit("message", { data: { type: "done", id: 1 } });
        mounted = await mounting;
        element.querySelector<HTMLButtonElement>("button")!.click();
        element.querySelector<HTMLButtonElement>("button")!.click();
        assertEquals(messages.length, 4);
      }
      emit("error", { message: "元のエラー", preventDefault() {} });
      if (phase !== "mounted") await assertRejects(() => mounting, Error, "アプリが落ちました: 元のエラー");
      else {
        await new Promise(resolve => setTimeout(resolve, 0));
        assertEquals(exits.length, 1);
        assertEquals(exits[0]!.message, "アプリが落ちました: 元のエラー");
      }
      const count = messages.length;
      element.querySelector<HTMLButtonElement>("button")!.click();
      await new Promise(resolve => setTimeout(resolve, 0));
      assertEquals(messages.length, count);
      assertEquals(errors, []); assertEquals(exits.length, phase === "mounted" ? 1 : 0);
      assertEquals(terminated, 1);
    } finally { mounted?.stop(); await window.happyDOM.close(); }
  });
}

Deno.test("byId のリスナーは登録時の要素だけに付き、停止で外れる", async () => {
  const built = await buildApp(read, { libraries });
  const window = new Window(); const element = window.document.createElement("div") as unknown as HTMLElement;
  const mounted = await mountApp(element, built, { createWorker });
  try {
    const original = element.querySelector<HTMLButtonElement>("button")!;
    let removed = 0;
    const remove = original.removeEventListener.bind(original);
    original.removeEventListener = (...args: Parameters<HTMLElement["removeEventListener"]>) => { removed++; remove(...args); };
    const replacement = window.document.createElement("button"); replacement.id = "button";
    original.replaceWith(replacement as never);
    replacement.click(); await new Promise(resolve => setTimeout(resolve, 10));
    assertEquals(element.querySelector("p")!.textContent, "0");
    original.click(); await waitFor(() => element.querySelector("p")!.textContent === "1");
    mounted.stop(); assertEquals(removed, 1);
    original.click(); await new Promise(resolve => setTimeout(resolve, 10));
    assertEquals(element.querySelector("p")!.textContent, "1");
  } finally { mounted.stop(); await window.happyDOM.close(); }
});
