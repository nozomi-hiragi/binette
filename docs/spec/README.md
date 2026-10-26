# Binette 仕様（v0.2 下書き）

Binette（ビネット）は、ブラウザだけで動く、スマホの OS のようなアプリの土台です。アプリを GitHub などから取ってきて、ブラウザの中でビルドし、検証してからインストールして動かします。サーバーの処理やデータが要るアプリは、自分のサーバーサイドとだけ通信します。

> [!WARNING]
> 書き始めたばかりの下書きです。各節の見出しに **決定** と付いたものはのぞみが決めたこと、**案** と付いたものは提案で、まだ決まっていません。**実装済み** と付いたものは、今のコードの動きをそのまま書いたものです（決定ではなく、変わることがあります）。v0.1（画面の定義 `.bina` を同じページで再生する形）からは大きく変わります。v0.1 の仕様はタグ `v0.1.0` を見てください。

## ファイルの構成

仕様はパッケージごとにファイルを分けています。このファイルは全体の方針と、層の関係を書きます。

| ファイル | 内容 |
| --- | --- |
| [app.md](app.md) | アプリのパッケージと説明ファイル `app.json`、インストールの流れ |
| [core.md](core.md) | `@binette/core`。形式の型と読み込み |
| [regie.md](regie.md) | `@binette/regie`。アプリの実行（Worker ＋ WASM） |
| [scene.md](scene.md) | `@binette/scene`。アプリのビルドと画面への描画 |
| [replique.md](replique.md) | `@binette/replique`。アプリが Régie を呼ぶためのライブラリ（AS） |
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

- 依存の向き: `core` ← `regie` ← `scene`（フロント側）、`core` ← `coulisses`（サーバー側）。`replique` は AS 用で、Régie とは「呼び出しの一覧」（[replique.md](replique.md)）という約束だけを共有する
- Binette は WAKE に依存しない。Régie と Coulisses の間の通信路はフロントの実装が渡す。EbinaStation ではそこに WAKE が入る
- ビルドと検証は Scene が行い、何を許すかの最終判断は Régie が持つ

### 今の依存（実装済み）

| パッケージ | 依存 |
| --- | --- |
| `@binette/core` | `valibot@1.5.0` |
| `@binette/regie` | なし（core も使っていない） |
| `@binette/scene` | `@binette/core`、`@binette/regie`、`assemblyscript@0.28.20` |
| `@binette/coulisses` | `@binette/core` |
| `@binette/replique` | なし（AS のソースだけ） |

- 全パッケージは同じ版にする（[CONTRIBUTING.md](../../CONTRIBUTING.md)）。今はすべて `0.1.0` で、v0.2 として公開するときに `0.2.0` にする
- 配布先は npm と JSR の両方。replique は `dist` を持たず、AS のソース `src/index.ts` をそのまま配る

## v0.2 の最小限の土台（実装済み）

今のコードでできるのは、カウンターのアプリ 1 つ（[examples/counter](../../examples/counter)）をブラウザの中でビルドして動かすところまでです。

1. Scene が `app.json`・HTML・AS を読む（[scene.md](scene.md) の `buildApp`）
2. Scene がブラウザの中で asc を動かし、AS を WASM にビルドする。`jsr:@binette/replique` はワークスペースの Réplique のソースで解決する
3. Scene が HTML を描き、Régie が WASM を Worker で起動する（[regie.md](regie.md)）
4. Scene がアプリの `start()` を呼ぶ。アプリの `ui.text` は Régie を通って Scene に届き、`data-text` の要素を書き換える。`data-on-click` の要素を押すと、Scene が Régie を通してアプリの関数を呼ぶ

保存・権限・インストール・サーバー通信・HTML の検証はまだありません。

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
- エディタで `jsr:@binette/replique` の補完が効くか、JSR に AS のコードを公開できるか（`jsr publish --dry-run` は通る。実際の公開と補完は未確認）
- 配布先（JSR だけにするか）。今は npm と JSR の両方
- Worker の作り方（今は Blob URL。CSP に `worker-src blob:` が要る。[regie.md](regie.md)）
- asc の読み込みの重さ（約 13.6 MB、gzip で約 2.9 MB）をどうするか
