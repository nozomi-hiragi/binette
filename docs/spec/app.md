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
  bina.ts         HTML の名前から自動生成する（案。補完のためにコミットする）
```

- ファイルのパスは、すべて `app.json` を置いた場所からの相対パスで書く（実装済み。Scene の `buildApp` は `read("app.json")` のあと、`entry` のパスを整えて `read` に渡す。フォルダの外を指すパスは誤り）
- AS のファイルどうしの相対 import（`import { x } from "./util"`）が使える。`app.json` のフォルダの外は読まない（実装済み。[scene.md](scene.md#ファイルの解決)）

例: [examples/counter](../../examples/counter)

```
examples/counter/
  app.json
  src/index.html
  src/main.ts
  src/bina.ts
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
| `id` | 文字列 | 必須 | アプリの ID。誰でも名乗れるので、Régie は「入手元 ＋ ID」で区別する |
| `version` | 文字列 | 任意 | アプリの版（semver）。表示と、更新の比較の両方に使う |
| `binette` | 文字列 | 任意 | 使う Binette（Réplique の呼び出し）の版。Android の `minSdk` にあたる |
| `name` | 文字列 | 必須 | 表示名 |
| `description` | 文字列 | 任意 | 説明 |
| `icon` | 文字列 | 任意 | アイコンのパス。SVG 1 枚 |
| `entry` | オブジェクト | 必須 | 入口の HTML・CSS・AS（下の表） |
| `permissions` | オブジェクト | 任意 | 使う権限の名前 → `{ "reason": 用途の説明 }`。説明はインストール画面に出す |
| `server` | オブジェクト | 任意 | `{ "required": 真偽値 }`。サーバーサイドを使うか。`required: false` なら、サーバーが無くても動く |
| `build` | オブジェクト | 任意 | `{ "compiler": "assemblyscript@版" }`。ビルドに使うコンパイラの版。同じ入手元からは同じ結果になるようにする |

`entry` の欄:

| 欄 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `html` | 文字列 | 必須 | 見た目の HTML のパス |
| `css` | 文字列 | 任意 | 見た目の CSS のパス |
| `as` | 文字列 | 必須 | 動きの AS のパス |

- どの欄を必須にするか、`version`・`binette` を必須にするかは未決。今のコードは上の表の「必須」だけを確かめる
- `.bina`（v0.1 の画面の定義）との関係は未決
- 依存ライブラリの固定（lock）の形は未決

### 読み込みと検査（実装済み）

`@binette/core` の `parseAppManifest(text)` が読みます（[core.md](core.md#parseappmanifest)）。検査するのは `id`・`name`・`entry` だけで、ほかの欄は型も中身も確かめずに、そのまま結果に残します。表にない欄も残します。

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
| 9 | `entry.html` が無い | `entry の html にはファイルのパスを指定してください。` |
| 10 | `entry.as` が無い | `entry の as にはファイルのパスを指定してください。` |
| 11 | `entry.html` が文字列でないか、空文字列 | `entry の html にはファイルのパスを指定してください。` |
| 12 | `entry.css` があって、文字列でない | `entry の css は文字列で指定してください。` |
| 13 | `entry.as` が文字列でないか、空文字列 | `entry の as にはファイルのパスを指定してください。` |

- 「無い」は、そのオブジェクト自身がその欄を持たないこと（`Object.hasOwn` が偽）。値が `null` や `undefined` の欄は「ある」とみなし、型の検査（6〜13）で誤りになる
- パスの形（`..` を含む、絶対 URL など）はまだ確かめない
- `entry.css` は検査するが、今の Scene は読まない

## Régie が記録するもの（案）

作者が書く `app.json` とは別に、Régie はインストールのときに次を記録します。

- 入手元の URL と、固定したコミット（タグは動かせるので SHA で固定する）
- ソースとビルド結果のハッシュ
- ユーザーが許可した権限
- 使用量、インストール日時

今のコードはインストールをしないので、何も記録しません。

## インストール（案）

1. 入手元から `app.json` とソースを GET する
2. Scene が AS を WASM にビルドする。Réplique は、`app.json` の `binette` の版に合うものを Scene が差し込む（アプリが自分で持ち込まない）
3. 検証する
   - WASM が import している呼び出しを一覧にし、`permissions` と照合する。宣言にない権限を使っていたら止める
   - HTML に `<script>`・`on*` 属性・外部 URL が無いことを確かめる
   - HTML の `bina-on-*` に書いた名前が、WASM の export にあることを確かめる
4. 権限と用途を見せて、ユーザーが許可する
5. Régie がビルド結果と記録を保存する

- 更新は同じ入手元からだけ受け付ける。権限が増えていたら、もう一度許可を求める
- 今のコードでできるのは 1 と 2 だけ。2 の Réplique は `binette` の版を見ずに、呼ぶ側が渡したソースを使う。3〜5 は無い
