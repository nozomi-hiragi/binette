import { assert, assertEquals, assertStrictEquals } from "@std/assert";
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
    const a = button("A", add).arg(3).key("a");
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
    await waitFor(() => count.textContent === "押した回数: 1");
    assertStrictEquals(host.querySelector(".bina-ui-text"), count);
    assertStrictEquals(host.querySelectorAll("button")[0], increment);
    swap!.click();
    await waitFor(() => host.querySelectorAll("button")[2] === b);
    assertStrictEquals(host.querySelectorAll("button")[3], a);
    a!.click();
    await waitFor(() => count.textContent === "押した回数: 4");
    assertEquals(errors, []);
  } finally { mounted.stop(); await window.happyDOM.close(); }
});
