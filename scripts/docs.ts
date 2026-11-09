// Builds the Lume site of docs/ and the API reference at api/ for local reading.
// GitHub Pages serves the OS instead (scripts/pages.ts); the docs are read in the bundled docs app.

/** Entry points of the API reference. */
export const API_ENTRIES = [
  "packages/core/src/index.ts",
  "packages/decor/src/index.ts",
  "packages/regie/src/index.ts",
  "packages/regie/src/build.ts",
  "packages/regie/src/cli.ts",
  "packages/scene/src/index.ts",
  "packages/coulisses/src/index.ts",
];

export async function run(args: string[]): Promise<void> {
  const result = await new Deno.Command(Deno.execPath(), {
    args,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  if (!result.success) Deno.exit(result.code);
}

/** Writes the API reference into `output`. */
export function api(output: string): Promise<void> {
  return run(["doc", "--html", "--name=Binette", `--output=${output}`, ...API_ENTRIES]);
}

if (import.meta.main) {
  const output = Deno.env.get("BINETTE_DOCS_OUT") || "site";
  await run(["run", "-A", "lume/cli.ts"]);
  await api(`${output}/api`);
}
