import { resolve } from "@std/path";
import { writeBindings, writePrebuiltApp } from "../packages/scene/src/cli.ts";

/** app.json を持つ直下のフォルダを UTF-16 コード単位の辞書順で返す */
export async function systemApps(root: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(root)) {
    if (!entry.isDirectory) continue;
    try {
      if ((await Deno.stat(resolve(root, entry.name, "app.json"))).isFile) names.push(entry.name);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  return names.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

/** 古い .binapp を消してから、システムアプリを書き出す */
export async function buildSystem(root: string, out: string, replique: string): Promise<string[]> {
  const names = await systemApps(root);
  await Deno.mkdir(out, { recursive: true });
  for await (const entry of Deno.readDir(out)) {
    if (entry.isFile && entry.name.endsWith(".binapp")) await Deno.remove(resolve(out, entry.name));
  }
  for (const name of names) {
    try {
      await writePrebuiltApp(resolve(root, name), resolve(out, `${name}.binapp`), replique);
    } catch (error) {
      throw new Error(`システムアプリ「${name}」を書き出せません。${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
  return names;
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname!, "..");
  try {
    if (Deno.args.length === 1 && Deno.args[0] === "--bindings") {
      for (const name of await systemApps(resolve(root, "apps"))) {
        try { console.log(await writeBindings(resolve(root, "apps", name))); }
        catch (error) { throw new Error(`システムアプリ「${name}」の bina.ts を書き出せません。${error instanceof Error ? error.message : String(error)}`); }
      }
    } else {
      if (Deno.args.length) throw new Error("引数は --bindings だけ指定できます。");
      console.log((await buildSystem(resolve(root, "apps"), resolve(root, ".binapp"), resolve(root, "packages/replique/src/index.ts"))).join("\n"));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exitCode = 1;
  }
}
