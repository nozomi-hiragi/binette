# Binette

ブラウザだけで動く、スマホの OS のようなアプリの土台です。アプリ（HTML ＋ AssemblyScript）を取ってきて、ブラウザの中でビルドして動かします。

> [!WARNING]
> **設計中です。** 仕様はまだ固まっていません。v0.2 は、ホームから設定アプリを開いて戻れるところまでの最小限の土台です。

仕様は [docs/spec/](docs/spec/README.md) にあります。

## 構成

| 名前 | 役割 |
|---|---|
| Binette | 形式の定義（`app.json` など）。どの層も共有する |
| Régie（レジ、操作室） | カーネル。アプリの WASM を Worker で動かし、アプリからの呼び出しを受ける |
| Scene（シーン、舞台） | アプリの解釈層。アプリを読み、AS をビルドし、HTML を描いてアプリとつなぐ |
| Coulisses（クーリス、舞台裏） | サーバー側。今は v0.1 の `.bina` を配るだけ |
| Réplique（レプリク、セリフ） | アプリが Régie を呼ぶためのライブラリ（AS） |

## パッケージ

| パッケージ | 内容 |
|---|---|
| [`@binette/core`](packages/core) | `app.json` の型と検査（v0.1 の `.bina` の型も残している） |
| [`@binette/regie`](packages/regie) | アプリの実行（Worker ＋ WASM） |
| [`@binette/scene`](packages/scene) | アプリのビルドと画面への描画 |
| [`@binette/coulisses`](packages/coulisses) | v0.1 の `.bina` の配信 |
| [`@binette/replique`](packages/replique) | アプリ用の AS ライブラリ |

設定はシステムアプリ [apps/settings](apps/settings) が持ちます（決定）。今は骨組みで、設定の項目と、それを読み書きする呼び出しは未決です。HTML の `bina` から `bina.ts` を生成し、AS では `elem.text` で文字を変えます。

```sh
deno task gen:bindings  # HTML を変えたら生成し直す（エディタの補完用）
```

## 単独で起動する

Deno 2.9 以上が必要です。

```sh
deno task start  # http://localhost:5175/
```

http://localhost:5175/ を開くと、設定がホームに 1 つ並び、開いて「詳しく」を押すと説明が出ます。「戻る」でホームに戻れます。システムアプリはプリビルドした `.binapp` を使い、IndexedDB に保存します。ブラウザでは asc を読みません。

`deno task build` はアプリをビルドしてから `dist/` に静的ファイルを書き出します。そのまま GitHub Pages のサブパスにも配置できます。入口はリポジトリ直下の `index.html` と `src/main.ts` です。`apps/` の直下に `app.json` を持つフォルダを足すだけで、システムアプリが増えます。

ホームは将来、システムアプリ `apps/home` にする方針です。Réplique の繰り返し（テンプレート）と画像・属性、入っているアプリの一覧・起動の特権の呼び出し、権限の仕組みが要ります。今は Scene の `mountHome` がホームを持ち、アプリを開いて戻す枠は OS 側に残ります。

確かめ方とリリースの手順は [CONTRIBUTING.md](CONTRIBUTING.md) にあります。

## ライセンス

[Apache License 2.0](LICENSE)
