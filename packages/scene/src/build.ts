import { parseAppManifest, type AppManifest } from "@binette/core";
import { appPath, entryPaths } from "./paths.ts";

/** asc の標準出力・標準エラーの受け皿 */
export interface CompilerStream {
  write(chunk: string | Uint8Array): void;
  toString(): string;
}

/** asc（AssemblyScript のコンパイラ）のうち、ここで使う分 */
export interface Compiler {
  main(argv: string[], options: {
    readFile: (name: string, baseDir: string) => string | null | Promise<string | null>;
    writeFile: (name: string, contents: string | Uint8Array, baseDir: string) => void;
    listFiles: (dirname: string, baseDir: string) => string[] | null;
    stdout?: CompilerStream;
    stderr?: CompilerStream;
  }): Promise<{ error: Error | null }>;
  createMemoryStream(): CompilerStream;
}

let compiler: Promise<Compiler> | undefined;

/** asc を読み込む。初回だけ dynamic import し、結果は使い回す */
export function loadCompiler(): Promise<Compiler> {
  compiler ??= import("assemblyscript/asc").then((module) => module as unknown as Compiler);
  // 読み込みに失敗したら、次の呼び出しでやり直せるようにする
  compiler.catch(() => { compiler = undefined; });
  return compiler;
}

/** {@link buildApp} の設定 */
export interface BuildOptions {
  /** `jsr:@binette/replique` などの指定子 → AS のソース。Réplique は未公開なので、今は呼ぶ側がワークスペースのファイルを渡す */
  libraries?: Record<string, string>;
  /** 使う asc。省略すると {@link loadCompiler} で読み込む */
  compiler?: Compiler;
}

/** ビルドしたアプリ */
export interface BuiltApp {
  /** `app.json` の中身 */
  manifest: AppManifest;
  /** 入口の HTML */
  html: string;
  /** AS をビルドした WASM */
  wasm: Uint8Array;
}

const NODE_MODULES = "node_modules/";

/** asc が読みに来るファイルの名前から、`libraries` の指定子を探す。`node_modules/<指定子>.ts` か `node_modules/<指定子>/index.ts` */
function findLibrary(libraries: Record<string, string>, name: string): string | null {
  if (!name.startsWith(NODE_MODULES)) return null;
  const path = name.slice(NODE_MODULES.length);
  for (const suffix of [".ts", "/index.ts"]) {
    if (!path.endsWith(suffix)) continue;
    const specifier = path.slice(0, -suffix.length);
    if (Object.hasOwn(libraries, specifier)) return libraries[specifier]!;
  }
  return null;
}

/**
 * アプリのファイルを読む関数から `app.json`・HTML・AS を読み、AS を WASM にビルドする。
 *
 * @param read アプリのファイルを読む関数。`app.json` からの相対パスを受けて中身を返す
 * @throws {BinetteError} `app.json` の形式が正しくないとき
 * @throws {Error} ビルドに失敗したとき（asc の出力を含む）
 */
export async function buildApp(read: (path: string) => Promise<string>, options: BuildOptions = {}): Promise<BuiltApp> {
  const manifest = parseAppManifest(await read("app.json"));
  const { as: entry, html: htmlPath } = entryPaths(manifest.entry);
  const [html, source] = await Promise.all([read(htmlPath), read(entry)]);
  const asc = options.compiler ?? await loadCompiler();
  const libraries = options.libraries ?? {};
  const stdout = asc.createMemoryStream();
  const stderr = asc.createMemoryStream();
  let wasm: Uint8Array | undefined;
  // 初期化を instantiate の中で走らせず、Régie が _start で呼ぶ
  const { error } = await asc.main([entry, "--outFile", "main.wasm", "--optimizeLevel", "2", "--exportStart", "_start", "--exportRuntime"], {
    readFile: async (name) => {
      const path = appPath(name);
      if (path === null) return null;
      if (path === entry) return source + '\nexport { __bina_event } from "jsr:@binette/replique";\n';
      if (path.startsWith(NODE_MODULES)) return findLibrary(libraries, path);
      if (!path.endsWith(".ts")) return null;
      try { return await read(path) ?? null; } catch { return null; }
    },
    writeFile: (name, contents) => { if (name === "main.wasm" && typeof contents !== "string") wasm = contents; },
    listFiles: () => [],
    stdout,
    stderr,
  });
  if (error || !wasm) {
    const output = (stderr.toString() || stdout.toString() || error?.message || "").trim();
    throw new Error(`アプリをビルドできません。\n${output}`);
  }
  return { manifest, html, wasm };
}
