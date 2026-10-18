# Binette

サーバーが画面の定義を JSON で渡し、ブラウザがそれを再生するための仕組みです。ファイルの拡張子は `.bina` です。

> [!WARNING]
> **設計中です。** 仕様はまだ固まっていません。

仕様は [SPEC.md](SPEC.md) にあります。

## 構成

| 名前 | 役割 |
|---|---|
| Binette | `.bina` の形式。Scene と Coulisses が共有する |
| Scene（シーン、舞台） | `.bina` を受け取り、ブラウザで再生する側 |
| Coulisses（クーリス、舞台裏） | `.bina` と、そこから使うファイルを用意して返す側 |

## パッケージ（予定）

| パッケージ | 内容 |
|---|---|
| `@binette/core` | 形式の型と検査 |
| `@binette/scene` | ブラウザでの再生 |
| `@binette/coulisses` | `.bina` の配信 |

## ライセンス

[Apache License 2.0](LICENSE)
