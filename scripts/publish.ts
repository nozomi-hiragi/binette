// OS 用のソースは変えず、JSR 公開用コピーだけを単一パッケージにする。
import { copy } from "@std/fs";
import { join, relative } from "@std/path";
import { FEATURES, PUBLISHED } from "./check-version.ts";

const ROOT = join(import.meta.dirname!, "..");

/**
 * 公開対象と同じ一時ワークスペースを作る。呼び出し元が削除する。
 * `ascShims` は asc で検査するときだけ使い、JSR に出すコピーには含めない。
 */
export async function preparePublishWorkspace(temp: string, { ascShims = false } = {}): Promise<void> {
  const rootConfig = JSON.parse(await Deno.readTextFile(join(ROOT, "deno.json")));
  rootConfig.workspace = Object.keys(PUBLISHED).map(dir => `./${dir}`);
  await Deno.writeTextFile(join(temp, "deno.json"), JSON.stringify(rootConfig, null, 2));
  await Deno.copyFile(join(ROOT, "deno.lock"), join(temp, "deno.lock"));
  for (const dir of Object.keys(PUBLISHED)) {
    const source = join(ROOT, dir);
    const target = join(temp, dir);
    await Deno.mkdir(target, { recursive: true });
    const config = JSON.parse(await Deno.readTextFile(join(source, "deno.json")));
    for (const item of config.publish.include as string[]) await copy(join(source, item), join(target, item));
    if (dir === "packages/replique") {
      for (const featureDir of Object.keys(FEATURES)) {
        const feature = featureDir.slice("packages/replique/".length);
        await Deno.mkdir(join(target, feature), { recursive: true });
        await Deno.copyFile(join(ROOT, featureDir, "deno.json"), join(target, feature, "deno.json"));
        await copy(join(ROOT, featureDir, "src"), join(target, feature, "src"));
        config.publish.include.push(`${feature}/deno.json`, `${feature}/src`);
      }
      const files = ["src/index.ts", ...Object.keys(FEATURES).map(dir => `${dir.slice("packages/replique/".length)}/src/index.ts`),
        ...Object.keys(FEATURES).map(dir => `src/${dir.slice("packages/replique/".length)}.ts`)];
      for (const file of files) {
        const path = join(target, file);
        const contents = await Deno.readTextFile(path);
        const rewritten = contents.replace(/jsr:@binette\/replique-([a-z]+)@\^0\.1/g, (_match: string, feature: string) => {
          if (!Object.hasOwn(FEATURES, `packages/replique/${feature}`)) throw new Error(`Unknown Réplique feature: ${feature}`);
          let destination = relative(join(path, ".."), join(target, feature, "src/index.ts"));
          if (!destination.startsWith(".")) destination = `./${destination}`;
          return destination;
        });
        if (rewritten.includes("jsr:@binette/replique-")) throw new Error(`Unrewritten Réplique dependency: ${file}`);
        await Deno.writeTextFile(path, rewritten);
        // asc は拡張子付き import にも .ts を付けるため、同じ内容を用意する。
        if (ascShims && /^[a-z]+\/src\/index\.ts$/.test(file)) await Deno.writeTextFile(`${path}.ts`, rewritten);
      }
    }
    await Deno.writeTextFile(join(target, "deno.json"), JSON.stringify(config, null, 2));
  }
}

if (import.meta.main) {
  const temp = await Deno.makeTempDir({ prefix: "binette-publish-" });
  try {
    await preparePublishWorkspace(temp);
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["publish", "--no-check", ...Deno.args], cwd: temp, stdin: "inherit", stdout: "inherit", stderr: "inherit",
    }).spawn().status;
    if (!result.success) Deno.exitCode = result.code;
  } finally {
    await Deno.remove(temp, { recursive: true });
  }
}
