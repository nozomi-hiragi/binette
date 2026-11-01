import { assert, assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { serveApp, type RegieWorker } from "@binette/regie";
import { buildApp } from "@binette/regie/build";
import { Window } from "happy-dom";
import { mountStartedApp } from "./mount-helper.ts";

const libraries = { "jsr:@binette/replique": await Deno.readTextFile(new URL("../../replique/src/index.ts", import.meta.url)) };

function createWorker(): RegieWorker {
  const { port1, port2 } = new MessageChannel();
  port1.start(); port2.start(); serveApp(port1 as never);
  return {
    postMessage: (message, transfer) => port2.postMessage(message, transfer as never),
    addEventListener: (type, listener) => port2.addEventListener(type, listener as never),
    terminate: () => { port1.close(); port2.close(); },
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = performance.now() + 10000;
  while (!condition() && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert(condition(), "待っても表示が変わりませんでした");
}

Deno.test("HTML なしの宣言アプリでカウンターを押し、key の順序を変えても要素を使い続ける", async () => {
  const files: Record<string, string> = {
    "app.json": JSON.stringify({ id: "ui-counter", name: "カウンター", entry: { as: "main.ts" } }),
    "main.ts": `import { App, launch } from "jsr:@binette/replique";
import { View, column, row, text, button } from "jsr:@binette/replique/ui";
let count = 0;
let reversed = false;
function increment(): void { count++; }
function swap(): void { reversed = !reversed; }
function add(i: i32): void { count += i; }
class Counter extends App {
  build(): View {
    const a = button("A", add).arg(reversed ? 30 : 3).key("a");
    const b = button("B", add).arg(7).key("b");
    return column([text("押した回数: " + count.toString()), row([button("+1", increment), button("順序", swap)]), row(reversed ? [b, a] : [a, b])]).gap(8).padding(16);
  }
}
launch(new Counter());`,
  };
  const reads: string[] = [];
  const built = await buildApp(path => { reads.push(path); return Promise.resolve(files[path]!); }, { libraries });
  assertEquals(built.html, "");
  assertEquals(reads.sort(), ["app.json", "main.ts"]);
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.append(host as never);
  const errors: unknown[] = [];
  const mounted = await mountStartedApp(host, built, { createWorker, declarative: true, onError: error => errors.push(error) });
  try {
    const count = host.querySelector<HTMLElement>(".bina-ui-text")!;
    const [increment, swap, a, b] = [...host.querySelectorAll<HTMLButtonElement>("button")];
    assertEquals(count.textContent, "押した回数: 0");
    increment!.click();
    increment!.click();
    increment!.click();
    await waitFor(() => count.textContent === "押した回数: 3");
    assertStrictEquals(host.querySelector(".bina-ui-text"), count);
    assertStrictEquals(host.querySelectorAll("button")[0], increment);
    swap!.click();
    a!.click();
    await waitFor(() => host.querySelectorAll("button")[2] === b);
    assertStrictEquals(host.querySelectorAll("button")[3], a);
    await waitFor(() => count.textContent === "押した回数: 33");
    assertEquals(errors, []);
  } finally { mounted.stop(); await window.happyDOM.close(); }
});

Deno.test("入力の連続イベントは Worker 越しに届き、show と grid を更新する", async () => {
  const files: Record<string, string> = {
    "app.json": JSON.stringify({ id: "ui-input", name: "入力", entry: { as: "main.ts" } }),
    "main.ts": `import { App, launch } from "jsr:@binette/replique";
import { View, column, grid, text, input, show } from "jsr:@binette/replique/ui";
let value = "";
function change(next: string): void { value = next; }
class InputApp extends App {
  build(): View { return column([input(value, change).key("input"), grid([text(value).key("result"), show(value.length > 0, text("表示").key("conditional"))]).minWidth(120)]); }
}
launch(new InputApp());`,
  };
  const built = await buildApp(path => Promise.resolve(files[path]!), { libraries });
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  const errors: unknown[] = [];
  const mounted = await mountStartedApp(host, built, { createWorker, declarative: true, onError: error => errors.push(error) });
  try {
    const input = host.querySelector("input")!;
    const result = host.querySelector('[data-bina-key="result"]')!;
    assertEquals((host.querySelector('[data-bina-key="conditional"]') as HTMLElement).hidden, true);
    for (const value of ["a", "ab", "abc"]) {
      input.value = value;
      input.dispatchEvent(new window.Event("input") as unknown as Event);
    }
    await waitFor(() => result.textContent === "abc");
    assertEquals(input.value, "abc");
    assertStrictEquals(host.querySelector("input"), input);
    assertEquals((host.querySelector('[data-bina-key="conditional"]') as HTMLElement).hidden, false);
    assertEquals(host.querySelector<HTMLElement>(".bina-ui-grid")!.style.getPropertyValue("--bina-ui-minWidth"), "120px");
    assertEquals(errors, []);
  } finally { mounted.stop(); await window.happyDOM.close(); }
});

Deno.test("appIcon はホームのアイコンを画像として表示し、権限のないアプリは終了する", async () => {
  const files: Record<string, string> = {
    "app.json": JSON.stringify({ id: "ui-icon", name: "アイコン", entry: { as: "main.ts" } }),
    "main.ts": `import { App, launch } from "jsr:@binette/replique";
import { View, appIcon } from "jsr:@binette/replique/ui";
class IconApp extends App { build(): View { return appIcon(0); } }
launch(new IconApp());`,
  };
  const built = await buildApp(path => Promise.resolve(files[path]!), { libraries });
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  const icon = '<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>';
  try {
    const home = await mountStartedApp(host, built, { createWorker, declarative: true, apps: [{ id: "target", name: "対象", icon }] });
    try {
      assertEquals(host.querySelector("img")!.getAttribute("src"), `data:image/svg+xml;charset=utf-8,${encodeURIComponent(icon)}`);
      assertEquals(host.querySelector("img")!.getAttribute("alt"), "");
      assertEquals(host.querySelector("script"), null);
    } finally { home.stop(); }
    const errors: unknown[] = [];
    await assertRejects(() => mountStartedApp(host, built, { createWorker, declarative: true, onError: error => errors.push(error) }), Error, "apps が届いた");
    assertEquals(host.querySelector("img"), null);
  } finally { await window.happyDOM.close(); }
});
