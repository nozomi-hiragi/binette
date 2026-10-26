import * as v from "valibot";
import { BinetteError } from "./parse.ts";

const objectValue = (message: string) => v.custom<Record<string, unknown>>(
  (value) => typeof value === "object" && value !== null && !Array.isArray(value), message,
);
const nonempty = (message: string) => v.pipe(v.string(message), v.nonEmpty(message));
/** 必須の欄。欄が無いときも日本語のメッセージにするため、型の検査の前に確かめる */
const required = (key: string, message: string) => v.check((value: Record<string, unknown>) => Object.hasOwn(value, key), message);

/** `app.json` の入口の欄。`html` と `as` は必須 */
const entrySchema = v.pipe(
  objectValue("entry はオブジェクトで指定してください。"),
  required("html", "entry の html にはファイルのパスを指定してください。"),
  required("as", "entry の as にはファイルのパスを指定してください。"),
  v.looseObject({
    html: nonempty("entry の html にはファイルのパスを指定してください。"),
    css: v.optional(v.string("entry の css は文字列で指定してください。")),
    as: nonempty("entry の as にはファイルのパスを指定してください。"),
  }),
);

// ほかの欄は検査せず、そのまま残す
const appManifestSchema = v.pipe(
  objectValue("app.json はオブジェクトで指定してください。"),
  required("id", "id を指定してください。"),
  required("name", "name を指定してください。"),
  required("entry", "entry はオブジェクトで指定してください。"),
  v.looseObject({
    id: nonempty("id を指定してください。"),
    name: nonempty("name を指定してください。"),
    entry: entrySchema,
    icon: v.optional(v.string("icon は文字列で指定してください。")),
    role: v.optional(v.string("role は文字列で指定してください。")),
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
  html: string;
  /** 見た目の CSS */
  css?: string;
  /** 動きの AssemblyScript */
  as: string;
}

/** アプリの説明ファイル `app.json` の中身。`id`・`name`・`entry`・`icon`・`role` を検査する */
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
  /** システムアプリの役割。ホームは home */
  role?: string;
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

/**
 * `app.json` の中身を JSON として読み、検査する。正しければ {@link AppManifest} として返す。
 * 検査するのは `id`・`name`・`entry`・`icon`・`role` で、ほかの欄はそのまま残す。
 *
 * @param text `app.json` の中身の文字列
 * @throws {BinetteError} JSON として読めないときや、形式が正しくないとき
 */
export function parseAppManifest(text: string): AppManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BinetteError("invalid_format", "app.json を JSON として読めません。");
  }
  const result = v.safeParse(appManifestSchema, value, { abortEarly: true });
  if (!result.success) throw new BinetteError("invalid_format", result.issues[0].message);
  return result.output as AppManifest;
}
