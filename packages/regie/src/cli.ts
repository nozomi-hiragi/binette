import { buildApp } from "./build.ts";
import { stringifyPrebuiltApp } from "./prebuilt.ts";
import { type AppFile, computeIntegrity, parseAppManifest } from "@binette/core";
import { dirname, resolve } from "@std/path";
import { iconPath } from "./paths.ts";

/** アプリをビルドし、.binapp に書き出す */
export async function writePrebuiltApp(dir: string, out: string, replique: string): Promise<string> {
  const root = resolve(dir);
  const read = (path: string) => Deno.readTextFile(resolve(root, path));
  const text = await read("app.json");
  const manifest = parseAppManifest(text);
  const icon = iconPath(manifest.icon);
  const built = await buildApp((path) => path === "app.json" ? Promise.resolve(text) : read(path), {
    libraries: { "jsr:@binette/replique": await Deno.readTextFile(replique) },
  });
  const subIcons: Record<string, string> = {};
  for (const [id, sub] of Object.entries(manifest.sub ?? {})) {
    const path = iconPath(sub.icon);
    if (path !== undefined) subIcons[id] = await read(path);
  }
  const output = stringifyPrebuiltApp({ ...built, ...(Object.keys(subIcons).length ? { subIcons } : {}), icon: icon === undefined ? undefined : await read(icon) });
  const path = resolve(out);
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, output);
  return path;
}

/**
 * アプリのフォルダの下のファイルを再帰で集める。パスはフォルダからの相対で、`/` 区切り。
 * 暗黙の判断: 名前が `.` で始まるファイルとフォルダ（`.git`・`.DS_Store` など）と、シンボリックリンクは含めない。
 */
export async function collectAppFiles(dir: string): Promise<AppFile[]> {
  const root = resolve(dir);
  const files: AppFile[] = [];
  async function walk(relative: string): Promise<void> {
    for await (const entry of Deno.readDir(resolve(root, relative))) {
      if (entry.name.startsWith(".") || entry.isSymlink) continue;
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory) await walk(path);
      else if (entry.isFile) files.push({ path, bytes: await Deno.readFile(resolve(root, path)) });
    }
  }
  await walk("");
  return files;
}

/** アプリのフォルダの `integrity` のハッシュを求める。`keys` を省略すると `/`（アプリ全体）だけ */
export async function computeAppIntegrity(dir: string, keys: string[] = []): Promise<Record<string, string>> {
  const files = await collectAppFiles(dir);
  const result: Record<string, string> = {};
  for (const key of keys.length === 0 ? ["/"] : keys) {
    Object.defineProperty(result, key, { value: await computeIntegrity(files, key), enumerable: true, writable: true, configurable: true });
  }
  return result;
}

if (import.meta.main) {
  const failure = Deno.args[0] === "integrity" ? "ハッシュを求められません。" : ".binapp を書き出せません。";
  try {
    if (Deno.args[0] === "build") {
      const [, dir, outFlag, out, repliqueFlag, replique] = Deno.args;
      if (Deno.args.length !== 6 || outFlag !== "--out" || repliqueFlag !== "--replique") {
        throw new Error("build <アプリのフォルダ> --out <ファイル> --replique <Réplique の AS のパス> を指定してください。");
      }
      console.log(await writePrebuiltApp(dir!, out!, replique!));
    } else if (Deno.args[0] === "integrity") {
      const [, dir, ...keys] = Deno.args;
      if (dir === undefined) throw new Error("integrity <アプリのフォルダ> [キー...] を指定してください。");
      console.log(JSON.stringify(await computeAppIntegrity(dir, keys), null, 2));
    } else throw new Error("build か integrity を指定してください。");
  } catch (error) {
    console.error(`${failure}${error instanceof Error ? error.message : String(error)}`);
    Deno.exitCode = 1;
  }
}
