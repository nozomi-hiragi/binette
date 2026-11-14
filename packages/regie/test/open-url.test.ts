import { assert, assertEquals } from "@std/assert";
import { State } from "@binette/core";
import { buildApp } from "../src/build.ts";
import { readRepliqueLibraries } from "../src/cli.ts";
import { appId, createMemoryAppStore, startSystem, type Process, type SystemUi } from "../src/index.ts";

Deno.test("App.openUrl crosses the real Worker and ignores invalid URLs and background or stopped apps", async () => {
  const libraries = await readRepliqueLibraries(new URL("../../replique/", import.meta.url));
  const code = `import { App, launch } from "jsr:@binette/replique";
class Demo extends App {
  onPause(): void { this.openUrl("https://example.com/pause"); }
  onStop(): void { this.openUrl("https://example.com/stop"); }
}
const app = new Demo(); launch(app);
export function external(index: i32): void {
  const urls = ["http://example.com", "javascript:alert(1)", "file:///tmp/a", "data:text/plain,a", "/relative", "https://[", "", "https://EXAMPLE.com/page"];
  app.openUrl(urls[index]);
}`;
  const apps = await Promise.all(["home", "other"].map(async id => {
    const files: Record<string, string> = {
      "app.json": JSON.stringify({ id, name: id, ...(id === "home" ? { roles: ["home"] } : {}), entry: { as: "main.ts" } }),
      "main.ts": code,
    };
    return { source: "binette:system", prebuilt: await buildApp(path => Promise.resolve(files[path]!), { libraries }) };
  }));
  const processes = new Map<string, { id: number; process: Process }>();
  const requests: Parameters<NonNullable<SystemUi["openUrl"]>>[0][] = [];
  const errors: unknown[] = [];
  const system = await startSystem({ apps, store: createMemoryAppStore(), stopDelay: 10, ui: {
    present(instance, process) { processes.set(instance.app.manifest.id, { id: instance.id, process }); return { remove() {} }; },
    update() {}, report(error) { errors.push(error); }, openUrl(request) { requests.push(request); },
  } });
  async function waitFor(condition: () => boolean) {
    const deadline = performance.now() + 10000;
    while (!condition() && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert(condition());
  }
  try {
    await system.openHome();
    const home = processes.get("home")!.process;
    await waitFor(() => home.state === State.Resume);
    for (let i = 0; i < 7; i++) await home.app.call("external", i);
    assertEquals(requests, []);
    await home.app.call("external", 7);
    assertEquals(requests.length, 1); assertEquals([requests[0]!.name, requests[0]!.url, requests[0]!.isActive()], ["home", "https://example.com/page", true]);
    system.setPage({ visible: false, frozen: false });
    await waitFor(() => home.state === State.Stop);
    await home.app.call("external", 7);
    assertEquals(requests.length, 1); assertEquals(requests[0]!.isActive(), false);
    system.setPage({ visible: true, frozen: false }); await waitFor(() => home.state === State.Resume);
    await home.app.call("external", 7); assertEquals(requests.length, 2);
    await system.open(appId("binette:system", "other"));
    assertEquals(requests[1]!.isActive(), false);
    await home.app.call("external", 7); assertEquals(requests.length, 2);
    const other = processes.get("other")!;
    await other.process.app.call("external", 7); assertEquals(requests.length, 3);
    await system.close(other.id); assertEquals(requests[2]!.isActive(), false);
    assertEquals(errors, []);
  } finally { system.stop(); }
});
