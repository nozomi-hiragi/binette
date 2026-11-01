import { assert, assertEquals } from "@std/assert";
import { buildApp } from "@binette/regie/build";
import { createMemoryAppStore, type RegieWorker, serveApp } from "@binette/regie";
import { Window } from "happy-dom";
import { mountShell } from "../src/index.ts";
import { chooseFromMenu } from "./homebar-helper.ts";

const root = new URL("../../..", import.meta.url);
const libraries = { "jsr:@binette/replique": await Deno.readTextFile(new URL("packages/replique/src/index.ts", root)) };
const apps = await Promise.all(["shell", "home", "settings"].map(async name => ({
  source: "binette:system",
  prebuilt: await buildApp(path => Deno.readTextFile(new URL(`apps/${name}/${path}`, root)), { libraries }),
})));
async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = performance.now() + 10000;
  while (!condition() && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert(condition(), "シェルの状態が変わりませんでした");
}

Deno.test("シェルを先に起動し、appArea のホームから設定を開き、ホーム・メニューから閉じても領域を保つ", async () => {
  const window = new Window();
  const element = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.append(element as never);
  let created = 0;
  let live = 0;
  let resumed = 0;
  const errors: unknown[] = [];
  const shell = await mountShell(element, { apps, store: createMemoryAppStore(), installed: true,
    onError: error => errors.push(error),
    createWorker(): RegieWorker {
      created++; live++;
      const { port1, port2 } = new MessageChannel();
      port1.start(); port2.start(); serveApp(port1 as never);
      let stopped = false;
      const resumes = new Set<number>();
      return {
        postMessage: (message, transfer) => {
          const call = message as { type: string; name?: string; args?: unknown[]; id: number };
          if (call.type === "call" && call.name === "__bina_lifecycle" && call.args?.[0] === 3) resumes.add(call.id);
          port2.postMessage(message, transfer as never);
        },
        addEventListener: (type, listener) => port2.addEventListener(type, ((event: MessageEvent) => {
          if (type === "message" && event.data.type === "done" && resumes.delete(event.data.id)) resumed++;
          (listener as (event: MessageEvent) => void)(event);
        }) as never),
        terminate() { if (stopped) return; stopped = true; live--; port1.close(); port2.close(); },
      };
    },
  });
  const button = (key: string) => element.querySelector<HTMLButtonElement>(`[data-bina-key=${key}]`);
  try {
    await waitFor(() => button("home") !== null && button("home-tile-0") !== null);
    const area = element.querySelector<HTMLElement>(".bina-ui-appArea")!;
    const home = element.querySelector<HTMLElement>("[data-bina-key=home-grid]")!.closest<HTMLElement>(".bina-shell-app")!;
    assertEquals(home.parentElement, area);
    assertEquals(created, 2);
    assertEquals(element.querySelector<HTMLElement>(".bina-shell-fallback")!.hidden, true);
    button("home-tile-0")!.click();
    await waitFor(() => button("dock-0")?.getAttribute("aria-pressed") === "true" && element.querySelector("[data-bina-key=debug]") !== null);
    assertEquals(created, 3);
    assertEquals(home.hidden, true);
    const settings = element.querySelector<HTMLElement>("[data-bina-key=debug]")!.closest<HTMLElement>(".bina-shell-app")!;
    assertEquals(settings.parentElement, area);
    await waitFor(() => resumed === 3);
    await new Promise(resolve => setTimeout(resolve, 0));
    button("home")!.click();
    await waitFor(() => !home.hidden && button("home")?.getAttribute("aria-pressed") === "true" && button("dock-0") !== null);
    assertEquals(element.querySelector(".bina-ui-appArea"), area);
    button("dock-0")!.click();
    await waitFor(() => !settings.hidden && button("dock-0")?.getAttribute("aria-pressed") === "true");
    chooseFromMenu(element, "設定", "閉じる");
    await waitFor(() => !settings.isConnected && !home.hidden && live === 2);
    assertEquals(element.querySelector(".bina-ui-appArea"), area);
    assertEquals(errors, []);
    shell.stop();
    assertEquals(live, 0);
    assertEquals(element.children.length, 0);
  } finally { shell.stop(); await window.happyDOM.close(); }
});
