// Builds what GitHub Pages serves for this branch: the OS and, beside it, the API reference.
// The API reference must stay outside the OS folder, because the OS service worker answers
// every navigation inside its scope with the OS page.
// The docs are read in the bundled docs app; `deno task docs` still builds the Lume site locally.
import { copy } from "@std/fs";
import { api, run } from "./docs.ts";

const output = Deno.env.get("BINETTE_PAGES_OUT") || "pages/os";
const apiOutput = Deno.env.get("BINETTE_PAGES_API_OUT") || "pages/api";
await run(["task", "build"]);
await Deno.remove(output, { recursive: true }).catch((error) => {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
});
await copy("dist", output);
await api(apiOutput);
