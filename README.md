# Binette

サーバーが画面の定義を JSON で渡し、ブラウザがそれを再生するための仕組みです。ファイルの拡張子は `.bina` です。

> [!WARNING]
> **設計中です。** 仕様はまだ固まっていません。

仕様は [docs/spec.md](docs/spec.md) にあります。

## 構成

| 名前 | 役割 |
|---|---|
| Binette | `.bina` の形式。Scene と Coulisses が共有する |
| Scene（シーン、舞台） | `.bina` を受け取り、ブラウザで再生する側 |
| Coulisses（クーリス、舞台裏） | `.bina` と、そこから使うファイルを用意して返す側 |

## パッケージ

| パッケージ | 内容 |
|---|---|
| [`@binette/core`](packages/core) | 形式の型と検査 |
| [`@binette/scene`](packages/scene) | ブラウザでの再生 |
| [`@binette/coulisses`](packages/coulisses) | `.bina` の配信 |

## デモ

Node.js 22.18 以上が必要です。

```sh
npm install
npm run demo:coulisses  # 配信（http://localhost:8790）
npm run demo:scene      # 再生（http://localhost:5175/）
```

2 つを別々の端末で起動し、http://localhost:5175/ を開きます。`npm run typecheck` で全パッケージを型検査します。

## ライセンス

[Apache License 2.0](LICENSE)
