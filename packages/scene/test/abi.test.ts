import { BinetteError } from "@binette/core";
import { assert, assertEquals } from "@std/assert";
import { Window } from "happy-dom";
import { buildApp } from "@binette/regie/build";
import { createMemoryAppStore, type RegieWorker, serveApp, startSystem } from "@binette/regie";
import { readRepliqueLibraries } from "../../regie/src/cli.ts";
import { createShellUi } from "../src/index.ts";

for (const [imports, expected] of [
  [[["binette", "dom.text"]], "この OS では動きません（binette）"],
  [[["binette:storage@0.9", "read"]], "この OS では動きません（storage 0.9）"],
  [[["binette:storage@0.9", "read"], ["binette:ui@0.2", "render"]], "この OS では動きません（storage 0.9、ui 0.2）"],
  [[["binette:storage@0.1", "read2"]], "この OS では動きません（storage 0.1 の read2）"],
] as const) {
  Deno.test(`未対応 ABI の終了画面の文言が完全一致する: ${expected}`, async () => {
    const libraries = await readRepliqueLibraries(new URL("../../replique/src/", import.meta.url));
    const build = (id: string, source: string, home = false) => buildApp(path => Promise.resolve(path === "app.json"
      ? JSON.stringify({ id, name: id, entry: { as: "main.ts" }, ...(home ? { roles: ["home"] } : {}) }) : source), { libraries });
    const home = await build("home", 'import { App, launch } from "jsr:@binette/replique"; launch(new App());', true);
    const source = imports.map(([module, name], i) => `@external("${module}", "${name}") declare function host${i}(): void;`).join("\n")
      + `\nexport function run(): void { ${imports.map((_, i) => `host${i}();`).join(" ")} }`;
    const old = await build("old", source);
    const store = createMemoryAppStore();
    const key = "https://example.test/apps/#old";
    await store.put({ ...old, key, source: "https://example.test/apps/", installedAt: 1, icon: undefined });
    const window = new Window();
    const element = window.document.createElement("main") as unknown as HTMLElement;
    window.document.body.append(element as never);
    const errors: unknown[] = [];
    const ui = createShellUi(element, { onError: error => errors.push(error), installed: true });
    const system = await startSystem({ ui, store, apps: [{ source: "binette:system", prebuilt: home }], createWorker(): RegieWorker {
      const { port1, port2 } = new MessageChannel();
      port1.start(); port2.start(); serveApp(port1 as never);
      return {
        postMessage: (message, transfer) => port2.postMessage(message, transfer as never),
        addEventListener: (type, listener) => port2.addEventListener(type, listener as never),
        terminate: () => { port1.close(); port2.close(); },
      };
    } });
    ui.bind(system);
    try {
      await system.openHome();
      await system.open(key);
      assertEquals(errors.length, 1);
      assert(errors[0] instanceof BinetteError);
      assertEquals(errors[0].code, "unsupported_abi");
      const status = element.querySelector<HTMLElement>("[role=status]")!;
      assertEquals(status.hidden, false);
      assertEquals(status.textContent, expected);
      assertEquals(errors[0].message, expected);
      assert(await store.get(key));
    } finally { system.stop(); ui.stop(); await window.happyDOM.close(); }
  });
}
