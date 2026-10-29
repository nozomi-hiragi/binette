// Use the same destination for Lume and deno doc, including on GitHub Pages.
const output = Deno.env.get("BINETTE_DOCS_OUT") || "site";
async function run(args: string[]) {
  const result = await new Deno.Command(Deno.execPath(), {
    args,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  if (!result.success) Deno.exit(result.code);
}
await run(["run", "-A", "lume/cli.ts"]);
await run([
  "doc",
  "--html",
  "--name=Binette",
  `--output=${output}/api`,
  "packages/core/src/index.ts",
  "packages/regie/src/index.ts",
  "packages/regie/src/build.ts",
  "packages/regie/src/cli.ts",
  "packages/scene/src/index.ts",
  "packages/coulisses/src/index.ts",
]);
