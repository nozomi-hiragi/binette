import type { InferOutput } from "valibot";
import type { BinetteSettingsRow, BinetteSettingsSection, binetteAssetSchema, binetteSchema } from "./schema.ts";

export type { BinetteSettingsRow, BinetteSettingsSection };

/** ビネットが使うファイル。`content`（文字列）か `src`（URL）のどちらか一方を持つ */
export type BinetteAsset =
  | { /** 種類（`html`・`js`・`css`・`svg` など） */ type: string; /** 中身の文字列 */ content: string; src?: undefined }
  | { /** 種類（`html`・`js`・`css`・`svg` など） */ type: string; /** 取得先の URL。`serverURL` を基準に解決する */ src: string; content?: undefined };

/** `.bina` の中身。`entry` と `redirect` のどちらか一方を持つ */
export interface Binette {
  /** 形式のバージョン（今は `"0.1"`） */
  binette: string;
  /** 画面のタイトル */
  title?: string;
  /** 最初に再生する asset の名前。asset の `type` が `html` か `js` で再生のしかたが決まる */
  entry?: string;
  /** 転送先の Scene 内のパス */
  redirect?: string;
  /** 画面で使う asset。キーは拡張子の無い名前 */
  assets: Record<string, BinetteAsset>;
  /** 設定画面に差し込むセクション。入口 `/index.bina` だけが持てる */
  settings?: BinetteSettingsSection[];
}

// スキーマの出力が公開している型と合っているかを、型検査で確かめる
type Assert<T extends true> = T;
type _AssetCheck = Assert<InferOutput<typeof binetteAssetSchema> extends BinetteAsset ? true : false>;
type _BinetteCheck = Assert<InferOutput<typeof binetteSchema> extends Binette ? true : false>;
