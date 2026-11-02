import { assert, assertEquals } from "@std/assert";
import { buildApp } from "@binette/regie/build";
import { createMemoryAppStore, serveApp, type RegieWorker } from "@binette/regie";
import { Window } from "happy-dom";
import { mountShell } from "../src/index.ts";

const root = new URL("../../..", import.meta.url);
const libraries = { "jsr:@binette/replique": await Deno.readTextFile(new URL("packages/replique/src/index.ts", root)) };
const apps = await Promise.all(["cadre", "home", "settings"].map(async name => {
  const read = (path: string) => Deno.readTextFile(new URL(`apps/${name}/${path}`, root));
  const built = await buildApp(read, { libraries });
  return { source: "binette:system", prebuilt: { ...built, icon: built.manifest.icon ? await read(built.manifest.icon) : undefined } };
}));
const plain = await buildApp(path => Promise.resolve(path === "app.json"
  ? JSON.stringify({ id: "plain", name: "アイコンなし", version: "0.1.0", binette: "0.2", entry: { as: "main.ts" } })
  : 'import { App, launch } from "jsr:@binette/replique"; import { text, View } from "jsr:@binette/replique/ui"; class Plain extends App { override build(): View { return text("本文"); } } launch(new Plain());'), { libraries });
apps.push({ source: "binette:system", prebuilt: { ...plain, icon: undefined } });

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = performance.now() + 10000;
  while (!condition() && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert(condition(), "Cadre の操作が反映されませんでした");
}
async function fixture(installed = true) {
  const window = new Window();
  const element = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.append(element as never);
  let live = 0;
  let ready = 0;
  const errors: unknown[] = [];
  const cadre = await mountShell(element, { apps, installed, store: createMemoryAppStore(), onError: error => errors.push(error),
    createWorker(): RegieWorker {
      live++;
      const { port1, port2 } = new MessageChannel();
      port1.start(); port2.start(); serveApp(port1 as never);
      let stopped = false;
      let resumed = false;
      const resumes = new Set<number>();
      return { postMessage: (message, transfer) => {
        const call = message as { type: string; name?: string; args?: unknown[]; id: number };
        if (call.type === "call" && call.name === "__bina_lifecycle" && call.args?.[0] === 3) resumes.add(call.id);
        port2.postMessage(message, transfer as never);
      },
        addEventListener: (type, listener) => port2.addEventListener(type, ((event: MessageEvent) => {
          if (type === "message" && event.data.type === "done" && resumes.delete(event.data.id) && !resumed) { resumed = true; ready++; }
          (listener as (event: MessageEvent) => void)(event);
        }) as never),
        terminate() { if (stopped) return; stopped = true; live--; if (resumed) ready--; port1.close(); port2.close(); } };
    },
  });
  const button = (key: string) => element.querySelector<HTMLButtonElement>(`[data-bina-key=${key}]`);
  await waitFor(() => button("home") !== null && button("home-tile-0") !== null);
  const waitReady = async () => {
    await waitFor(() => live === ready);
    await new Promise(resolve => setTimeout(resolve, 0));
  };
  await waitReady();
  return { window, element, cadre, button, errors, waitReady, get live() { return live; },
    async close() { cadre.stop(); await window.happyDOM.close(); } };
}

Deno.test("Cadre のバーはホームと起動中だけを並べ、前面の印と切り替えを更新する", async () => {
  const f = await fixture();
  try {
    assertEquals(f.button("home")!.getAttribute("aria-pressed"), "true");
    assertEquals(f.element.querySelector<HTMLElement>("[data-bina-key=dock]")!.hidden, true);
    f.button("home-tile-0")!.click();
    await waitFor(() => f.button("dock-0") !== null && f.element.querySelector("[data-bina-key=debug]") !== null);
    assertEquals(f.element.querySelectorAll("[data-bina-key=dock] > .bina-ui-button").length, 1);
    assertEquals(f.button("dock-0")!.getAttribute("aria-pressed"), "true");
    assertEquals(f.button("home")!.getAttribute("aria-pressed"), "false");
    await f.waitReady();
    f.button("home")!.click();
    await waitFor(() => f.button("home")!.getAttribute("aria-pressed") === "true");
    assertEquals(f.errors, []);
    assertEquals(f.button("dock-0")!.getAttribute("aria-pressed"), "false");
    await f.waitReady();
    f.button("dock-0")!.click();
    await waitFor(() => f.button("dock-0")!.getAttribute("aria-pressed") === "true");
    assertEquals(f.errors, []);
  } finally { await f.close(); }
});

Deno.test("ドックは対応するアプリのアイコンと読み上げ名を持ち、画像なしは名前を表示する", async () => {
  const f = await fixture();
  try {
    f.button("home-tile-0")!.click();
    await waitFor(() => f.button("dock-0") !== null && f.element.querySelector("[data-bina-key=debug]") !== null);
    const dock = f.button("dock-0")!;
    assertEquals(dock.getAttribute("aria-label"), "設定を開く");
    const image = dock.querySelector("img")!;
    assertEquals(image.getAttribute("src"), `data:image/svg+xml;charset=utf-8,${encodeURIComponent(apps[2]!.prebuilt.icon!)}`);
    assertEquals(image.getAttribute("alt"), "");
    await f.waitReady();
    f.button("home")!.click();
    await waitFor(() => f.button("home")!.getAttribute("aria-pressed") === "true");
    f.button("home-tile-1")!.click();
    await waitFor(() => f.button("dock-1") !== null && [...f.element.querySelectorAll(".bina-shell-app")].some(host => host.querySelector(".bina-ui-text")?.textContent === "本文"));
    assertEquals(f.button("dock-1")!.getAttribute("aria-label"), "アイコンなしを開く");
    assertEquals(f.button("dock-1")!.textContent, "ア");
    assertEquals(f.button("dock-1")!.querySelector("img"), null);
  } finally { await f.close(); }
});

Deno.test("ドックのメニューから閉じると、閉じたアプリをドックから除く", async () => {
  const f = await fixture();
  try {
    f.button("home-tile-0")!.click();
    await waitFor(() => f.button("dock-0") !== null && f.element.querySelector("[data-bina-key=debug]") !== null);
    await f.waitReady();
    f.button("dock-0")!.dispatchEvent(new f.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }) as unknown as Event);
    const close = [...f.element.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === "閉じる");
    assert(close);
    close.click();
    await waitFor(() => f.button("dock-0") === null && f.button("home")!.getAttribute("aria-pressed") === "true");
    assertEquals(f.element.querySelector<HTMLElement>("[data-bina-key=dock]")!.hidden, true);
    assertEquals(f.errors, []);
  } finally { await f.close(); }
});

Deno.test("ドックのメニューは選んだアプリだけを閉じ、残ったアプリを開ける", async () => {
  const f = await fixture();
  try {
    f.button("home-tile-0")!.click();
    await waitFor(() => f.button("dock-0") !== null && f.element.querySelector("[data-bina-key=debug]") !== null);
    await f.waitReady();
    f.button("home")!.click();
    await waitFor(() => f.button("home")!.getAttribute("aria-pressed") === "true");
    f.button("home-tile-1")!.click();
    await waitFor(() => f.button("dock-1") !== null && f.button("dock-1")!.getAttribute("aria-pressed") === "true");
    await f.waitReady();
    // 前面でない設定のメニューから閉じても、前面のアプリは閉じない
    f.button("dock-0")!.dispatchEvent(new f.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }) as unknown as Event);
    const close = [...f.element.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === "閉じる");
    assert(close);
    close.click();
    await waitFor(() => f.button("dock-0") === null);
    assertEquals(f.button("dock-1")!.getAttribute("aria-pressed"), "true");
    await f.waitReady();
    f.button("home")!.click();
    await waitFor(() => f.button("home")!.getAttribute("aria-pressed") === "true");
    f.button("dock-1")!.click();
    await waitFor(() => f.button("dock-1")!.getAttribute("aria-pressed") === "true");
    assertEquals(f.errors, []);
  } finally { await f.close(); }
});

Deno.test("インストールはライブモードだけに表示し、押すと手順を開く", async () => {
  for (const installed of [false, true]) {
    const f = await fixture(installed);
    try {
      assertEquals(f.button("install")!.hidden, installed);
      if (!installed) {
        f.button("install")!.click();
        await waitFor(() => f.element.querySelector<HTMLDialogElement>("dialog")!.open);
      }
    } finally { await f.close(); }
  }
});

Deno.test("stop は Cadre とアプリの Worker および表示を片付け、古いボタンは起動しない", async () => {
  const f = await fixture();
  try {
    const oldButton = f.button("home")!;
    f.cadre.stop();
    oldButton.click();
    await new Promise(resolve => setTimeout(resolve, 20));
    assertEquals(f.live, 0);
    assertEquals(f.element.childNodes.length, 0);
    assertEquals(f.errors, []);
  } finally { await f.close(); }
});
