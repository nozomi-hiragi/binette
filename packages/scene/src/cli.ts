import { parseAppManifest } from "@binette/core";
import { Window } from "happy-dom";
import { resolve } from "node:path";
import { generateBindingsSource, type HtmlParser, parseBindings } from "./bindings.ts";
import { appPath, bindingsPath } from "./paths.ts";

/** アプリの HTML から、AS の入口と同じフォルダに bina.ts を書き出す */
export async function writeBindings(dir: string): Promise<string> {
  const root = resolve(dir);
  const manifest = parseAppManifest(await Deno.readTextFile(resolve(root, "app.json")));
  const entry = appPath(manifest.entry.as);
  const htmlPath = appPath(manifest.entry.html);
  if (!entry || !htmlPath) throw new Error("アプリの入口は app.json のフォルダ内の相対パスにしてください。");
  const window = new Window();
  try {
    const html = await Deno.readTextFile(resolve(root, htmlPath));
    const bindings = parseBindings(html, new window.DOMParser() as unknown as HtmlParser);
    const path = resolve(root, bindingsPath(entry));
    await Deno.writeTextFile(path, generateBindingsSource(bindings));
    return path;
  } finally {
    await window.happyDOM.close();
  }
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
