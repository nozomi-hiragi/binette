import { buildApp, type BuildOptions } from "./build.ts";
import { stringifyPrebuiltApp } from "./prebuilt.ts";
import { type AppFile, computeIntegrity, parseAppManifest } from "@binette/core";
import { dirname, fromFileUrl, resolve, toFileUrl } from "@std/path";
import { appPath, iconPath } from "./paths.ts";

/** Load every AssemblyScript feature from the SDK source directory. */
export async function readRepliqueLibraries(directory: string | URL): Promise<Record<string, string>> {
  if (!(await Deno.stat(directory)).isDirectory) {
    throw new Error("--replique requires the Réplique AS source directory, not a file.");
  }
  const root = toFileUrl(resolve(directory instanceof URL ? fromFileUrl(directory) : directory) + "/");
  const names: string[] = [];
  for await (const entry of Deno.readDir(root)) {
    if (entry.isFile && entry.name.endsWith(".ts")) names.push(entry.name);
  }
  if (!names.includes("index.ts")) throw new Error("The Réplique AS source directory must contain index.ts.");
  const libraries: Record<string, string> = {};
  for (const name of names.sort()) {
    const specifier = name === "index.ts" ? "jsr:@binette/replique" : `jsr:@binette/replique/${name.slice(0, -3)}`;
    libraries[specifier] = await Deno.readTextFile(new URL(name, root));
  }
  return libraries;
}

/** アプリをビルドし、.binapp に書き出す */
export async function writePrebuiltApp(dir: string, out: string, replique: string): Promise<string> {
  const root = resolve(dir);
  const read = (path: string) => Deno.readTextFile(resolve(root, path));
  const text = await read("app.json");
  const manifest = parseAppManifest(text);
  const icon = iconPath(manifest.icon);
  const built = await buildApp((path) => path === "app.json" ? Promise.resolve(text) : read(path), {
    libraries: await readRepliqueLibraries(replique),
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

/** install と同じビルドとアイコンの読み込みで、取得したファイルだけを集める。 */
async function collectBuildFiles(dir: string, keys: string[], options: BuildOptions): Promise<AppFile[]> {
  if (options.libraries?.["jsr:@binette/replique"] === undefined) throw new Error("/ とフォルダキーのハッシュには --replique <Réplique の AS ソースフォルダ> を指定してください。");
  const root = resolve(dir);
  const files = new Map<string, Uint8Array>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const readBytes = async (name: string): Promise<Uint8Array> => {
    const path = appPath(name);
    if (!path || path.includes("?") || path.includes("#")) throw new Error("アプリのフォルダ外は読めません。");
    let bytes = files.get(path);
    if (bytes === undefined) { bytes = await Deno.readFile(resolve(root, path)); files.set(path, bytes); }
    return bytes;
  };
  const read = async (path: string) => decoder.decode(await readBytes(path));
  const built = await buildApp(read, options);
  for (const icon of [built.manifest.icon, ...Object.values(built.manifest.sub ?? {}).map(sub => sub.icon)]) {
    const path = iconPath(icon);
    if (path !== undefined) await read(path);
  }
  // install と同じく、明示されたファイルキーもフォルダのハッシュに含める。
  for (const key of keys) if (!key.endsWith("/")) {
    if (!key || appPath(key) !== key || key.includes("?") || key.includes("#")) throw new Error(`integrity のパスが正しくありません: ${key}`);
    await readBytes(key);
  }
  return [...files].map(([path, bytes]) => ({ path, bytes }));
}

/**
 * アプリのフォルダの `integrity` のハッシュを求める。`keys` を省略すると `/`（アプリ全体）だけ。
 * `/` とフォルダキーは install と同じ取得対象をビルドで確定するため、`options.libraries` に Réplique の AS を渡す。
 */
export async function computeAppIntegrity(dir: string, keys: string[] = [], options: BuildOptions = {}): Promise<Record<string, string>> {
  const targets = keys.length === 0 ? ["/"] : keys;
  for (const key of targets) {
    if (key === "/") continue;
    const path = key.replace(/\/$/, "");
    if (!path || appPath(path) !== path || path.includes("?") || path.includes("#")) throw new Error(`integrity のパスが正しくありません: ${key}`);
  }
  const files = targets.some(key => key.endsWith("/")) ? await collectBuildFiles(dir, targets, options) : await Promise.all(targets.map(async key =>
    ({ path: key, bytes: await Deno.readFile(resolve(dir, key)) })
  ));
  const result: Record<string, string> = {};
  for (const key of targets) {
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
        throw new Error("build <アプリのフォルダ> --out <ファイル> --replique <Réplique の AS ソースフォルダ> を指定してください。");
      }
      console.log(await writePrebuiltApp(dir!, out!, replique!));
    } else if (Deno.args[0] === "integrity") {
      const [, dir, ...keys] = Deno.args;
      const flag = keys.indexOf("--replique");
      const options: BuildOptions = {};
      if (flag !== -1) {
        const path = keys[flag + 1];
        if (path === undefined) throw new Error("--replique の後に Réplique の AS ソースフォルダを指定してください。");
        options.libraries = await readRepliqueLibraries(path);
        keys.splice(flag, 2);
      }
      if (dir === undefined) throw new Error("integrity <アプリのフォルダ> [キー...] [--replique <Réplique の AS ソースフォルダ>] を指定してください。");
      console.log(JSON.stringify(await computeAppIntegrity(dir, keys, options), null, 2));
    } else throw new Error("build か integrity を指定してください。");
  } catch (error) {
    console.error(`${failure}${error instanceof Error ? error.message : String(error)}`);
    Deno.exitCode = 1;
  }
}
