# @binette/core

[仕様の目次](README.md)

形式の定義です。どの層も共有します。依存は `valibot@1.5.0`（npm）だけです。

## 公開するもの（実装済み）

| 名前 | 種類 | 内容 |
| --- | --- | --- |
| `AppManifest`・`AppEntry`・`AppPermission` | 型 | `app.json` の中身 |
| `parseAppManifest` | 関数 | `app.json` を読んで検査する |
| `BinetteError` | クラス | 形式の誤り |
| `Binette` ほか（下の「v0.1 の `.bina`」） | 型 | v0.1 の `.bina` の中身 |
| `parseBinette` | 関数 | v0.1 の `.bina` を読んで検査する |
| `BINETTE_VERSION` | 定数 | v0.1 の `.bina` の形式の版。`"0.1"` |

## app.json の型

```ts
/** アプリの権限 1 つ分。用途の説明をインストール画面に出す */
interface AppPermission {
  reason: string;
}

/** `app.json` の入口。ファイルのパスは `app.json` からの相対 */
interface AppEntry {
  html: string;
  css?: string;
  as: string;
}

/** アプリの説明ファイル `app.json` の中身。`id`・`name`・`entry` と任意の `icon` の型を検査する */
interface AppManifest {
  id: string;
  version?: string;
  binette?: string;
  name: string;
  description?: string;
  icon?: string;
  entry: AppEntry;
  permissions?: Record<string, AppPermission>;
  server?: { required?: boolean };
  build?: { compiler?: string };
  /** 検査しないほかの欄 */
  [key: string]: unknown;
}
```

- 欄の意味は [app.md](app.md#appjson) にあります
- 型が付いていても、検査するのは `id`・`name`・`entry` と任意の `icon` の型です。たとえば `version` に数値が入っていても、`parseAppManifest` は誤りにしません。型はあくまで「正しく書かれていればこうなる」という目安です

## parseAppManifest

```ts
function parseAppManifest(text: string): AppManifest
```

- `text` は `app.json` の中身の文字列です
- `JSON.parse` で読み、valibot のスキーマで検査します。正しければ、読んだオブジェクトを返します。検査しない欄も含めて、中身は変えません
- 誤りは `BinetteError` を投げます。検査の順とメッセージは [app.md の「読み込みと検査」](app.md#読み込みと検査実装済み) にあります

## BinetteError

```ts
class BinetteError extends Error {
  readonly code: "invalid_format";
  constructor(code: "invalid_format", message: string);
  // name は "BinetteError"
}
```

- 形式の誤りはすべて `code: "invalid_format"` です。`message` は日本語で、利用者に見せてよい文です
- `app.json` と `.bina` の両方で使います

## v0.1 の `.bina`（v0.1 のまま残しているもの）

Coulisses（[coulisses.md](coulisses.md)）が `.bina` を読むので、core の `.bina` の型と読み込みは v0.1 のまま残しています。v0.2 の Scene は `.bina` を使いません。残すか消すかは未決です。

詳しい決まりはタグ `v0.1.0` の `docs/spec.md` にあります。ここには、今のコードが検査する内容だけを書きます。

### 型

```ts
type BinetteAsset =
  | { type: string; content: string; src?: undefined }
  | { type: string; src: string; content?: undefined };

interface BinetteBase {
  binette: string;           // "0.1"
  title?: string;
  assets: Record<string, BinetteAsset>; // 省略すると空のオブジェクト
  settings?: BinetteSettingsSection[];
}
interface BinettePage extends BinetteBase { entry: string; redirect?: undefined }
interface BinetteRedirect extends BinetteBase { redirect: string; entry?: undefined }
type Binette = BinettePage | BinetteRedirect;
```

`settings` の型（`BinetteSettingsSection`・`BinetteSettingsList`・`BinetteSettingsElement`・`BinetteSettingsEntryElement`・`BinetteSettingsComponentElement`・`BinetteSettingsRow`・`BinetteSettingsSectionBase`）は v0.1 の設定画面のためのもので、`packages/core/src/schema.ts` にあります。

### parseBinette

```ts
function parseBinette(text: string): Binette
```

- JSON として読めないときは `Binette を JSON として読めません。`
- `binette` が `BINETTE_VERSION`（`"0.1"`）と一致しないときは `対応していない Binette のバージョンです: <値>`
- `entry` と `redirect` はどちらか一方だけ。両方か、どちらも無いときは `entry と redirect のどちらか一方を指定してください。`
- `redirect` は `/` で始まり、`//` で始まらず、`\` と空白・制御文字（U+0000〜U+0020）を含まないパス。違えば `redirect は Scene 内のパスで指定してください。`
- `assets` のキーは空でなく、`.`・`/`・`\` を含まない。asset は `type`（空でない文字列）と、`content`（文字列）か `src`（空でない文字列）のどちらか一方を持つ
- `entry` は `assets` にあり、その `type` が `html` か `js`
- `settings` の `element` セクションの `entry` は、`assets` の `js` を指す
- 誤りはすべて `BinetteError` で、最初に見つかった誤りで止まる
