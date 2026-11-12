// Builds what GitHub Pages serves for this branch: the OS, the API reference and the default provider list.
// The API reference and the provider list must stay outside the OS folder, because the OS service worker
// answers every navigation inside its scope with the OS page.
// The docs are read in the docs app from the provider list; `deno task docs` still builds the Lume site locally.
import { copy } from "@std/fs";
import { resolve } from "@std/path";
import { api, run } from "./docs.ts";
import { catalogUrl, currentBranch, currentCommit, writeCatalog } from "./catalog.ts";

const output = Deno.env.get("BINETTE_PAGES_OUT") || "pages/os";
const apiOutput = Deno.env.get("BINETTE_PAGES_API_OUT") || "pages/api";
const appsOutput = Deno.env.get("BINETTE_PAGES_APPS_OUT") || "pages/apps";
const branch = await currentBranch();
// The OS of this branch starts with the provider list of the same branch.
Deno.env.set("BINETTE_LISTS", `${catalogUrl(branch)},https://nozomi-hiragi.github.io/binette-apps/`);
await run(["task", "build"]);
await Deno.remove(output, { recursive: true }).catch((error) => {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
});
await copy("dist", output);
await api(apiOutput);
await writeCatalog(resolve(import.meta.dirname!, ".."), appsOutput, branch, await currentCommit());
