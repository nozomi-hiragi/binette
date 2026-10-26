import { buildApp } from "./build.ts";
import { stringifyPrebuiltApp } from "./prebuilt.ts";
import { parseAppManifest } from "@binette/core";
// deno-dom の WASM 版。FFI もネイティブのライブラリも要らない
import { DOMParser } from "@b-fuze/deno-dom";
import { dirname, resolve } from "@std/path";
import { generateBindingsSource, type HtmlParser, parseBindings } from "./bindings.ts";
import { entryPaths, iconPath } from "./paths.ts";

/** アプリの HTML から、AS の入口と同じフォルダに bina.ts を書き出す */
export async function writeBindings(dir: string): Promise<string> {
  const root = resolve(dir);
  const manifest = parseAppManifest(await Deno.readTextFile(resolve(root, "app.json")));
  const { html: htmlPath, bindings: bindingsFile } = entryPaths(manifest.entry);
  const html = await Deno.readTextFile(resolve(root, htmlPath));
  const bindings = parseBindings(html, new DOMParser() as unknown as HtmlParser);
  const path = resolve(root, bindingsFile);
  await Deno.writeTextFile(path, generateBindingsSource(bindings));
  return path;
}

/** アプリをビルドし、.binapp に書き出す */
export async function writePrebuiltApp(dir: string, out: string, replique: string): Promise<string> {
  const root = resolve(dir);
  const read = (path: string) => Deno.readTextFile(resolve(root, path));
  const text = await read("app.json");
  const manifest = parseAppManifest(text);
  const icon = iconPath(manifest.icon);
  const built = await buildApp((path) => path === "app.json" ? Promise.resolve(text) : read(path), {
    parser: new DOMParser() as unknown as HtmlParser,
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
    } else {
      if (Deno.args.length !== 1) throw new Error("アプリのフォルダを 1 つ指定してください。");
      console.log(await writeBindings(Deno.args[0]!));
    }
  } catch (error) {
    console.error(`${Deno.args[0] === "build" ? ".binapp" : "bina.ts"} を書き出せません。${error instanceof Error ? error.message : String(error)}`);
    Deno.exitCode = 1;
  }
}
