# Binette

ブラウザだけで動く、スマホの OS のようなアプリの土台です。アプリ（HTML ＋ AssemblyScript）を取ってきて、ブラウザの中でビルドして動かします。

> [!WARNING]
> **設計中です。** 仕様はまだ固まっていません。v0.2 は、ホームから設定アプリを開いて戻れるところまでの最小限の土台です。

仕様は [docs/spec/](docs/spec/README.md) にあります。

## 構成

| 名前 | 役割 |
|---|---|
| Binette | パッケージの共通物（`app.json` の型など）。層ではない |
| Régie（レジ、操作室） | カーネル。中身を全部持つ。アプリのビルド、実行（Worker ＋ WASM）、状態、スタック、権限、保存 |
| Scene（シーン、舞台） | システム UI。ホームバーなどの大枠と、その中のアプリの置き場を描く。判断は Régie が持つ |
| Coulisses（クーリス、舞台裏） | サーバー側。今は v0.1 の `.bina` を配るだけ |
| Réplique（レプリク、セリフ） | アプリが Régie を呼ぶためのライブラリ（AS） |

## パッケージ

分け直しの途中です（2026-10-28）。仕様は分け直したあとの形で書いています（[docs/spec/README.md](docs/spec/README.md#層の分担決定-2026-10-28)）。

| パッケージ | 内容 |
|---|---|
| [`@binette/core`](packages/core) | パッケージの共通物。`app.json` の型と検査（v0.1 の `.bina` の型も残している） |
| [`@binette/regie`](packages/regie) | カーネル。今はアプリの実行（Worker ＋ WASM）と保存 |
| [`@binette/scene`](packages/scene) | システム UI。今はアプリのビルドと、状態・スタックなどの判断も持っている |
| [`@binette/coulisses`](packages/coulisses) | v0.1 の `.bina` の配信 |
| [`@binette/replique`](packages/replique) | アプリ用の AS ライブラリ |

設定はシステムアプリ [apps/settings](apps/settings) が持ちます（決定）。今は骨組みで、設定の項目と、それを読み書きする呼び出しは未決です。AS の document API で通常の id の要素を参照し、文字の変更とクリックを扱います。

## デザイナー

デザイナーは Décor の宣言 UI をコードと部品の木の間で編集する通常の同梱アプリです。`text`・`button`・`input`・`appIcon` と `column`・`row`・`grid` などの配置、余白や見出し等の修飾を扱います。既存の式を読み込んで編集後の Décor コードを出力でき、ボタンや入力欄のコールバック式は実行せず、そのまま保持します。`appIcon` は通常アプリからアイコンを取得できないため、プレビューには代わりの表示を出します。

使うには `deno task start` で Binette を起動し、ホームから「デザイナー」を開きます。Décor の式を読み込むか入力し、部品や修飾を編集して、出力されたコードをアプリのソースに使います。

## 単独で起動する

Deno 2.9 以上が必要です。

```sh
deno task start  # http://localhost:5175/
```

http://localhost:5175/ を開くと、ホームに設定とデザイナーが並びます。システムアプリと同梱アプリはプリビルドした `.binapp` を使い、IndexedDB に保存します。ブラウザでは asc を読みません。

`deno task build` はアプリをビルドしてから `dist/` に静的ファイルを書き出します。そのまま GitHub Pages のサブパスにも配置できます。入口はリポジトリ直下の `index.html` と `src/main.ts` です。`apps/` の直下に `app.json` を持つフォルダを足すとシステムアプリ、`bundled/` に足すと通常の同梱アプリが増えます。どちらも `deno task build:system` でビルドします。同梱アプリの入手元は `binette:bundled` で、システムアプリの権限は持ちません。デザイナーは `bundled/designer/` に置いています。

ブラウザのタブでは「ライブモード」と表示し、ホームバーの「インストール」からインストールの画面か手順を開けます。iPhone の Safari では「共有 → ホーム画面に追加」を使います。ライブで試した内容は、インストール後に引き継げることを保証しません。本番では OS の Service Worker がオフライン用にキャッシュします。初回の登録後にオンラインで再読み込みしてから使ってください。開発サーバーでは登録しません。

ホームはシステムアプリ [apps/home](apps/home) です（決定）。HTML と AS がタイルの見た目と並びを持ち、どれをホームにしてどう開くかは Régie、アプリを置く枠とホームバーは Scene が持ちます（今のコードでは両方 Scene の `mountShell` にある）。一覧・アイコン・`apps.*` は実装済み（形は案）です。ホームの差し替え、権限の仕組み、アプリの CSS の分離は未決です。

確かめ方とリリースの手順は [CONTRIBUTING.md](CONTRIBUTING.md) にあります。

## ライセンス

[Apache License 2.0](LICENSE)

Décor のテーマ（案）は、`theme({ space: { md: 16 }, button: { padding: space.md } }, view)` で部分木ごとの段と部品の既定を設定できます。`.gap()` / `.padding()` は標準の md、数の引数は引き続き px です。TS と AS の両方に対応し、アプリに CSS の記述は不要です。詳しくは [Décor の仕様](docs/spec/decor.md) を参照してください。
