# @binette/scene

[仕様の目次](../README.md)

Scene（シーン、舞台）はアプリの解釈層です。アプリのパッケージを読み、AS をビルドし、HTML を描いてアプリとつなぎます。依存は `@binette/core`、`@binette/regie`、`assemblyscript@0.28.20`です。

## 役割（案）

- アプリのパッケージを読む
- AS のビルドと検証（[app.md のインストール](../app.md#インストール案)の 2 と 3）
- HTML をフロントの画面の中に描き、アプリとつなぐ。アプリの領域は枠の外に出られないようにする
- 起動すると、App の onCreate → onStart(Create) → onResume を呼ぶ
- ホームを起動し、スタックとホームバーの枠を持つ（実装済み）

読み込み・ビルド・描画・ホームは実装済みです。HTML や権限の検証はまだありません。

## 公開するもの（実装済み）

| 名前 | 種類 | 内容 |
| --- | --- | --- |
| `loadCompiler` | 関数 | asc を読み込む |
| `buildApp` | 関数 | アプリを読んで WASM にビルドする |
| `mountApp` | 関数 | HTML を描き、アプリを起動してつなぐ |
| `mountShell` | 関数 | 保存し、ホームとアプリを開くホームバーの枠を描く |
| `Compiler`・`CompilerStream` | 型 | asc のうち、Scene が使う分 |
| `BuildOptions`・`BuiltApp` | 型 | `buildApp` の設定と結果 |
| `MountOptions`・`MountedApp` | 型 | `mountApp` の設定と結果 |
| `ShellApp`・`ShellOptions`・`MountedShell` | 型 | `mountShell` の設定と結果 |



## ファイルの構成

| ファイル | 内容 |
| --- | --- |
| [build.md](build.md) | `loadCompiler`・`buildApp`。asc の呼び方と、ファイルの解決 |
| [shell.md](shell.md) | `mountShell`。保存、ホームの選択、スタックとホームバー、CSS 変数 |
| [mount.md](mount.md) | `mountApp`。HTML とアプリのつなぎ方、読める値、止める操作 |

## 単独フロント（実装済み）

Scene を載せる Binette の入口はリポジトリ直下にあります（[全体の方針](../README.md#単独で起動できるフロント決定)）。`deno task start` で http://localhost:5175/ に起動し、`deno task build` で静的ファイルを書き出します。

- ワークスペースのパッケージは Vite の `resolve.alias` でソースを読みます
- `apps/` のシステムアプリを `.binapp/` に書き出し、`src/main.ts` の `import.meta.glob("../.binapp/*.binapp", { query: "?url", import: "default", eager: true })` で同梱し、`mountShell` に `prebuilt` として渡します
- 保存は IndexedDB を使い、ブラウザでは asc を読みません
- Vite の `base: "./"` でサブパス配信に対応します


v0.2 の途中で bina 属性と bina.ts の生成、bindings の API と仕様書を無くしました（決定 2026-10-27）。通常の id と document API に置き換えています。parser と deno-dom も不要になったため取り除きました（案・実装済み）。CLI は writePrebuiltApp による .binapp の書き出しだけを残します。
