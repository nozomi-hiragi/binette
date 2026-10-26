// CHANGELOG の日付付きの見出しを確かめ、GitHub Release に載せる本文を取り出す。

export function releaseNotes(changelog: string, version: string): string {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }
  const lines = changelog.split(/\r?\n/);
  const heading = new RegExp(`^## v${version.replaceAll(".", "\\.")} \\((\\d{4}-\\d{2}-\\d{2})\\)$`);
  const matches = lines.flatMap((line, index) => {
    const match = heading.exec(line);
    return match ? [{ index, date: match[1]! }] : [];
  });
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one CHANGELOG heading: ## v${version} (YYYY-MM-DD)`);
  }
  const { index, date } = matches[0]!;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid CHANGELOG release date: ${date}`);
  }
  const next = lines.findIndex((line, i) => i > index && line.startsWith("## "));
  return lines.slice(index + 1, next === -1 ? undefined : next).join("\n") + (next === -1 ? "" : "\n");
}

if (import.meta.main) {
  const [version, outFile] = Deno.args;
  if (!version || !outFile || Deno.args.length !== 2) {
    console.error("Usage: deno run --allow-read --allow-write scripts/changelog.ts <version> <out-file>");
    Deno.exit(1);
  } else {
    try {
      const changelog = Deno.readTextFileSync(new URL("../CHANGELOG.md", import.meta.url));
      Deno.writeTextFileSync(outFile, releaseNotes(changelog, version));
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      Deno.exit(1);
    }
  }
}
