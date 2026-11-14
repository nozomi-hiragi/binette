// Builds the OS and API reference for this branch on GitHub Pages.
// The API reference stays in docs/api (outside the OS folder) because the service worker serves the OS page for navigation.
// The docs app is distributed by binette-apps; `deno task docs` builds the Lume site locally.
import { copy } from "@std/fs";
import { api, run } from "./docs.ts";

async function git(args: string[]): Promise<string> {
  const result = await new Deno.Command("git", { args, stdout: "piped", stderr: "piped" }).output();
  if (!result.success) throw new Error(`git ${args.join(" ")} に失敗しました。${new TextDecoder().decode(result.stderr)}`);
  return new TextDecoder().decode(result.stdout).trim();
}

/**
 * The branch the pages are for: BINETTE_PAGES_BRANCH, else the last folder of BINETTE_PAGES_OUT
 * (an older workflow on another branch passes only that), else the checked-out branch.
 */
async function currentBranch(): Promise<string> {
  const out = Deno.env.get("BINETTE_PAGES_OUT")?.replace(/\/+$/, "");
  const branch = Deno.env.get("BINETTE_PAGES_BRANCH") || (out ? out.slice(out.lastIndexOf("/") + 1) : "") ||
    await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!/^[A-Za-z0-9._-]+$/.test(branch) || branch === "HEAD") throw new Error(`ブランチの名前を決められません: ${branch}`);
  return branch;
}

function currentCommit(): Promise<string> {
  return git(["rev-parse", "HEAD"]);
}

const output = Deno.env.get("BINETTE_PAGES_OUT") || "pages/os";
const apiOutput = Deno.env.get("BINETTE_PAGES_API_OUT") || "pages/docs/api";
const branch = await currentBranch();
const commit = await currentCommit();
Deno.env.set("BINETTE_BUILD_REF", branch);
Deno.env.set("BINETTE_BUILD_COMMIT", commit);
// Every Pages build starts with the fixed binette-apps provider list.
Deno.env.set("BINETTE_LISTS", "https://nozomi-hiragi.github.io/binette-apps/");
await run(["task", "build"]);
await Deno.remove(output, { recursive: true }).catch((error) => {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
});
await copy("dist", output);
await api(apiOutput);
