import type { InferOutput } from "valibot";
import type { BinetteSettingsSection, binetteAssetSchema, binetteSchema } from "./schema.ts";

export type {
  BinetteSettingsComponentElement, BinetteSettingsElement, BinetteSettingsEntryElement, BinetteSettingsList,
  BinetteSettingsRow, BinetteSettingsSection, BinetteSettingsSectionBase,
} from "./schema.ts";

/** ビネットが使うファイル。`content`（文字列）か `src`（URL）のどちらか一方を持つ */
export type BinetteAsset =
  | { /** 種類（`html`・`js`・`css`・`svg` など） */ type: string; /** 中身の文字列 */ content: string; src?: undefined }
  | { /** 種類（`html`・`js`・`css`・`svg` など） */ type: string; /** 取得先の URL。`serverURL` を基準に解決する */ src: string; content?: undefined };

/** `.bina` の中身。画面を出す {@link BinettePage} か、転送する {@link BinetteRedirect} のどちらか */
export type Binette = BinettePage | BinetteRedirect;

/** ビネットに共通の欄 */
export interface BinetteBase {
  /** 形式のバージョン（今は `"0.1"`） */
  binette: string;
  /** 画面のタイトル */
  title?: string;
  /** 画面で使う asset。キーは拡張子の無い名前 */
  assets: Record<string, BinetteAsset>;
  /** 設定画面に差し込むセクション。入口 `/index.bina` だけが持てる */
  settings?: BinetteSettingsSection[];
}

/** 画面を出すビネット */
export interface BinettePage extends BinetteBase {
  /** 最初に再生する asset の名前。asset の `type` が `html` か `js` で再生のしかたが決まる */
  entry: string;
  redirect?: undefined;
}

/** 転送するビネット */
export interface BinetteRedirect extends BinetteBase {
  /** 転送先の Scene 内のパス */
  redirect: string;
  entry?: undefined;
}

// スキーマの出力が公開している型と合っているかを、型検査で確かめる
type Assert<T extends true> = T;
type _AssetCheck = Assert<InferOutput<typeof binetteAssetSchema> extends BinetteAsset ? true : false>;
type _BinetteCheck = Assert<InferOutput<typeof binetteSchema> extends Binette ? true : false>;
