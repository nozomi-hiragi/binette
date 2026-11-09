// Builds what GitHub Pages serves for this branch: the OS at the top and the API reference at api/.
// The docs are read in the bundled docs app; `deno task docs` still builds the Lume site locally.
import { copy } from "@std/fs";
import { api, run } from "./docs.ts";

const output = Deno.env.get("BINETTE_PAGES_OUT") || "pages";
await run(["task", "build"]);
await Deno.remove(output, { recursive: true }).catch((error) => {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
});
await copy("dist", output);
await api(`${output}/api`);
