# Binette 仕様（v0.2 下書き）

Binette（ビネット）は、ブラウザだけで動く、スマホの OS のようなアプリの土台です。アプリを GitHub などから取ってきて、ブラウザの中でビルドし、検証してからインストールして動かします。サーバーの処理やデータが要るアプリは、自分のサーバーサイドとだけ通信します。

> [!WARNING]
> 書き始めたばかりの下書きです。各節の見出しに **決定** と付いたものはのぞみが決めたこと、**案** と付いたものは提案で、まだ決まっていません。**実装済み** と付いたものは、今のコードの動きをそのまま書いたものです（決定ではなく、変わることがあります）。v0.1（画面の定義 `.bina` を同じページで再生する形）からは大きく変わります。v0.1 の仕様はタグ `v0.1.0` を見てください。

## ファイルの構成

仕様はパッケージごとにファイルを分けています。このファイルは全体の方針と、層の関係を書きます。

| ファイル | 内容 |
| --- | --- |
| [app.md](app.md) | アプリのパッケージと説明ファイル `app.json`、インストールの流れ |
| [core.md](core.md) | `@binette/core`。パッケージの共通物（形式の型と検査、ライフサイクルの番号、DOM 操作の型） |
| [lifecycle.md](lifecycle.md) | ページ・アプリ・プロセス・画面のライフサイクル。ライブモードとインストール済み、Service Worker の位置づけ、`App` クラス |
| [regie/](regie/README.md) | `@binette/regie`。カーネル。ビルド（[build.md](regie/build.md)）、実行（[run.md](regie/run.md)）、プロセス（[process.md](regie/process.md)）、システム（[system.md](regie/system.md)）、保存（[store.md](regie/store.md)） |
| [scene/](scene/README.md) | `@binette/scene`。システム UI。大枠（[shell.md](scene/shell.md)）、アプリの置き場（[mount.md](scene/mount.md)） |
| [replique.md](replique.md) | `@binette/replique`。アプリが Régie を呼ぶためのライブラリ（AS） |
| [apps/](apps/README.md) | システムアプリ（OS と一緒に配るアプリ）。ホーム（[home.md](apps/home.md)）、設定（[settings.md](apps/settings.md)） |
| [coulisses.md](coulisses.md) | `@binette/coulisses`。サーバー側（今は v0.1 のまま） |

## 方針（決定）

- スマホの OS のようなもの。ブラウザのアプリ（フロント）だけで動く
- アプリはブラウザの中でビルドし、単体でインストールできる。クライアントでビルドするのは、そこでコードを検証できるから
- アプリの入手元は GET で取れればどこでもよい。基本は GitHub
- サーバーの処理やデータが要るアプリは、WAKE などで通信する。通信はアプリごとに分け、アプリは自分のサーバーサイドとしか通信できない
- アプリは HTML ＋ AssemblyScript（AS）で書く方向で試す。TSX のような書き方（ASX）は後で考える
- データのバックアップはサーバー側（Coulisses）に任せる
- 開発は binette のリポジトリだけで進める。版を固定して JSR に公開してから、EbinaStation（ebina-front・ebina-station）に入れる

## 呼び名と層（決定）

| 名前 | 役割 | パッケージ |
| --- | --- | --- |
| Binette | パッケージの共通物。層ではない | `@binette/core` |
| Régie（レジ、操作室） | カーネル。中身を全部持つ（ビルド、実行、状態、スタック、権限、保存など） | `@binette/regie` |
| Scene（シーン、舞台） | システム UI。大枠とアプリの置き場を描く | `@binette/scene` |
| Coulisses（クーリス、舞台裏） | サーバー側。処理の逃がし先とバックアップ | `@binette/coulisses` |
| Réplique（レプリク、セリフ） | アプリが Régie を呼ぶためのライブラリ（AS） | `@binette/replique` |

- カーネル（Régie）は形式の定義（core）とは別のパッケージにする

### EbinaStation での呼び名（決定）

| Binette | EbinaStation |
| --- | --- |
| フロントの実装（Régie と Scene を載せる。ホームと設定は Binette が持つ） | ebina-front |
| Coulisses を WAKE と合わせて実装したもの | ebina-station（Station） |

## 単独で起動できるフロント（決定）

Binette は単独で起動できます。入口はリポジトリ直下の `index.html`・`vite.config.ts` と `src/main.ts` です。Régie と Scene を載せます。

`deno task start` で開発用に起動し、`deno task build` で `dist/` に静的ファイルを書き出します。システムアプリの設定はプリビルドした `.binapp` を同梱し、IndexedDB に保存します。ブラウザでは asc を読みません。相対 URL で配信でき、GitHub Pages のサブパスにも置けます。

ホームと設定は、OS と一緒に配るシステムアプリとして Binette が持ちます（決定）。置き場所はリポジトリ直下の `apps/` で、フォルダを足すだけで増えます。配り方と未決のことは [apps/](apps/README.md)、それぞれの仕様は [apps/home.md](apps/home.md) と [apps/settings.md](apps/settings.md) にあります。

## 層の分担（決定 2026-10-28）

最初の構想から実装が進んで、パッケージの中身が呼び名とずれたので、分け直しました（のぞみ 2026-10-28）。**Régie は中身、Scene は表示** です。判断は全部 Régie が持ち、Scene は Régie が決めたことを見せるだけです。core は層ではなく、パッケージの共通物です。

| パッケージ | 担当 |
| --- | --- |
| core | 共通物。`app.json` の型と検査、ライフサイクルの番号、DOM 操作の型。動きは持たない |
| Régie | カーネル。アプリのビルドと検証、インストール、実行（Worker ＋ WASM）、状態の移り変わり、スタック、ホームの選び方、落ちたときの扱い、権限、OS の設定、保存。画面は持たず DOM に触らない |
| Scene | システム UI。大枠（ホームバー、Apps の一覧、エラー表示、ライブモード）と、その中のアプリの置き場（HTML を描き、DOM 操作を反映し、クリックを Régie に渡す） |
| Réplique | アプリが Régie を呼ぶためのライブラリ（AS） |
| Coulisses | サーバー側。アプリのサーバーサイド処理、バックアップの受け取り |
| フロントの実装 | Scene を載せる入口。Régie と Coulisses の間の通信路を差し込む。設定はシステムアプリ `apps/settings` が持つ |

```
          core（共通物）
            ↑
          regie（中身）  ← replique とは「呼び出しの一覧」と番号だけを共有する
            ↑
          scene（表示）
            ↑
     ルートの OS（src/main.ts）
```

- 依存は一直線にする。Scene は Régie の型と `startSystem` を使う。Régie は Scene を知らず、`SystemUi`（[regie/system.md](regie/system.md#api案)）という約束だけで見せ方を頼む
- ビルドは Régie に置く（[regie/build.md](regie/build.md)）。何を動かしてよいかの判断と同じ所に置くため。asc は重いので `@binette/regie/build` という別の入口にし、ビルドしない利用者は読まない
- Binette は WAKE に依存しない。Régie と Coulisses の間の通信路はフロントの実装が渡す。EbinaStation ではそこに WAKE が入る
- 関数の名前と形（`startSystem`・`startProcess`・`SystemUi`・`createShellUi` など）は案

### 今のコードとの差

分け直しは実装済みです。

### 今の依存（実装済み）

| パッケージ | 依存 |
| --- | --- |
| `@binette/core` | `valibot@1.5.0`（npm） |
| `@binette/regie` | `@binette/core`、`assemblyscript@0.28.20`（ビルドのみ）、`@std/path`（CLI のみ） |
| `@binette/scene` | `@binette/core`、`@binette/regie` |
| `@binette/coulisses` | `@binette/core`、`@std/path` |
| `@binette/replique` | なし（AS のソースだけ） |

テストだけで使うもの: `@std/assert`、`happy-dom@21.0.4`（描画とクリックのテスト）。どれも MIT です。

- 全パッケージは同じ版にする（[CONTRIBUTING.md](../../CONTRIBUTING.md)）。今はすべて `0.1.0` で、v0.2 として公開するときに `0.2.0` にする
- 配布は JSR だけにする（決定 2026-10-26）。npm に公開済みの 0.1.0 はそのまま残る。どのパッケージも `src/` の TypeScript（replique は AS）をそのまま配る
- 開発は Deno だけで行う（決定 2026-10-26）。npm と Node は使わない

## v0.2 の最小限の土台（実装済み）

ホームは Binette が持ちます（決定）。今は設定アプリを並べ、開いて戻れます（[regie/system.md](regie/system.md)、[scene/shell.md](scene/shell.md)）。設定は `apps/settings` が持ち、設定の項目と読み書きの呼び出しは未決です。

システムは同じ入手元・ID・版のビルド結果を保存して使い回します。Binette はシステムアプリのプリビルド結果を、入手元 `binette:system` として毎回保存し直して開きます。開発用の `read` を渡したときの初回の流れは次のとおりです。

1. Régie が `app.json`・HTML・AS を読む（[regie/build.md](regie/build.md) の `buildApp`）
2. Régie がブラウザの中で asc を動かし、AS を WASM にビルドする。`jsr:@binette/replique` はワークスペースの Réplique のソースで解決する
3. Régie が WASM を Worker で起動し（[regie/run.md](regie/run.md)）、Scene が置き場に HTML を描く
4. Régie が App の onCreate → onStart(Create) → onResume を呼ぶ。アプリは通常の id を document.getElementById で参照し、textContent などを変更する。addEventListener の click は Réplique の Event を受け取る（決定 2026-10-27）。

ビルド結果の保存は実装済みです。権限の確認・サーバー通信・HTML の検証はまだありません。

## v0.1 から変わること（案）

| v0.1 | v0.2 |
| --- | --- |
| サーバーが配る `.bina` を Scene が再生する | アプリをインストールして、Régie が動かす |
| アプリの js は同じページで動く（信頼できるアプリだけの前提） | アプリは Worker の WASM で隔離して動かす |
| シェル `sh` の API | Réplique |
| Coulisses は `.bina` と asset を配る | Coulisses はサーバーサイドの処理とバックアップを受け持つ |

- `.bina`、パノプリ、ルーティング、設定画面（`/settings`）をどう引き継ぐかは未決
- 今のコードでは、Scene の v0.1 の実装（`.bina` の再生、ルーティング、設定画面、`sh`）は消してある。core の `.bina` の読み込みと Coulisses は、v0.1 のまま残してある（[core.md](core.md)、[coulisses.md](coulisses.md)）

## 未決のこと

- 説明ファイル（`app.json`）と `.bina` との関係
- v0.1 の `.bina`・パノプリ・ルーティング・設定画面の扱い。core の `.bina` の読み込みと Coulisses を残すか消すか
- 依存ライブラリの固定（lock）の形
- 権限の種類
- アプリのサーバーサイドの置き場所と動かし方
- Réplique の呼び出しの形（終わったら呼ぶ関数を渡す形でよいか）
- エディタで `jsr:@binette/replique` の補完が効くか、JSR に AS のコードを公開できるか（`deno publish --dry-run` は通る。実際の公開と補完は未確認）
- Worker の作り方（今は Blob URL。CSP に `worker-src blob:` が要る。[regie/run.md](regie/run.md#blob-url-の-worker)）
- asc の読み込みの重さ（約 13.6 MB、gzip で約 2.9 MB）をどうするか

## 宣言的 UI（案）

[宣言的 UI](ui.md) は HTML 方式と並ぶ画面の書き方です。
