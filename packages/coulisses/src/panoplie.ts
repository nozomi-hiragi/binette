import { join } from "@std/path";
import { parseBinette, type Binette } from "@binette/core";

/** パノプリに入れる、ビネット以外のファイル */
export interface PanoplieFile {
  /** 中身 */
  body: Uint8Array<ArrayBuffer>;
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
 * パノプリにビネットを足す。同じ名前があれば置き換える。
 *
 * @param name `.bina` を除いたパス（`index`・`home`・`notes/123`）
 * @param value ビネットのオブジェクト
 * @throws {Error} ビネットの形式が正しくないとき、名前が正しくないとき
 */
export function addBinette(panoplie: BinettePanoplie, name: string, value: unknown): void {
  checkKey(name, "ビネット");
  let binette: Binette;
  try {
    binette = parseBinette(JSON.stringify(value));
  } catch (error) {
    throw new Error(`/${name}.bina: ${error instanceof Error ? error.message : String(error)}`);
  }
  panoplie.binettes[name] = binette;
}

/**
 * パノプリにビネット以外のファイルを足す。同じパスがあれば置き換える。
 *
 * @param path 先頭の `/` を付けないパス（`files/notes/main.js` など）
 * @throws {Error} パスが正しくないとき、`.bina` を渡したとき
 */
export function addFile(panoplie: BinettePanoplie, path: string, file: PanoplieFileInput): void {
  checkKey(path, "ファイル");
  if (path.endsWith(".bina")) throw new Error(`.bina はビネットとして足してください: ${path}`);
  const input = typeof file === "string" || file instanceof Uint8Array ? { body: file } : file;
  panoplie.files[path] = {
    // 渡された配列はあとで書き換えられても影響しないよう写す
    body: typeof input.body === "string" ? new TextEncoder().encode(input.body) : new Uint8Array(input.body),
    type: input.type ?? contentTypeOf(path),
  };
}

/**
 * ビネットの辞書（とファイル）からパノプリを作る。ビネットはここで全部検査する。
 *
 * @param binettes キーが `.bina` を除いたパス（`index`・`home`・`notes/123`）、値がビネットのオブジェクト
 * @param files ビネット以外のファイル。キーは先頭の `/` を付けないパス
 * @throws {Error} {@link addBinette}・{@link addFile} と同じ理由のとき
 *
 * @example
 * ```ts
 * const panoplie = createPanoplie({
 *   index: { binette: "0.1", redirect: "/home" },
 *   home: { binette: "0.1", entry: "main", assets: { main: { type: "html", content: "<p>こんにちは</p>" } } },
 * });
 * ```
 */
export function createPanoplie(binettes: Record<string, unknown> = {}, files: Record<string, PanoplieFileInput> = {}): BinettePanoplie {
  const panoplie: BinettePanoplie = { binettes: Object.create(null), files: Object.create(null) };
  for (const [name, value] of Object.entries(binettes)) addBinette(panoplie, name, value);
  for (const [path, file] of Object.entries(files)) addFile(panoplie, path, file);
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

/**
 * フォルダの中身からパノプリを作る。`.bina` はビネットとして検査し、ほかはファイルとして入れる。
 *
 * Deno の API（`Deno.readDir`・`Deno.readFile`）でフォルダを読むので、Deno でだけ動く。
 * 読むのは呼んだときの 1 回だけ。シンボリックリンクと、`.` で始まるファイルやフォルダは入れない。
 *
 * @param root 読むフォルダ
 * @throws {Error} JSON として読めない `.bina` があるときや、{@link createPanoplie} と同じ理由のとき
 *
 * @example
 * ```ts
 * const panoplie = await importPanoplie("/srv/site");
 * ```
 */
export async function importPanoplie(root: string): Promise<BinettePanoplie> {
  const panoplie = createPanoplie();
  const decoder = new TextDecoder();
  // key は root からの相対パスを / でつないだもの
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      const key = prefix + entry.name;
      // シンボリックリンクは isDirectory も isFile も偽なので入らない
      if (entry.isDirectory) {
        await walk(path, `${key}/`);
        continue;
      }
      if (!entry.isFile) continue;
      const body = await Deno.readFile(path);
      if (key.endsWith(".bina")) {
        let value: unknown;
        try {
          value = JSON.parse(decoder.decode(body));
        } catch {
          throw new Error(`/${key}: JSON として読めません。`);
        }
        addBinette(panoplie, key.slice(0, -".bina".length), value);
      } else {
        addFile(panoplie, key, body);
      }
    }
  };
  await walk(root, "");
  return panoplie;
}
