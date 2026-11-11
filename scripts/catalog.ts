// Builds Binette's default provider list (the catalog) for one branch: an HTML page and apps.json.
// The app code is not copied. Each app's source is the raw.githubusercontent.com folder pinned to the
// commit, because raw caches branch URLs for minutes and the integrity would not match right after a push.
// See docs/spec/app-manager.md (Binette の既定の提供リスト).
import { resolve } from "@std/path";
import { computeAppMetadata, readRepliqueLibraries } from "../packages/regie/src/cli.ts";

export const REPOSITORY = "nozomi-hiragi/binette";
/** Where GitHub Pages serves the catalog of a branch. Outside the OS service worker scope (/binette/<branch>/). */
export function catalogUrl(branch: string): string {
  return `https://nozomi-hiragi.github.io/binette/apps/${branch}/`;
}

export interface CatalogEntry {
  id: string;
  source: string;
  version: string;
  name?: string;
  icon?: string;
  description?: string;
  integrity: Record<string, string>;
  requires?: Record<string, string>;
}

const escape = (text: string) => text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

/** Reads every folder in `catalog/` with an app.json and describes it for the list. */
export async function catalogEntries(root: string, commit: string): Promise<CatalogEntry[]> {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`commit は 40 桁のハッシュで指定してください: ${commit}`);
  const libraries = await readRepliqueLibraries(resolve(root, "packages/replique"));
  const folders: string[] = [];
  for await (const entry of Deno.readDir(resolve(root, "catalog"))) if (entry.isDirectory) folders.push(entry.name);
  folders.sort();
  const entries: CatalogEntry[] = [];
  for (const folder of folders) {
    const dir = resolve(root, "catalog", folder);
    let text: string;
    try { text = await Deno.readTextFile(resolve(dir, "app.json")); }
    catch (error) { if (error instanceof Deno.errors.NotFound) continue; throw error; }
    const manifest = JSON.parse(text) as { id: string; name?: string; version?: string; icon?: string; description?: string };
    const source = `https://raw.githubusercontent.com/${REPOSITORY}/${commit}/catalog/${folder}/`;
    entries.push({
      id: manifest.id,
      source,
      version: `${manifest.version ?? "0.0.0"}+${commit.slice(0, 7)}`,
      ...(manifest.name ? { name: manifest.name } : {}),
      ...(manifest.icon ? { icon: new URL(manifest.icon, source).href } : {}),
      ...(manifest.description ? { description: manifest.description } : {}),
      ...await computeAppMetadata(dir, { libraries }),
    });
  }
  return entries;
}

/** The page links apps.json and also embeds it, so a reader that ignores the link still finds the list. */
export function catalogHtml(name: string, branch: string, entries: CatalogEntry[]): string {
  const list = JSON.stringify({ name, apps: entries });
  const rows = entries.map(entry => `<li><strong>${escape(entry.name ?? entry.id)}</strong> <code>${escape(entry.version)}</code>` +
    (entry.description ? `<br>${escape(entry.description)}` : "") + "</li>").join("\n");
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(name)}</title>
<link rel="binette-apps" href="apps.json">
<style>
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { max-width: 40rem; margin: 0 auto; padding: 2rem 1rem; line-height: 1.6; }
li { margin: .75rem 0; }
code { overflow-wrap: anywhere; }
</style>
</head>
<body>
<h1>${escape(name)}</h1>
<p>Binette の提供リストです。Binette の「アプリ」の「リスト」に、このページの URL（<code>${escape(catalogUrl(branch))}</code>）を追加すると入れられます。</p>
<ul>
${rows}
</ul>
<script type="application/json" id="binette-apps">${list.replace(/</g, "\\u003c")}</script>
</body>
</html>
`;
}

export async function writeCatalog(root: string, output: string, branch: string, commit: string): Promise<void> {
  const entries = await catalogEntries(root, commit);
  const name = `Binette ${branch}`;
  await Deno.remove(output, { recursive: true }).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  });
  await Deno.mkdir(output, { recursive: true });
  await Deno.writeTextFile(resolve(output, "apps.json"), JSON.stringify({ name, apps: entries }, null, 2) + "\n");
  await Deno.writeTextFile(resolve(output, "index.html"), catalogHtml(name, branch, entries));
}

async function git(args: string[]): Promise<string> {
  const result = await new Deno.Command("git", { args, stdout: "piped", stderr: "piped" }).output();
  if (!result.success) throw new Error(`git ${args.join(" ")} に失敗しました。${new TextDecoder().decode(result.stderr)}`);
  return new TextDecoder().decode(result.stdout).trim();
}

/**
 * The branch the pages are for: BINETTE_PAGES_BRANCH, else the last folder of BINETTE_PAGES_OUT
 * (an older workflow on another branch passes only that), else the checked-out branch.
 */
export async function currentBranch(): Promise<string> {
  const out = Deno.env.get("BINETTE_PAGES_OUT")?.replace(/\/+$/, "");
  const branch = Deno.env.get("BINETTE_PAGES_BRANCH") || (out ? out.slice(out.lastIndexOf("/") + 1) : "") ||
    await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!/^[A-Za-z0-9._-]+$/.test(branch) || branch === "HEAD") throw new Error(`ブランチの名前を決められません: ${branch}`);
  return branch;
}

export function currentCommit(): Promise<string> {
  return git(["rev-parse", "HEAD"]);
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname!, "..");
  const output = Deno.env.get("BINETTE_PAGES_APPS_OUT") || "pages/apps";
  try {
    await writeCatalog(root, output, await currentBranch(), await currentCommit());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exitCode = 1;
  }
}
