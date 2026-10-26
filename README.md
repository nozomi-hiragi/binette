# Binette

ブラウザだけで動く、スマホの OS のようなアプリの土台です。アプリ（HTML ＋ AssemblyScript）を取ってきて、ブラウザの中でビルドして動かします。

> [!WARNING]
> **設計中です。** 仕様はまだ固まっていません。v0.2 は、カウンターのアプリ 1 つを動かすところまでの最小限の土台です。

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

アプリの例は [examples/counter](examples/counter) にあります。

## デモ

Deno 2.9 以上が必要です。

```sh
deno task demo:scene  # http://localhost:5175/
```

http://localhost:5175/ を開くと、カウンターのアプリをブラウザの中でビルドして動かします。

確かめ方とリリースの手順は [CONTRIBUTING.md](CONTRIBUTING.md) にあります。

## ライセンス

[Apache License 2.0](LICENSE)
