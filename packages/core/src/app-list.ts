import { type AppIdOptions, normalizeAppIdentifier, normalizeAppListUrl } from "./app-id.ts";
import { BinetteError } from "./parse.ts";

function invalid(message: string): never {
  throw new BinetteError("invalid_format", message);
}

/** 提供リストの HTML から読み取る DOM の最小の形。`Document`（happy-dom も）がそのまま当てはまる */
export interface AppListDocument {
  querySelectorAll(selectors: string): Iterable<{ getAttribute(name: string): string | null; textContent: string | null }>;
}

/** 機械向けのリストの置き場所 */
export type AppListLocation =
  | { kind: "link"; /** 解決済みの JSON の URL */ url: string }
  | { kind: "embedded"; /** 埋め込みの JSON の文字列 */ text: string };

/** 提供リストのアプリ 1 つ分 */
export interface AppListEntry {
  /** 識別子（正規化済み） */
  id: string;
  /** アプリ本体のフォルダの URL（解決済み） */
  source: string;
  /** 版の文字列 */
  version: string;
  /** 改ざん検出のハッシュの辞書（キーは `source` から見たパス） */
  integrity?: Record<string, string>;
  /** 表示名（表示用。入れたあとは `app.json` を正とする） */
  name?: string;
  /** アイコンの URL（解決済み、表示用） */
  icon?: string;
  /** 短い説明（表示用） */
  description?: string;
}

/** 読み終えた提供リスト */
export interface AppList {
  /** リストの表示名 */
  name: string;
  /** アプリの一覧。`movedTo` があるときは読まずに空 */
  apps: AppListEntry[];
  /** 引っ越し先のリストの URL（正規化済み） */
  movedTo?: string;
}

/**
 * 提供リストの HTML から、機械向けのリストの置き場所を探す。
 * `<link rel="binette-apps" href>` を先に探し（`rel` は空白区切り）、無いときだけ
 * `<script type="application/json" id="binette-apps">` を読む。
 * HTML は呼び出し側が DOMParser などで読んで渡す（スクリプトは動かさない）。
 *
 * link があるときは link だけを使う。呼び出し側は、link の JSON が取れない・読めないときに
 * 埋め込みへ切り替えてはならない（誤りとして扱う）。
 *
 * @param doc 読み込んだ HTML
 * @param pageUrl ページの URL。link の `href` の基準
 * @param options `allowHttp` で `http:` を許す
 * @throws {BinetteError} どちらも無いとき、link に `href` が無いとき、URL が許されないとき
 */
export function findAppList(doc: AppListDocument, pageUrl: string, options: AppIdOptions = {}): AppListLocation {
  for (const link of doc.querySelectorAll("link")) {
    const rel = (link.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
    if (!rel.includes("binette-apps")) continue;
    const href = link.getAttribute("href");
    if (href === null || href.trim() === "") invalid("提供リストの link に href がありません。");
    return { kind: "link", url: resolveHttp(href, pageUrl, options, "提供リストの JSON の URL") };
  }
  for (const script of doc.querySelectorAll("script")) {
    if (script.getAttribute("id") === "binette-apps" && (script.getAttribute("type") ?? "").trim().toLowerCase() === "application/json") {
      return { kind: "embedded", text: script.textContent ?? "" };
    }
  }
  return invalid("Binette の提供リストではありません。");
}

function resolveHttp(value: string, base: string, options: AppIdOptions, label: string): string {
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return invalid(`${label}として読めません: ${value}`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && options.allowHttp)) {
    invalid(`${label}は ${options.allowHttp ? "http: か https:" : "https:"} だけ使えます: ${value}`);
  }
  return url.href;
}

const INTEGRITY_VALUE = /^sha256-[A-Za-z0-9+/]{43}=$/;

function validateIntegrity(value: unknown, where: string): Record<string, string> {
  if (!isObject(value)) invalid(`${where} の integrity はオブジェクトで指定してください。`);
  const out: Record<string, string> = {};
  for (const [key, hash] of Object.entries(value)) {
    // 暗黙の判断: キーは source からの相対パス。"/" 以外の先頭 "/" と、空・"."・".." の区切りは誤りにする
    const segments = (key === "/" ? [] : key.replace(/\/$/, "").split("/"));
    if (key === "" || (key !== "/" && (key.startsWith("/") || segments.some((s) => s === "" || s === "." || s === "..")))) {
      invalid(`${where} の integrity のキーが正しくありません: ${key}`);
    }
    if (typeof hash !== "string" || !INTEGRITY_VALUE.test(hash)) {
      invalid(`${where} の integrity の値は sha256-<base64> で指定してください: ${key}`);
    }
    Object.defineProperty(out, key, { value: hash, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * 提供リストの JSON を読み、検査する。`source` は `jsonUrl` を基準に解決する
 * （埋め込みの JSON では、ページの URL を渡す）。`id` は識別子として正規化する。
 * `movedTo` があるときは、リストの URL として検査し、`apps` は読まない。
 *
 * @param text JSON の文字列
 * @param jsonUrl JSON の URL（埋め込みならページの URL）
 * @param options `allowHttp` で `http:` を許す
 * @throws {BinetteError} JSON として読めないとき、形式が正しくないとき
 */
export function parseAppList(text: string, jsonUrl: string, options: AppIdOptions = {}): AppList {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return invalid("提供リストを JSON として読めません。");
  }
  if (!isObject(value)) invalid("提供リストはオブジェクトで指定してください。");
  // 暗黙の判断: 引っ越し済みのリストでも name は必須（仕様の表どおり）
  if (typeof value.name !== "string" || value.name === "") invalid("提供リストの name を指定してください。");
  const name = value.name;
  if (Object.hasOwn(value, "movedTo")) {
    if (typeof value.movedTo !== "string") invalid("movedTo は提供リストの URL の文字列で指定してください。");
    // 暗黙の判断: movedTo は JSON の URL を基準に解決してから、リストの URL として検査する
    let resolved: string;
    try {
      resolved = new URL(value.movedTo, jsonUrl).href;
    } catch {
      return invalid(`movedTo を URL として読めません: ${value.movedTo}`);
    }
    return { name, apps: [], movedTo: normalizeAppListUrl(resolved, options) };
  }
  if (!Array.isArray(value.apps)) invalid("提供リストの apps は配列で指定してください。");
  const seen = new Set<string>();
  const apps = value.apps.map((entry: unknown, index): AppListEntry => {
    const where = `apps[${index}]`;
    if (!isObject(entry)) invalid(`${where} はオブジェクトで指定してください。`);
    if (typeof entry.id !== "string") invalid(`${where} の id を指定してください。`);
    const id = normalizeAppIdentifier(entry.id);
    // 暗黙の判断: 同じ識別子が 2 つあるリストは誤りにする
    if (seen.has(id)) invalid(`${where} の id が重複しています: ${id}`);
    seen.add(id);
    if (typeof entry.source !== "string" || entry.source === "") invalid(`${where} の source を指定してください。`);
    if (typeof entry.version !== "string" || entry.version === "") invalid(`${where} の version を指定してください。`);
    const result: AppListEntry = {
      id,
      source: resolveHttp(entry.source, jsonUrl, options, `${where} の source`),
      version: entry.version,
    };
    if (Object.hasOwn(entry, "integrity")) result.integrity = validateIntegrity(entry.integrity, where);
    for (const key of ["name", "description"] as const) {
      if (!Object.hasOwn(entry, key)) continue;
      if (typeof entry[key] !== "string") invalid(`${where} の ${key} は文字列で指定してください。`);
      result[key] = entry[key] as string;
    }
    if (Object.hasOwn(entry, "icon")) {
      if (typeof entry.icon !== "string" || entry.icon === "") invalid(`${where} の icon は URL の文字列で指定してください。`);
      result.icon = resolveHttp(entry.icon, jsonUrl, options, `${where} の icon`);
    }
    return result;
  });
  return { name, apps };
}
