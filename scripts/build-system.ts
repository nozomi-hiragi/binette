import { resolve } from "@std/path";
import { copy } from "@std/fs";
import { buildApp } from "../packages/regie/src/build.ts";
import { iconPath } from "../packages/regie/src/paths.ts";

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

/** 配布するファイルの目録。パスは配布元からの相対パス */
export interface SystemManifest {
  version: string;
  files: { path: string; sha256: string; size: number }[];
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function remove(path: string): Promise<void> {
  try { await Deno.remove(path, { recursive: true }); }
  catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
}

/** app.json を持つ直下のフォルダを UTF-16 コード単位の辞書順で返す */
export async function appNames(root: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(root)) {
    if (!entry.isDirectory) continue;
    try {
      if ((await Deno.stat(resolve(root, entry.name, "app.json"))).isFile) names.push(entry.name);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  return names.sort(compare);
}

/** 出力先を作り直し、アプリごとに固定名のビルド結果を置く */
export async function buildFolder(root: string, out: string, replique: string, label = "システムアプリ"): Promise<string[]> {
  const names = await appNames(root);
  await remove(out);
  await Deno.mkdir(out, { recursive: true });
  for (const name of names) {
    try {
      const source = resolve(root, name);
      const read = (path: string) => Deno.readTextFile(resolve(source, path));
      const built = await buildApp(read, { libraries: { "jsr:@binette/replique": await Deno.readTextFile(replique) } });
      const icon = iconPath(built.manifest.icon);
      // app.json は既存の AppManifest として読める形を保つ。実行物の名前は固定。
      const manifest = { ...built.manifest, ...(icon === undefined ? {} : { icon: "icon.svg" }) };
      const target = resolve(out, name);
      await Deno.mkdir(target, { recursive: true });
      await Deno.writeFile(resolve(target, "app.json"), encode(manifest));
      await Deno.writeFile(resolve(target, "app.wasm"), built.wasm);
      await Deno.writeTextFile(resolve(target, "index.html"), built.html);
      if (icon !== undefined) await Deno.writeTextFile(resolve(target, "icon.svg"), await read(icon));
    } catch (error) {
      throw new Error(`${label}「${name}」を書き出せません。${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
  return names;
}

/** system 内だけを走査し、内容とパスから安定した版を作る */
export async function systemManifest(root: string): Promise<SystemManifest> {
  const files: SystemManifest["files"] = [];
  async function visit(dir: string, path: string): Promise<void> {
    for await (const entry of Deno.readDir(dir)) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory) await visit(resolve(dir, entry.name), child);
      else if (entry.isFile) {
        const bytes = await Deno.readFile(resolve(dir, entry.name));
        files.push({ path: child, sha256: await sha256(bytes), size: bytes.byteLength });
      }
    }
  }
  await visit(root, "system");
  files.sort((a, b) => compare(a.path, b.path));
  return { version: await sha256(encode(files)), files };
}

/** asc と Binaryen を、追加の取得が要らない単一のブラウザ用 ESM にまとめる */
export async function buildCompiler(out: string): Promise<void> {
  const target = resolve(out);
  await Deno.mkdir(resolve(target, ".."), { recursive: true });
  const staging = await Deno.makeTempDir({ prefix: "binette-compiler-" });
  try {
    // npm: を直接入口にすると Deno が CLI を選ぶため、API を再公開する入口を置く。
    await Deno.writeTextFile(resolve(staging, "entry.ts"), 'export * from "npm:assemblyscript@0.28.20/asc";\n');
    const result = await new Deno.Command(Deno.execPath(), {
      // fixture の設定や node_modules に依存せず、実装側の lock で推移依存も固定する。
      cwd: staging,
      args: [
        "bundle", "--no-config", "--lock", resolve(import.meta.dirname!, "../deno.lock"),
        "--frozen-lockfile", "--node-modules-dir=none",
        "--platform", "browser", "--format", "esm", "--minify",
        "--output", target, "entry.ts",
      ],
      stdout: "null",
      stderr: "piped",
    }).output();
    if (!result.success) {
      throw new Error(`コンパイラを書き出せません。${new TextDecoder().decode(result.stderr)}`);
    }
  } finally { await Deno.remove(staging, { recursive: true }); }
}

/** 旧方式の生成物だけを消し、ほかのファイルには触れない */
async function cleanPrebuilt(root: string): Promise<void> {
  for (const dir of [".binapp", ".binapp/system", ".binapp/bundled"]) {
    try {
      for await (const entry of Deno.readDir(resolve(root, dir))) {
        if (entry.isFile && entry.name.endsWith(".binapp")) await Deno.remove(resolve(root, dir, entry.name));
      }
    } catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
  }
}

/** 全アプリのビルドが成功してから、Vite に渡す無視済みの配布物を入れ替える */
export async function buildApps(root: string): Promise<void> {
  const staging = await Deno.makeTempDir({ prefix: "binette-system-" });
  try {
    const system = resolve(staging, "system");
    const replique = resolve(root, "packages/replique/src/index.ts");
    for (const [source, output, label] of [["apps", "apps", "システムアプリ"], ["bundled", "bundled", "同梱アプリ"]] as const) {
      const names = await buildFolder(resolve(root, source), resolve(system, output), replique, label);
      for (const name of names) console.log(`system/${output}/${name}`);
    }
    const roles: Record<string, string> = {};
    for (const name of ["home", "settings"]) {
      try {
        const manifest = JSON.parse(await Deno.readTextFile(resolve(system, "apps", name, "app.json")));
        roles[name] = manifest.id;
      } catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
    }
    await Deno.writeFile(resolve(system, "boot.json"), encode({ roles }));
    await buildCompiler(resolve(system, "tools/asc.js"));
    await Deno.mkdir(resolve(system, "libraries"));
    await Deno.copyFile(replique, resolve(system, "libraries/replique.ts"));
    const manifest = await systemManifest(system);
    const publicDir = resolve(root, ".binapp/public");
    await remove(publicDir);
    try { await copy(resolve(root, "public"), publicDir); }
    catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
    await Deno.mkdir(publicDir, { recursive: true });
    await remove(resolve(publicDir, "system"));
    for (const folder of ["apps", "bundled"]) await Deno.mkdir(resolve(publicDir, "system", folder), { recursive: true });
    // 一時領域とリポジトリが別のファイルシステムでも動くよう、rename せずコピーする。
    for (const file of manifest.files) {
      const target = resolve(publicDir, file.path);
      await Deno.mkdir(resolve(target, ".."), { recursive: true });
      await Deno.copyFile(resolve(staging, file.path), target);
    }
    await Deno.writeFile(resolve(publicDir, "manifest.json"), encode(manifest));
    await cleanPrebuilt(root);
  } finally { await Deno.remove(staging, { recursive: true }); }
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname!, "..");
  try {
    if (Deno.args.length) throw new Error("引数は指定できません。");
    await buildApps(root);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exitCode = 1;
  }
}
