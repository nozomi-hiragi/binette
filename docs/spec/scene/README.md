# @binette/scene

[仕様の目次](../README.md)

Scene（シーン、舞台）はアプリの解釈層です。アプリのパッケージを読み、AS をビルドし、HTML を描いてアプリとつなぎます。依存は `@binette/core`、`@binette/regie`、`assemblyscript@0.28.20` と、書き出しコマンドだけが使う `@b-fuze/deno-dom@0.1.56`（MIT）です。

## 役割（案）

- アプリのパッケージを読む
- AS のビルドと検証（[app.md のインストール](../app.md#インストール案)の 2 と 3）
- HTML をフロントの画面の中に描き、アプリとつなぐ。アプリの領域は枠の外に出られないようにする
- 起動すると、アプリの `start()` を呼ぶ
- ホームにアプリを並べ、1 つずつ開いて戻る（実装済み）

読み込み・ビルド・描画・ホームは実装済みです。HTML や権限の検証はまだありません。

## 公開するもの（実装済み）

| 名前 | 種類 | 内容 |
| --- | --- | --- |
| `loadCompiler` | 関数 | asc を読み込む |
| `buildApp` | 関数 | アプリを読んで WASM にビルドする |
| `parseBindings` | 関数 | HTML から `bina` の名前と `bina-on-click` の関数名を集める |
| `generateBindingsSource` | 関数 | 名前から `bina.ts`（AS のソース）を作る |
| `mountApp` | 関数 | HTML を描き、アプリを起動してつなぐ |
| `mountHome` | 関数 | 保存済みアプリを使うホームを描く |
| `Compiler`・`CompilerStream` | 型 | asc のうち、Scene が使う分 |
| `BuildOptions`・`BuiltApp` | 型 | `buildApp` の設定と結果 |
| `HtmlParser`・`Bindings`・`BindingKind` | 型 | `parseBindings` の入力と結果 |
| `MountOptions`・`MountedApp` | 型 | `mountApp` の設定と結果 |
| `HomeApp`・`HomeOptions`・`MountedHome` | 型 | `mountHome` の設定と結果 |

ほかに、書き出しコマンド `jsr:@binette/scene/cli`（`writeBindings`）があります（[bindings.md](bindings.md#書き出しコマンド実装済み)）。


## ファイルの構成

| ファイル | 内容 |
| --- | --- |
| [build.md](build.md) | `loadCompiler`・`buildApp`。asc の呼び方と、ファイルの解決 |
| [bindings.md](bindings.md) | HTML の名前の木（`parseBindings`）と、`bina.ts` の生成、書き出しコマンド |
| [home.md](home.md) | `mountHome`。保存、一覧、起動と戻る、CSS 変数 |
| [mount.md](mount.md) | `mountApp`。HTML とアプリのつなぎ方、読める値、止める操作 |

## 単独フロント（実装済み）

Scene を載せる Binette の入口はリポジトリ直下にあります（[全体の方針](../README.md#単独で起動できるフロント決定)）。`deno task start` で http://localhost:5175/ に起動し、`deno task build` で静的ファイルを書き出します。

- ワークスペースのパッケージは Vite の `resolve.alias` でソースを読みます
- `apps/` のシステムアプリを `.binapp/` に書き出し、`src/main.ts` の `import.meta.glob("../.binapp/*.binapp", { query: "?url", import: "default", eager: true })` で同梱し、`mountHome` に `prebuilt` として渡します
- 保存は IndexedDB を使い、ブラウザでは asc を読みません
- Vite の `base: "./"` でサブパス配信に対応します
