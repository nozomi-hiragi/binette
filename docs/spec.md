# Binette 仕様（v0.2 下書き）

Binette（ビネット）は、ブラウザだけで動く、スマホの OS のようなアプリの土台です。アプリを GitHub などから取ってきて、ブラウザの中でビルドし、検証してからインストールして動かします。サーバーの処理やデータが要るアプリは、自分のサーバーサイドとだけ通信します。

> [!WARNING]
> 書き始めたばかりの下書きです。各節の見出しに **決定** と付いたものはのぞみが決めたこと、**案** と付いたものは提案で、まだ決まっていません。v0.1（画面の定義 `.bina` を同じページで再生する形）からは大きく変わります。v0.1 の仕様はタグ `v0.1.0` を見てください。

## 方針（決定）

- スマホの OS のようなもの。ブラウザのアプリ（フロント）だけで動く
- アプリはブラウザの中でビルドし、単体でインストールできる。クライアントでビルドするのは、そこでコードを検証できるから
- アプリの入手元は GET で取れればどこでもよい。基本は GitHub
- サーバーの処理やデータが要るアプリは、WAKE などで通信する。通信はアプリごとに分け、アプリは自分のサーバーサイドとしか通信できない
- アプリは HTML ＋ AssemblyScript（AS）で書く方向で試す。TSX のような書き方（ASX）は後で考える
- データのバックアップはサーバー側（Coulisses）に任せる

## 呼び名と層（決定）

| 名前 | 役割 | パッケージ |
| --- | --- | --- |
| Binette | 形式の定義。どの層も共有する | `@binette/core` |
| Régie（レジ、操作室） | カーネル。アプリの実行、権限、ストレージなど、土台の仕事をする | `@binette/regie` |
| Scene（シーン、舞台） | アプリの解釈層。アプリを読み、画面にする | `@binette/scene` |
| Coulisses（クーリス、舞台裏） | サーバー側。処理の逃がし先とバックアップ | `@binette/coulisses` |
| Réplique（レプリク、セリフ） | アプリが Régie を呼ぶためのライブラリ（AS） | `@binette/replique` |

- カーネル（Régie）は形式の定義（core）とは別のパッケージにする

### EbinaStation での呼び名（決定）

| Binette | EbinaStation |
| --- | --- |
| フロントの実装（Régie と Scene を載せ、ホームや設定の見た目を持つ） | ebina-front |
| Coulisses を WAKE と合わせて実装したもの | ebina-station（Station） |

## 層の分担（案）

| 層 | 担当 |
| --- | --- |
| core | アプリの説明ファイル（`app.json`）や形式の型と読み込み、検査 |
| Régie | アプリの実行（Worker ＋ WASM）、権限の判断、アプリごとのストレージ、インストール済みアプリの記録、アプリからの呼び出しの受け口、データの書き出し。画面は持たない |
| Scene | アプリのパッケージを読む、AS のビルドと検証、HTML を描いてアプリとつなぐ |
| Coulisses | アプリのサーバーサイド処理、バックアップの受け取り |
| フロントの実装 | ホーム、設定、ダイアログ、インストール確認などの見た目。Régie と Coulisses の間の通信路を差し込む |

- 依存の向き: `core` ← `regie` ← `scene`（フロント側）、`core` ← `coulisses`（サーバー側）。`replique` は AS 用で、Régie とは「呼び出しの一覧」という約束だけを共有する
- Binette は WAKE に依存しない。Régie と Coulisses の間の通信路はフロントの実装が渡す。EbinaStation ではそこに WAKE が入る
- ビルドと検証は Scene が行い、何を許すかの最終判断は Régie が持つ

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

### app.json

説明ファイルの名前は `app.json` です（決定）。

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

| 欄 | 説明 |
| --- | --- |
| `id` | アプリの ID。誰でも名乗れるので、Régie は「入手元 ＋ ID」で区別する |
| `version` | アプリの版（semver）。表示と、更新の比較の両方に使う |
| `binette` | 使う Binette（Réplique の呼び出し）の版。Android の `minSdk` にあたる |
| `name` / `description` / `icon` | 表示用。アイコンは SVG 1 枚 |
| `entry` | 入口の HTML・CSS・AS |
| `permissions` | 使う権限と、その用途の説明。説明はインストール画面に出す |
| `server` | サーバーサイドを使うか。`required: false` なら、サーバーが無くても動く |
| `build` | ビルドに使うコンパイラの版。同じ入手元からは同じ結果になるようにする |

- `.bina`（v0.1 の画面の定義）との関係は未決
- 依存ライブラリの固定（lock）の形は未決

### Régie が記録するもの

作者が書く `app.json` とは別に、Régie はインストールのときに次を記録します。

- 入手元の URL と、固定したコミット（タグは動かせるので SHA で固定する）
- ソースとビルド結果のハッシュ
- ユーザーが許可した権限
- 使用量、インストール日時

## インストール（案）

1. 入手元から `app.json` とソースを GET する
2. Scene が AS を WASM にビルドする。Réplique は、`app.json` の `binette` の版に合うものを Scene が差し込む（アプリが自分で持ち込まない）
3. 検証する
   - WASM が import している呼び出しを一覧にし、`permissions` と照合する。宣言にない権限を使っていたら止める
   - HTML に `<script>`・`on*` 属性・外部 URL が無いことを確かめる
   - HTML の `data-on-*` に書いた名前が、WASM の export にあることを確かめる
4. 権限と用途を見せて、ユーザーが許可する
5. Régie がビルド結果と記録を保存する

- 更新は同じ入手元からだけ受け付ける。権限が増えていたら、もう一度許可を求める

## 実行（案）

- アプリの WASM は Worker の中で動かす。重い処理で画面が固まらず、いつでも止められる
- アプリは Régie が渡した呼び出ししか使えない。ネットワークや DOM に直接は触れない
- HTML は Scene がフロントの画面の中に描く。アプリの領域は `contain: paint` などで枠の外に出られないようにする
- 起動すると Scene がアプリの `start()` を呼ぶ

### HTML とアプリのつなぎ方

| HTML | 意味 | アプリ側（Réplique） |
| --- | --- | --- |
| `data-text="name"` | 文字を差し込む | `ui.text("name", "…")` |
| `data-show="name"` | 表示・非表示 | `ui.show("name", true)` |
| `data-enabled="name"` | 有効・無効 | `ui.enabled("name", false)` |
| `data-value="name"` | 入力欄の値 | `ui.value("name", "")` |
| `data-each="list"` ＋ `<template>` | 一覧の繰り返し | `ui.listClear` / `ui.listAdd` / `ui.itemText` |
| `data-on-click="fn"` | クリックで `fn()` | `export function fn(): void` |
| `data-on-input="fn"` | 入力で `fn(値)` | `export function fn(value: string): void` |
| `data-on-submit="fn"` | 送信で `fn()`（ページ移動はしない） | `export function fn(): void` |

- 一覧の中のイベントは、その行のキーを引数で渡す

## Réplique（案）

アプリが import する AS のライブラリです。中身は Régie への呼び出し（WASM の import）です。

```ts
import { ui, storage, server } from "jsr:@binette/replique";
export * from "jsr:@binette/replique/glue";

export function start(): void {
  storage.get("memos", onLoaded);
}

function onLoaded(value: string | null): void {
  ui.text("status", value === null ? "まだありません" : value);
}
```

- AS には async が無いので、結果は「終わったら呼ぶ関数」を渡して受け取る。渡せるのはトップレベルの関数だけ
- Régie は結果を返すとき、`glue` の export を要求番号付きで呼ぶ。そのためアプリの入口で `glue` を export する
- `jsr:` の import は、Scene のビルダーが JSR から取って解決する。npm や Node は使わない

### 呼び出しの一覧（最初の案）

| 名前空間 | 権限 | 内容 |
| --- | --- | --- |
| `ui` | なし | 画面の書き換え（上の表） |
| `storage` | `storage` | アプリごとのキーと値の保存 |
| `server` | `server` | 自分のサーバーサイド（Coulisses）への要求。`available()` でつながっているかを見る |

## Régie（案）

- アプリごとのストレージ。ほかのアプリからは読めない。容量の上限を持つ
- 権限の判断。フロントの設定画面から、アプリごとに権限を取り消せる
- アプリのデータは、アプリごとにまとめて書き出せる形で持つ。バックアップのときは、それを Coulisses に送る
- 動いているアプリの数に上限を持ち、裏に回ったアプリは止められる。状態はストレージから戻す前提にする

## Coulisses（案）

- アプリごとに分けた入口を持つ。アプリの要求は、そのアプリのサーバーサイドにだけ届く
- アプリのサーバーサイドのコードをどこに置き、どう動かすかは未決
- バックアップを受け取り、戻せるようにする

## v0.1 から変わること（案）

| v0.1 | v0.2 |
| --- | --- |
| サーバーが配る `.bina` を Scene が再生する | アプリをインストールして、Régie が動かす |
| アプリの js は同じページで動く（信頼できるアプリだけの前提） | アプリは Worker の WASM で隔離して動かす |
| シェル `sh` の API | Réplique |
| Coulisses は `.bina` と asset を配る | Coulisses はサーバーサイドの処理とバックアップを受け持つ |

- `.bina`、パノプリ、ルーティング、設定画面（`/settings`）をどう引き継ぐかは未決

## 未決のこと

- 説明ファイル（`app.json`）と `.bina` との関係
- v0.1 の `.bina`・パノプリ・ルーティング・設定画面の扱い
- 依存ライブラリの固定（lock）の形
- 権限の種類
- アプリのサーバーサイドの置き場所と動かし方
- Réplique の呼び出しの形（終わったら呼ぶ関数を渡す形でよいか）
- エディタで `jsr:@binette/replique` の補完が効くか、JSR に AS のコードを公開できるか（試して確かめる）
- 配布先（JSR だけにするか）
