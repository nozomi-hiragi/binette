// PR の変更に関係するテストファイルを選ぶ。CI はこの結果のテストだけを走らせる。
// 選び方:
// - 文書や Pages だけの変更（IGNORED）は、テストを走らせない
// - テストファイルの import の木（deno info）に入っているファイルの変更は、そのテストを走らせる
// - 実行時に読まれるファイル（RUNTIME_SOURCES）の変更は、それを読むテスト（RUNTIME_READERS）を全部走らせる
// - どれにも当たらない変更（設定、ロックファイル、どのテストからも import されないファイルなど）は、全テストを走らせる
import { join, relative } from "@std/path";

const ROOT = join(import.meta.dirname!, "..");

/** テストに関係しない変更。 */
export const IGNORED: RegExp[] = [
  /\.md$/,
  /^docs\//,
  /^landing\//,
  /^_config\.ts$/,
  /^\.github\/workflows\/docs\.yml$/,
  /^\.github\/dependabot\.yml$/,
  /^\.gitattributes$/,
  /^\.gitignore$/,
  // Pages だけで使うスクリプト
  /^scripts\/(pages|docs)\.ts$/,
  // テストではなく、CI の check-pack と公開の予行（毎回動く）や publish.yml で確かめるスクリプト
  /^scripts\/(publish|check-pack|changelog)\.ts$/,
];

/** import ではなく、ビルドやファイル読み込みでテストが実行時に使うもの。 */
export const RUNTIME_SOURCES: RegExp[] = [/^packages\/replique\//, /^apps\//, /^bundled\//, /^public\//];

/** RUNTIME_SOURCES を実行時に読むテストの場所。 */
export const RUNTIME_READERS: RegExp[] = [
  /^packages\/regie\//,
  /^packages\/scene\//,
  /^packages\/replique\//,
  /^bundled\//,
  /^scripts\//,
  /^src\//,
];

export type Selection = { kind: "all"; reason: string } | { kind: "some"; files: string[] };

/** 変更されたファイルと、テストファイルごとの import の木から、走らせるテストを選ぶ。 */
export function selectTests(changed: string[], graphs: Map<string, Set<string>>): Selection {
  const selected = new Set<string>();
  const tests = [...graphs.keys()];
  for (const file of changed) {
    if (IGNORED.some(pattern => pattern.test(file))) continue;
    let hit = false;
    for (const test of tests) {
      if (graphs.get(test)!.has(file)) { selected.add(test); hit = true; }
    }
    if (RUNTIME_SOURCES.some(pattern => pattern.test(file))) {
      for (const test of tests) if (RUNTIME_READERS.some(pattern => pattern.test(test))) selected.add(test);
      hit = true;
    }
    if (!hit) return { kind: "all", reason: file };
  }
  return { kind: "some", files: [...selected].sort() };
}

async function git(...args: string[]): Promise<string> {
  const output = await new Deno.Command("git", { args, cwd: ROOT, stderr: "inherit" }).output();
  if (!output.success) throw new Error(`git ${args.join(" ")} failed`);
  return new TextDecoder().decode(output.stdout);
}

async function localGraph(test: string): Promise<Set<string>> {
  const output = await new Deno.Command(Deno.execPath(), { args: ["info", "--json", test], cwd: ROOT, stderr: "inherit" }).output();
  if (!output.success) throw new Error(`deno info ${test} failed`);
  const info = JSON.parse(new TextDecoder().decode(output.stdout)) as { modules?: { specifier: string }[] };
  const files = new Set<string>([test]);
  for (const module of info.modules ?? []) {
    if (module.specifier.startsWith("file://")) files.add(relative(ROOT, new URL(module.specifier).pathname));
  }
  return files;
}

if (import.meta.main) {
  // 使い方: deno run -A scripts/affected-tests.ts <比べる元の ref>
  // 結果は GITHUB_OUTPUT（無ければ標準出力）に files=<空白区切り> または files=all で書く
  const base = Deno.args[0];
  if (!base) throw new Error("Usage: affected-tests.ts <base-ref>");
  const changed = (await git("diff", "--name-only", `${base}...HEAD`)).split("\n").filter(Boolean);
  const tests = (await git("ls-files", "*.test.ts")).split("\n").filter(Boolean);
  const graphs = new Map<string, Set<string>>();
  const queue = [...tests];
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let test = queue.shift(); test; test = queue.shift()) graphs.set(test, await localGraph(test));
  }));
  const selection = selectTests(changed, graphs);
  console.log(`Changed files (${changed.length}):\n${changed.map(file => `  ${file}`).join("\n")}`);
  const value = selection.kind === "all" ? "all" : selection.files.join(" ");
  if (selection.kind === "all") console.log(`Running all tests (not covered by the selection rules: ${selection.reason})`);
  else console.log(`Running ${selection.files.length} of ${tests.length} test files:\n${selection.files.map(file => `  ${file}`).join("\n")}`);
  const outputPath = Deno.env.get("GITHUB_OUTPUT");
  if (outputPath) await Deno.writeTextFile(outputPath, `files=${value}\n`, { append: true });
  else console.log(`files=${value}`);
}
