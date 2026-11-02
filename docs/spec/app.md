# アプリのパッケージと app.json

[仕様の目次](README.md)

## アプリのパッケージ（案）

アプリは、リポジトリなどに置いたファイルの一式です。

```
app.json          説明ファイル（ID・版・権限・入口）
icon.svg
src/
  index.html      見た目。スクリプトは書かない
  style.css       見た目。フロントのテーマの CSS 変数を使える
  main.ts         動き。AS で書き、WASM にビルドする
```

- ファイルのパスは、すべて `app.json` を置いた場所からの相対パスで書く（実装済み。Régie の `buildApp` は `read("app.json")` のあと、`entry` のパスを整えて `read` に渡す。フォルダの外を指すパスは誤り）
- AS のファイルどうしの相対 import（`import { x } from "./util"`）が使える。`app.json` のフォルダの外は読まない（実装済み。[regie/build.md](regie/build.md#ファイルの解決)）

例: [apps/settings](../../apps/settings)

```
apps/settings/
  app.json
  icon.svg
  src/index.html
  src/main.ts
```

## app.json

説明ファイルの名前は `app.json` です（決定）。中身は JSON のオブジェクトです。

```json
{
  "id": "io.github.nozomi-hiragi.memo",
  "version": "0.1.0",
  "binette": "0.2",
  "name": "メモ",
  "description": "端末に保存できるメモ帳",
  "icon": "icon.svg",
  "entry": {
    "html": "src/index.html",
    "css": "src/style.css",
    "as": "src/main.ts"
  },
  "permissions": {
    "storage": { "reason": "メモを端末に保存するため" },
    "server": { "reason": "メモをサーバーに送るため" }
  },
  "server": { "required": false },
  "build": { "compiler": "assemblyscript@0.28.0" }
}
```

### 欄（案）

| 欄 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `id` | 文字列 | 必須 | アプリの ID。誰でも名乗れるので、Régie は「入手元 ＋ ID」で区別する。提供リストの URL ＋ `#` ＋ 識別子にする形とサブアプリの `sub` は [app-id.md](app-id.md)（決定 2026-11-02、未実装） |
| `version` | 文字列 | 任意 | アプリの版（semver）。表示と、更新の比較の両方に使う |
| `binette` | 文字列 | 任意 | 使う Binette（Réplique の呼び出し）の版。Android の `minSdk` にあたる |
| `name` | 文字列 | 必須 | 表示名 |
| `description` | 文字列 | 任意 | 説明 |
| `icon` | 文字列 | 任意 | アイコンのパス。SVG 1 枚 |
| `roles` | 文字列の配列 | 任意 | 名乗る役割（実装済み、名前は案）。`"home"` はホームの候補、`"settings"` は設定アプリ（入手元が `binette:system` のものだけ割り当てられる）。名乗っただけでは API は届かず、設定とブートの既定で割り当てられたアプリにだけ、その役割の API が届く（[roles.md](roles.md)）。旧名の `role`（文字列 1 つ）は読み替えずにエラーにする（案） |
| `entry` | オブジェクト | 必須 | 入口の HTML・CSS・AS（下の表） |
| `permissions` | オブジェクト | 任意 | 使う権限の名前 → `{ "reason": 用途の説明 }`。説明はインストール画面に出す |
| `server` | オブジェクト | 任意 | `{ "required": 真偽値 }`。サーバーサイドを使うか。`required: false` なら、サーバーが無くても動く |
| `build` | オブジェクト | 任意 | `{ "compiler": "assemblyscript@版" }`。ビルドに使うコンパイラの版。同じ入手元からは同じ結果になるようにする |

`entry.html` を省いた宣言的 UI は [宣言的 UI](ui.md) を参照してください（案）。

`entry` の欄:

| 欄 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `html` | 文字列 | 任意 | HTML 方式の見た目のパス。省略すると宣言的 UI（案） |
| `css` | 文字列 | 任意 | 見た目の CSS のパス |
| `as` | 文字列 | 必須 | 動きの AS のパス |

- どの欄を必須にするか、`version`・`binette` を必須にするかは未決。今のコードは上の表の「必須」と、任意の `icon`・`roles`・`entry.css` の型を確かめる
- `.bina`（v0.1 の画面の定義）との関係は未決
- 依存ライブラリの固定（lock）の形は未決

### 読み込みと検査（実装済み）

`@binette/core` の `parseAppManifest(text)` が読みます（[core.md](core.md#parseappmanifest)）。検査するのは `id`・`name`・`entry` と、任意の `icon`・`roles` の型で、ほかの欄は型も中身も確かめずに、そのまま結果に残します。表にない欄も残します。

検査は次の順に行い、最初に見つかった誤りで止めます。誤りは `BinetteError`（`code` は `"invalid_format"`）で、`message` は次のとおりです。

| 順 | 条件 | メッセージ |
| --- | --- | --- |
| 1 | JSON として読めない | `app.json を JSON として読めません。` |
| 2 | オブジェクトでない（配列・`null`・文字列など） | `app.json はオブジェクトで指定してください。` |
| 3 | `id` が無い | `id を指定してください。` |
| 4 | `name` が無い | `name を指定してください。` |
| 5 | `entry` が無い | `entry はオブジェクトで指定してください。` |
| 6 | `id` が文字列でないか、空文字列 | `id を指定してください。` |
| 7 | `name` が文字列でないか、空文字列 | `name を指定してください。` |
| 8 | `entry` がオブジェクトでない | `entry はオブジェクトで指定してください。` |
| 9 | `entry.as` が無い | `entry の as にはファイルのパスを指定してください。` |
| 10 | `entry.html` があって文字列でないか、空文字列 | `entry の html にはファイルのパスを指定してください。` |
| 11 | `entry.css` があって、文字列でない | `entry の css は文字列で指定してください。` |
| 12 | `entry.as` が文字列でないか、空文字列 | `entry の as にはファイルのパスを指定してください。` |
| 13 | `icon` があって、文字列でない | `icon は文字列で指定してください。` |
| 14 | `roles` があって、文字列の配列でない（要素が文字列でない場合を含む） | `roles は文字列の配列で指定してください。` |
| 15 | 旧名の `role` がある | `role は roles（文字列の配列）に変わりました。` |

- 「無い」は、そのオブジェクト自身がその欄を持たないこと（`Object.hasOwn` が偽）。値が `null` や `undefined` の欄は「ある」とみなし、型の検査（6〜14）で誤りになる。15 は欄が「ある」だけで誤りにする
- パスの形（`..` を含む、絶対 URL など）はまだ確かめない
- `entry.css` を指定すると、ビルド時に相対パスから読み、ビルド済みアプリと保存データにも含める。Scene は表示先ごとに `@scope` で適用し、Cadre の子アプリの表示領域にはセレクタを適用しない。CSS の継承は通常どおり行われる
- CSS は外部の読み込みや大域への影響を避けるため保守的に検査する。`@import`・`@font-face`・`@property`・`@keyframes`・`@layer`・`image-set()`、文字列外のバックスラッシュなどを含む CSS は全体を適用せずエラーを通知する。`url()` は data URL のみ使える

## Régie が記録するもの（案）

作者が書く `app.json` とは別に、Régie はインストールのときに次を記録します。

- 入手元の URL と、固定したコミット（タグは動かせるので SHA で固定する）
- ソースとビルド結果のハッシュ
- ユーザーが許可した権限
- 使用量、インストール日時

今は `AppStore` に入手元・manifest・SVG・HTML・CSS・WASM・インストール日時を保存します（[regie/store.md](regie/store.md#appstore実装済み)）。コミット・ハッシュ・許可した権限・使用量は記録しません。

## システムアプリ（実装済み）

システムアプリ（OS の機能を持つアプリ）と通常の同梱アプリは、インストールの手順を通らず、OS と一緒にビルドして配ります。扱いは [apps/](apps/README.md) にあります。ホーム（`roles: ["home"]`）は [apps/home.md](apps/home.md) です。

## インストール（案）

システムアプリと同梱アプリは、Binette をビルドするときに前もってビルドし、`.binapp` として OS（Binette とフロント）と一緒に配ります。ブラウザではコンパイラを読まず、HTML や権限の検証はしません。`.binapp` の形式と manifest の型を確かめ、保存して開きます（[regie/build.md](regie/build.md#書き出し実装済み)）。開発用の `{ source, read }` ではブラウザでビルドする道も残します。

追加するアプリのインストールは、次の流れを予定しています。

1. 入手元から `app.json` とソースを GET する
2. Régie が AS を WASM にビルドする。Réplique は、`app.json` の `binette` の版に合うものを Régie が差し込む（アプリが自分で持ち込まない）
3. 検証する
   - WASM が import している呼び出しを一覧にし、`permissions` と照合する。宣言にない権限を使っていたら止める
   - HTML に `<script>`・`on*` 属性・外部 URL が無いことを確かめる
4. 権限と用途を見せて、ユーザーが許可する
5. Régie がビルド結果と記録を保存する

- 更新は同じ入手元からだけ受け付ける。権限が増えていたら、もう一度許可を求める
- 今のシステム（[regie/system.md](regie/system.md#インストール)。今のコードでは `mountShell`）は、最初から渡されたアプリを読む。prebuilt は毎回その内容で `AppStore` に保存し直す（入れた日時は保つ）。開発用の read は、同じ入手元・ID・版が保存済みなら使い回し、無ければビルドして保存する。2 の Réplique は `binette` の版を見ずに、呼ぶ側が渡したソースを使う
- 3 の HTML や権限の検証、4 の許可の画面はまだ無い。5 はビルド結果の保存だけ
- アプリの追加方法は未決。URL からの追加、更新、削除、並べ替えはまだ無い

## ホームのアイコン（実装済み）

`icon` があれば、`entry` と同じくパスを整えて（`app.json` のフォルダの外は読まない。[regie/system.md](regie/system.md#インストール)）SVG の文字列を読み、ビルド結果と一緒に保存します。ホームは `data:image/svg+xml;charset=utf-8,` に `encodeURIComponent` した SVG を続け、`img.src` に入れます。SVG を `innerHTML` に入れません。名前は `textContent` に入れます。アイコンが無くても名前から開けます。


画面は通常の id を document.getElementById で参照し、アプリ自身が変更とクリックを扱います（決定 2026-10-27）。bina 属性の解釈と bina.ts の生成は無くしました。API は [Réplique](replique.md)、まだしていない最初の HTML 検査・setAttribute・style・value・input / click 以外のイベントは [mount.md](scene/mount.md) を見てください。

起動は AS のトップレベルで `App` の派生クラスを `launch` に一回渡します。OS は `_start` → HTML → onCreate(Last, Api) → onStart(Create) → onResume の順に進めます。最初の画面は onCreate で作り、従来の `export function start()` は呼びません。this.page でページの識別子を読み、this.finish() で自分を閉じられます（[lifecycle.md](lifecycle.md)、[replique.md](replique.md)）。
