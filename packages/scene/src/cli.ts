import { buildApp } from "./build.ts";
import { stringifyPrebuiltApp } from "./prebuilt.ts";
import { parseAppManifest } from "@binette/core";
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
  const output = stringifyPrebuiltApp({ ...built, icon: icon === undefined ? undefined : await read(icon) });
  const path = resolve(out);
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, output);
  return path;
}

if (import.meta.main) {
  try {
    if (Deno.args[0] === "build") {
      const [, dir, outFlag, out, repliqueFlag, replique] = Deno.args;
      if (Deno.args.length !== 6 || outFlag !== "--out" || repliqueFlag !== "--replique") {
        throw new Error("build <アプリのフォルダ> --out <ファイル> --replique <Réplique の AS のパス> を指定してください。");
      }
      console.log(await writePrebuiltApp(dir!, out!, replique!));
    } else throw new Error("build を指定してください。");
  } catch (error) {
    console.error(`.binapp を書き出せません。${error instanceof Error ? error.message : String(error)}`);
    Deno.exitCode = 1;
  }
}
