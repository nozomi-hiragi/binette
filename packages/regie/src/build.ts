import decorParts from "@binette/decor/parts" with { type: "text" };
import decorAs from "@binette/decor/as" with { type: "text" };
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
  /** `entry.css` の CSS。指定が無ければ undefined */
  css?: string;
  /** AS をビルドした WASM */
  wasm: Uint8Array;
}

const LIBRARY_PREFIXES = ["node_modules/", "/node_modules/", "~lib/"];

/** asc が読みに来るファイルの名前から、`libraries` の指定子を探す。`node_modules/<指定子>.ts` か `node_modules/<指定子>/index.ts` */
function findLibrary(libraries: Record<string, string>, name: string): string | null {
  const prefix = LIBRARY_PREFIXES.find(prefix => name.startsWith(prefix));
  if (prefix === undefined) return null;
  const path = name.slice(prefix.length);
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
  const { as: entry, html: htmlPath, css: cssPath } = entryPaths(manifest.entry);
  const [html, source, css] = await Promise.all([htmlPath === undefined ? Promise.resolve("") : read(htmlPath), read(entry), cssPath === undefined ? Promise.resolve(undefined) : read(cssPath)]);
  const asc = options.compiler ?? await loadCompiler();
  const libraries: Record<string, string> = { "jsr:@binette/decor/as": decorAs, "jsr:@binette/decor/parts": decorParts, ...options.libraries };
  if (libraries["jsr:@binette/replique"] !== undefined && libraries["jsr:@binette/replique/ui"] === undefined) {
    libraries["jsr:@binette/replique/ui"] = 'export { View, column, row, text, button, buttonOf, input, grid, appIcon, appArea, show, theme, space, radius, fontSize, Theme, Scale, ComponentTheme, ' +
      'spacer, separator, stack, checkbox, radio, slider, picker, segmented, tabs, progress, spinner, image, listTile, chip, badge, menuItem } from "jsr:@binette/replique";';
  }
  const stdout = asc.createMemoryStream();
  const stderr = asc.createMemoryStream();
  let wasm: Uint8Array | undefined;
  // 初期化を instantiate の中で走らせず、Régie が _start で呼ぶ
  const { error } = await asc.main([entry, "--outFile", "main.wasm", "--optimizeLevel", "2", "--exportStart", "_start", "--exportRuntime"], {
    readFile: async (name) => {
      // ブラウザ版 asc は /node_modules/ からも探す。ここでは渡されたライブラリだけを返し、アプリの外は読まない。
      if (LIBRARY_PREFIXES.some(prefix => name.startsWith(prefix))) return findLibrary(libraries, name);
      const path = appPath(name);
      if (path === null) return null;
      if (path === entry) return source + '\nexport { __bina_event, __bina_lifecycle, __bina_ui_event, __bina_ui_text, __bina_ui_value, __bina_shell_sync } from "jsr:@binette/replique";\n';
      if (LIBRARY_PREFIXES.some(prefix => path.startsWith(prefix))) return findLibrary(libraries, path);
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
  return { manifest, html, ...(css === undefined ? {} : { css }), wasm };
}
