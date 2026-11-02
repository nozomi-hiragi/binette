import * as v from "valibot";
import { BinetteError } from "./parse.ts";
import { normalizeAppIdentifier } from "./app-id.ts";

const objectValue = (message: string) => v.custom<Record<string, unknown>>(
  (value) => typeof value === "object" && value !== null && !Array.isArray(value), message,
);
const nonempty = (message: string) => v.pipe(v.string(message), v.nonEmpty(message));
/** 必須の欄。欄が無いときも日本語のメッセージにするため、型の検査の前に確かめる */
const required = (key: string, message: string) => v.check((value: Record<string, unknown>) => Object.hasOwn(value, key), message);

/** `app.json` の入口の欄。`as` は必須 */
const entrySchema = v.pipe(
  objectValue("entry はオブジェクトで指定してください。"),
  required("as", "entry の as にはファイルのパスを指定してください。"),
  v.looseObject({
    html: v.optional(nonempty("entry の html にはファイルのパスを指定してください。")),
    css: v.optional(v.string("entry の css は文字列で指定してください。")),
    as: nonempty("entry の as にはファイルのパスを指定してください。"),
  }),
);

/** サブアプリ 1 つ分の欄 */
const subEntrySchema = v.looseObject({
  name: nonempty("sub の name を指定してください。"),
  icon: v.optional(v.string("sub の icon は文字列で指定してください。")),
  roles: v.optional(v.array(v.string("sub の roles は文字列の配列で指定してください。"), "sub の roles は文字列の配列で指定してください。")),
  listed: v.optional(v.boolean("sub の listed は真偽値で指定してください。")),
});
// record は特殊な名前（__proto__ など）を除外するため、キーを 1 つずつ検査してから辞書へ戻す
const subSchema = v.pipe(
  objectValue("sub はオブジェクトで指定してください。"),
  v.transform(Object.entries),
  v.array(v.tuple([
    v.pipe(v.string(), v.check((key) => { try { normalizeAppIdentifier(key); return true; } catch { return false; } }, (issue) => `sub の識別子が正しくありません: ${String(issue.input)}`)),
    subEntrySchema,
  ])),
  v.check((entries) => new Set(entries.map(([key]) => normalizeAppIdentifier(key))).size === entries.length, "sub の識別子が重複しています。"),
  v.transform((entries) => Object.fromEntries(entries.map(([key, value]) => [normalizeAppIdentifier(key), value]))),
);

// ほかの欄は検査せず、そのまま残す
const appManifestSchema = v.pipe(
  objectValue("app.json はオブジェクトで指定してください。"),
  required("id", "id を指定してください。"),
  required("name", "name を指定してください。"),
  required("entry", "entry はオブジェクトで指定してください。"),
  // 旧名の role は読み替えず、書き直してもらう
  v.check((value) => !Object.hasOwn(value, "role"), "role は roles（文字列の配列）に変わりました。"),
  v.looseObject({
    id: nonempty("id を指定してください。"),
    name: nonempty("name を指定してください。"),
    entry: entrySchema,
    icon: v.optional(v.string("icon は文字列で指定してください。")),
    roles: v.optional(v.array(v.string("roles は文字列の配列で指定してください。"), "roles は文字列の配列で指定してください。")),
    sub: v.optional(subSchema),
  }),
);

/** アプリの権限 1 つ分。用途の説明をインストール画面に出す */
export interface AppPermission {
  /** 用途の説明 */
  reason: string;
}

/** `app.json` の入口。ファイルのパスは `app.json` からの相対 */
export interface AppEntry {
  /** 見た目の HTML */
  html?: string;
  /** 見た目の CSS */
  css?: string;
  /** 動きの AssemblyScript */
  as: string;
}

/** サブアプリ 1 つ分。ID は親の識別子 ＋ `.` ＋ サブアプリの識別子。保存領域と権限は親と共有する */
export interface AppSubManifest {
  /** 表示名 */
  name: string;
  /** アイコンのパス（`app.json` の場所から） */
  icon?: string;
  /** 名乗る役割 */
  roles?: string[];
  /** ホームの一覧に出すか。既定は `true` */
  listed?: boolean;
}

/** アプリの説明ファイル `app.json` の中身。`id`・`name`・`entry`・`icon`・`roles`・`sub` を検査する */
export interface AppManifest {
  /** アプリの ID。Régie は「入手元 ＋ ID」で区別する */
  id: string;
  /** アプリの版（semver） */
  version?: string;
  /** 使う Binette（Réplique の呼び出し）の版 */
  binette?: string;
  /** 表示名 */
  name: string;
  /** 説明 */
  description?: string;
  /** アイコン（SVG のパス） */
  icon?: string;
  /** 名乗る役割。ホームは home、設定は settings。名乗っただけでは API は届かず、割り当てられたアプリにだけ届く */
  roles?: string[];
  /** サブアプリ。キーは識別子（`.` を含まない。% エンコードして正規化済み）。深さは 1 段だけ */
  sub?: Record<string, AppSubManifest>;
  /** 入口の HTML・CSS・AS */
  entry: AppEntry;
  /** 使う権限と、その用途の説明 */
  permissions?: Record<string, AppPermission>;
  /** サーバーサイドを使うか */
  server?: { required?: boolean };
  /** ビルドに使うコンパイラの版 */
  build?: { compiler?: string };
  /** 検査しないほかの欄 */
  [key: string]: unknown;
}

/** {@link parseAppManifest} の設定 */
export interface ParseAppManifestOptions {
  /** `id` を識別子の規則で検査する（`.` を含むと誤り）。既定は true */
  strictId?: boolean;
}

/**
 * `app.json` の中身を JSON として読み、検査する。正しければ {@link AppManifest} として返す。
 * 検査するのは `id`・`name`・`entry`・`icon`・`roles`・`sub` で、ほかの欄はそのまま残す。
 *
 * @param text `app.json` の中身の文字列
 * @param options `id` は既定で識別子の規則（`.` を含まないなど）で検査する。
 *   `strictId: false` は旧形式の説明ファイルを読む道具向け。
 * @throws {BinetteError} JSON として読めないときや、形式が正しくないとき
 */
export function parseAppManifest(text: string, options: ParseAppManifestOptions = {}): AppManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BinetteError("invalid_format", "app.json を JSON として読めません。");
  }
  const result = v.safeParse(appManifestSchema, value, { abortEarly: true });
  if (!result.success) throw new BinetteError("invalid_format", result.issues[0].message);
  const manifest = result.output as AppManifest;
  if (options.strictId !== false) {
    try {
      normalizeAppIdentifier(manifest.id);
    } catch (error) {
      throw new BinetteError("invalid_format", `id が識別子として正しくありません。${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return manifest;
}
