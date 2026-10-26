import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { serveApp, type RegieWorker } from "@binette/regie";
import { Window } from "happy-dom";
import { buildApp, mountApp } from "../src/index.ts";

const root = new URL("../../..", import.meta.url);
const counter = new URL("examples/counter/", root);
const replique = await readFile(new URL("packages/replique/src/index.ts", root), "utf8");
const libraries = { "jsr:@binette/replique": replique };
const read = (path: string) => readFile(fileURLToPath(new URL(path, counter)), "utf8");

/** 同じスレッドの MessageChannel に serveApp をつないだ Worker */
function createWorker(): RegieWorker {
  const { port1, port2 } = new MessageChannel();
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
  assert.ok(condition(), "待っても表示が変わりませんでした");
}

test("カウンターをビルドして動かせる", async () => {
  const built = await buildApp(read, { libraries });
  assert.equal(built.manifest.id, "io.github.nozomi-hiragi.counter");
  assert.match(built.html, /data-on-click="increment"/);

  const window = new Window();
  try {
    const element = window.document.createElement("div") as unknown as HTMLElement;
    window.document.body.append(element as never);
    const errors: unknown[] = [];
    const mounted = await mountApp(element, built, { createWorker, onError: (error) => errors.push(error) });
    try {
      const text = element.querySelector("[data-text=count]")!;
      const button = element.querySelector("button")!;
      assert.equal(text.textContent, "0");
      button.click();
      await waitFor(() => text.textContent === "1");
      button.click();
      await waitFor(() => text.textContent === "2");
      assert.deepEqual(errors, []);
    } finally {
      mounted.stop();
    }
  } finally {
    await window.happyDOM.close();
  }
});

test("ビルドに失敗する AS は Error になる", async () => {
  const files: Record<string, string> = {
    "app.json": JSON.stringify({ id: "x", name: "x", entry: { html: "i.html", as: "m.ts" } }),
    "i.html": "<p></p>",
    "m.ts": 'export function start(): void { const n: i32 = "文字"; }',
  };
  await assert.rejects(
    buildApp(async (path) => files[path]!, { libraries }),
    (error: unknown) => error instanceof Error && error.message.startsWith("アプリをビルドできません。") && error.message.includes("TS2322"),
  );
});
