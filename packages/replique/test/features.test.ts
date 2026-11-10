import { assertEquals } from "@std/assert";
import { readRepliqueLibraries } from "../../regie/src/cli.ts";
import { buildApp } from "../../regie/src/build.ts";

Deno.test("Feature imports retain class identity with the aggregate SDK and Api.get", async () => {
  const classes: Record<string, string> = {
    apps: "AppsApi", os: "OsApi", storage: "StorageApi", shares: "SharesApi", pigeon: "PigeonApi",
    fs: "FsApi", cadre: "CadreApi", manager: "AppManagerApi", scheduler: "SchedulerApi", schedule: "ScheduleApi",
  };
  const code = [
    'import { Api, App, launch } from "jsr:@binette/replique/app";',
    'import { Element, Event, document } from "jsr:@binette/replique/dom";',
    'import { View, text } from "jsr:@binette/replique/ui";',
    'import { App as AggregateApp, Element as AggregateElement, Event as AggregateEvent, View as AggregateView } from "jsr:@binette/replique";',
    ...Object.entries(classes).flatMap(([feature, name]) => [
      `import { ${name} } from "jsr:@binette/replique/${feature}";`,
      `import { ${name} as Aggregate${name} } from "jsr:@binette/replique";`,
    ]),
    'class Page extends App { build(): View { return text("features"); } }',
    'launch(new Page());',
    'export function verify(): bool {',
    'const api = new Api();',
    ...Object.entries(classes).map(([key, name]) => `if (idof<${name}>() != idof<Aggregate${name}>() || api.get<${name}>("${key}") === null) return false;`),
    'return idof<App>() == idof<AggregateApp>() && idof<Element>() == idof<AggregateElement>() && idof<Event>() == idof<AggregateEvent>() && idof<View>() == idof<AggregateView>() && api.get<OsApi>("apps") === null && api.get<AppsApi>("unknown") === null;',
    '}',
  ].join("\n");
  const files: Record<string, string> = {
    "app.json": JSON.stringify({ id: "features", name: "Features", entry: { as: "main.ts" } }),
    "main.ts": code,
  };
  const libraries = await readRepliqueLibraries(new URL("../src/", import.meta.url));
  const built = await buildApp(path => Promise.resolve(files[path]!), { libraries });
  const module = new WebAssembly.Module(new Uint8Array(built.wasm));
  const binette: Record<string, () => number> = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    if (entry.module === "binette") binette[entry.name] = () => 0;
  }
  const instance = new WebAssembly.Instance(module, { binette, env: { abort() { throw new Error("Unexpected AS abort"); } } });
  (instance.exports._start as CallableFunction)();
  assertEquals((instance.exports.verify as CallableFunction)(), 1);
  assertEquals(WebAssembly.Module.exports(module).filter(entry => entry.name.startsWith("__bina_")).map(entry => entry.name).sort(), [
    "__bina_cadre_sync", "__bina_event", "__bina_lifecycle", "__bina_pigeon", "__bina_schedule", "__bina_share", "__bina_ui_event", "__bina_ui_text", "__bina_ui_value",
  ]);
});
