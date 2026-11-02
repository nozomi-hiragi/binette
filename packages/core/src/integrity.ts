import { BinetteError } from "./parse.ts";

const encoder = new TextEncoder();

/** ハッシュを取るアプリのファイル 1 つ分 */
export interface AppFile {
  /** アプリのフォルダからの相対パス（`/` 区切り、先頭に `/` を付けない） */
  path: string;
  /** ファイルの中身 */
  bytes: Uint8Array;
}

async function sha256(data: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return `sha256-${btoa(binary)}`;
}

/**
 * ファイルのハッシュ（中身の SHA-256）を `sha256-<base64>` の形で返す。
 */
export function hashFile(bytes: Uint8Array): Promise<string> {
  return sha256(bytes);
}

/**
 * フォルダのハッシュを `sha256-<base64>` の形で返す。
 * `folder` の下の全ファイルを、フォルダからの相対パスの UTF-16 コード単位の順
 * （JavaScript の `<` での比較）に並べ、ファイルごとに「パス・中身のバイト数・中身」をつないだものの SHA-256。
 *
 * `UTF-8(パス) 0x00 UTF-8(バイト数の 10 進) 0x00 中身` をファイルの数だけ続ける。
 *
 * @param files アプリの全ファイル
 * @param folder 対象のフォルダ。空文字列か `/` はアプリ全体、それ以外は `src/` のように `/` で終える
 * @throws {BinetteError} フォルダの下にファイルが無いとき
 */
export async function hashFolder(files: Iterable<AppFile>, folder = ""): Promise<string> {
  const prefix = folder === "/" ? "" : folder;
  const inside = [...files]
    .filter((file) => file.path.startsWith(prefix))
    .map((file) => ({ path: file.path.slice(prefix.length), bytes: file.bytes }))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (inside.length === 0) throw new BinetteError("invalid_format", `ハッシュを取るファイルがありません: ${folder === "" ? "/" : folder}`);
  const parts: Uint8Array[] = [];
  const zero = new Uint8Array([0]);
  for (const file of inside) {
    parts.push(encoder.encode(file.path), zero, encoder.encode(String(file.bytes.length)), zero, file.bytes);
  }
  const all = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    all.set(part, offset);
    offset += part.length;
  }
  return await sha256(all);
}

/**
 * `integrity` のキー 1 つ分のハッシュを求める。`/` はアプリ全体、`/` で終わるキーはフォルダ、それ以外はファイル。
 *
 * @throws {BinetteError} 対象のファイルやフォルダが無いとき
 */
export async function computeIntegrity(files: Iterable<AppFile>, key: string): Promise<string> {
  if (key.endsWith("/")) return await hashFolder(files, key);
  const file = [...files].find((f) => f.path === key);
  if (file === undefined) throw new BinetteError("invalid_format", `ハッシュを取るファイルがありません: ${key}`);
  return await hashFile(file.bytes);
}

/**
 * 提供リストの `integrity` を、ファイル一式に対して確かめる。書いたキーだけを確かめる。
 *
 * @param integrity キー → `sha256-<base64>`
 * @param files アプリの全ファイル
 * @throws {BinetteError} ファイルやフォルダが無いとき、ハッシュが合わないとき
 */
export async function verifyIntegrity(integrity: Record<string, string>, files: Iterable<AppFile>): Promise<void> {
  const list = [...files];
  for (const [key, expected] of Object.entries(integrity)) {
    const actual = await computeIntegrity(list, key);
    if (actual !== expected) throw new BinetteError("invalid_format", `ハッシュが合いません: ${key}`);
  }
}
