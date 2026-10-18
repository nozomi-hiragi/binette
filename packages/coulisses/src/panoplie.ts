import { parseBinette, type Binette } from "@binette/core";

/** パノプリに入れる、ビネット以外のファイル */
export interface PanoplieFile {
  /** 中身 */
  body: Uint8Array;
  /** Content-Type */
  type: string;
}

/**
 * Coulisses が配るものの一式。ビネットと、ビネット以外のファイルを持つ。
 *
 * キーは先頭の `/` を付けないパスで書く。ビネットは `.bina` も付けない（`/notes/123.bina` は `notes/123`）。
 */
export interface BinettePanoplie {
  /** 検査済みのビネット。`index` が入口 `/index.bina` */
  binettes: Record<string, Binette>;
  /** ビネット以外のファイル（`files/hello/main.js` など） */
  files: Record<string, PanoplieFile>;
}

/** {@link createPanoplie} に渡すファイル。文字列は UTF-8 で入れる。`type` を省くと拡張子から決める */
export type PanoplieFileInput = string | Uint8Array | { body: string | Uint8Array; type?: string };

const contentTypes: Record<string, string> = {
  bina: "application/json; charset=utf-8",
  json: "application/json; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  html: "text/html; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  woff2: "font/woff2",
};

/** 拡張子から Content-Type を決める。知らない拡張子は `application/octet-stream` */
export function contentTypeOf(path: string): string {
  const extension = /\.([^./]+)$/.exec(path)?.[1].toLowerCase();
  return (extension && contentTypes[extension]) ?? "application/octet-stream";
}

function checkKey(key: string, kind: string): void {
  if (key === "" || key.startsWith("/") || key.endsWith("/") || key.includes("\\") || key.split("/").some(part => part === "" || part === "." || part === "..")) {
    throw new Error(`${kind}の名前が正しくありません: ${key}`);
  }
}

/**
 * ビネットの辞書（とファイル）からパノプリを作る。ビネットはここで全部検査する。
 *
 * @param binettes キーが `.bina` を除いたパス（`index`・`home`・`notes/123`）、値がビネットのオブジェクト
 * @param files ビネット以外のファイル。キーは先頭の `/` を付けないパス
 * @throws {Error} ビネットの形式が正しくないとき、`settings` が `index` 以外にあるとき、名前が正しくないとき
 *
 * @example
 * ```ts
 * const panoplie = createPanoplie({
 *   index: { binette: "0.1", redirect: "/home" },
 *   home: { binette: "0.1", entry: "main", assets: { main: { type: "html", content: "<p>こんにちは</p>" } } },
 * });
 * ```
 */
export function createPanoplie(binettes: Record<string, unknown>, files: Record<string, PanoplieFileInput> = {}): BinettePanoplie {
  const panoplie: BinettePanoplie = { binettes: Object.create(null), files: Object.create(null) };
  for (const [key, value] of Object.entries(binettes)) {
    checkKey(key, "ビネット");
    let binette: Binette;
    try {
      binette = parseBinette(JSON.stringify(value));
    } catch (error) {
      throw new Error(`/${key}.bina: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (binette.settings !== undefined && key !== "index") throw new Error(`/${key}.bina: settings は入口 /index.bina にだけ書けます。`);
    panoplie.binettes[key] = binette;
  }
  const encoder = new TextEncoder();
  for (const [key, value] of Object.entries(files)) {
    checkKey(key, "ファイル");
    if (key.endsWith(".bina")) throw new Error(`.bina はビネットとして渡してください: ${key}`);
    const input = typeof value === "string" || value instanceof Uint8Array ? { body: value } : value;
    panoplie.files[key] = {
      body: typeof input.body === "string" ? encoder.encode(input.body) : input.body,
      type: input.type ?? contentTypeOf(key),
    };
  }
  return panoplie;
}

/**
 * ビネットの辞書を書いた JSON 文字列からパノプリを作る。
 *
 * @param text `{"index": {...}, "home": {...}}` の形の JSON
 * @throws {Error} JSON として読めないとき、オブジェクトでないとき、{@link createPanoplie} と同じ理由のとき
 */
export function parsePanoplie(text: string): BinettePanoplie {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("パノプリを JSON として読めません。");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("パノプリはビネットの辞書のオブジェクトで書いてください。");
  return createPanoplie(value as Record<string, unknown>);
}
