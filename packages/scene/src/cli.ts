import { parseAppManifest } from "@binette/core";
// deno-dom の WASM 版。FFI もネイティブのライブラリも要らない
import { DOMParser } from "@b-fuze/deno-dom";
import { resolve } from "node:path";
import { generateBindingsSource, type HtmlParser, parseBindings } from "./bindings.ts";
import { entryPaths } from "./paths.ts";

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

if (import.meta.main) {
  try {
    if (Deno.args.length !== 1) throw new Error("アプリのフォルダを 1 つ指定してください。");
    console.log(await writeBindings(Deno.args[0]!));
  } catch (error) {
    console.error(`bina.ts を書き出せません。${error instanceof Error ? error.message : String(error)}`);
    Deno.exitCode = 1;
  }
}
