import { BinetteError } from "./parse.ts";

const encoder = new TextEncoder();
const HEX = /^[0-9A-Fa-f]{2}$/;
/** フラグメントにそのまま書ける ASCII の文字（RFC 3986 の unreserved・sub-delims と `: @ / ?`） */
const KEEP = /^[A-Za-z0-9\-._~!$&'()*+,;=:@/?]$/;

/** 識別子の誤りを BinetteError にする */
function invalid(message: string): never {
  throw new BinetteError("invalid_format", message);
}

/** {@link normalizeAppListUrl} と {@link parseAppId} の設定 */
export interface AppIdOptions {
  /** `http:` の提供リストを許す。設定のデバッグメニューで有効にしたときだけ使う（開発用） */
  allowHttp?: boolean;
}

/** 完全な ID を分解した形 */
export interface AppId {
  /** 提供リストの URL（正規化済み）。OS に埋め込んだアプリ（生の ID）では undefined */
  list?: string;
  /** 識別子（% エンコード済みで正規化済み） */
  id: string;
  /** サブアプリの識別子。親のアプリそのものなら undefined */
  sub?: string;
}

/**
 * アプリの識別子を正規化する。
 * URL のフラグメントに書けない文字を UTF-8 の `%XX`（16 進は大文字）にし、
 * すでにある `%xx` は 16 進を大文字に揃えるだけで復号しない。
 * 16 進が続かない `%` は `%25` にする。英字の大文字と小文字は区別する。
 *
 * @param s 識別子
 * @returns 正規化した識別子
 * @throws {BinetteError} 空のとき、`.`（`%2E` を含む）を含むとき
 */
export function normalizeAppIdentifier(s: string): string {
  if (s === "") invalid("識別子が空です。");
  if (s.includes(".")) invalid(`識別子に . は使えません: ${s}`);
  let out = "";
  for (let i = 0; i < s.length;) {
    const ch = String.fromCodePoint(s.codePointAt(i)!);
    if (ch === "%") {
      if (HEX.test(s.slice(i + 1, i + 3))) {
        out += `%${s.slice(i + 1, i + 3).toUpperCase()}`;
        i += 3;
      } else {
        out += "%25";
        i += 1;
      }
      continue;
    }
    out += KEEP.test(ch) ? ch : Array.from(encoder.encode(ch), (b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`).join("");
    i += ch.length;
  }
  // 暗黙の判断: %2E は . と同じ意味なので、区切りの . との混同を避けるため . と同じく誤りにする
  if (out.toUpperCase().includes("%2E")) invalid(`識別子に . は使えません: ${s}`);
  return out;
}

/**
 * 提供リストの URL を正規化する。`new URL()` で読み、`href` を返す。
 * `https:` だけを許し（`allowHttp` のときは `http:` も）、クエリとフラグメントは（空でも）誤りにする。
 *
 * @param s 提供リストの URL
 * @param options `allowHttp` で `http:` を許す
 * @returns 正規化した URL
 * @throws {BinetteError} URL として読めないとき、スキームが許されないとき、クエリやフラグメントがあるとき
 */
export function normalizeAppListUrl(s: string, options: AppIdOptions = {}): string {
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return invalid(`提供リストの URL として読めません: ${s}`);
  }
  if (url.protocol !== "https:" && !(options.allowHttp && url.protocol === "http:")) {
    invalid(`提供リストの URL は https: だけ使えます: ${s}`);
  }
  // 末尾だけの ? や # は url.search・url.hash が空になるので、元の文字列で調べる
  if (s.includes("?") || s.includes("#") || url.search !== "" || url.hash !== "") {
    invalid(`提供リストの URL にクエリやフラグメントは付けられません: ${s}`);
  }
  return url.href;
}

/**
 * 完全な ID の文字列を作る。`list` があれば URL の ID（リストの URL ＋ `#` ＋ 識別子）、
 * 無ければ生の ID（識別子そのまま）。サブアプリは識別子の後ろに `.` ＋ サブアプリの識別子を連ねる。
 * 識別子とリストの URL は正規化する。
 *
 * @throws {BinetteError} 識別子やリストの URL が正しくないとき、生の ID が `:` を含むとき
 */
export function formatAppId(app: AppId, options: AppIdOptions = {}): string {
  const id = normalizeAppIdentifier(app.id);
  const sub = app.sub === undefined ? "" : `.${normalizeAppIdentifier(app.sub)}`;
  if (app.list === undefined) {
    if (id.includes(":") || sub.includes(":")) invalid("生の ID に : は使えません。");
    return `${id}${sub}`;
  }
  return `${normalizeAppListUrl(app.list, options)}#${id}${sub}`;
}

/**
 * 完全な ID の文字列を分解する。`:` を含めば URL の ID、含まなければ生の ID として読む。
 * 結果の `list`・`id`・`sub` は正規化済み。
 *
 * @throws {BinetteError} 形が正しくないとき（`#` が無い URL の ID、`.` が 2 つ以上、空の識別子など）
 */
export function parseAppId(s: string, options: AppIdOptions = {}): AppId {
  let list: string | undefined;
  let rest = s;
  if (s.includes(":")) {
    const hash = s.indexOf("#");
    if (hash < 0) invalid(`ID に # と識別子がありません: ${s}`);
    list = normalizeAppListUrl(s.slice(0, hash), options);
    rest = s.slice(hash + 1);
  }
  const parts = rest.split(".");
  if (parts.length > 2) invalid(`サブアプリは 1 段だけです: ${s}`);
  return {
    ...(list === undefined ? {} : { list }),
    id: normalizeAppIdentifier(parts[0]),
    ...(parts.length === 2 ? { sub: normalizeAppIdentifier(parts[1]) } : {}),
  };
}
