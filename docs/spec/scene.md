# @binette/scene

[仕様の目次](README.md)

Scene（シーン、舞台）はアプリの解釈層です。アプリのパッケージを読み、AS をビルドし、HTML を描いてアプリとつなぎます。依存は `@binette/core`、`@binette/regie`、`assemblyscript@0.28.20` です。

## 役割（案）

- アプリのパッケージを読む
- AS のビルドと検証（[app.md のインストール](app.md#インストール案)の 2 と 3）
- HTML をフロントの画面の中に描き、アプリとつなぐ。アプリの領域は枠の外に出られないようにする
- 起動すると、アプリの `start()` を呼ぶ

今のコードにあるのは、読む・ビルドする・描いてつなぐ・`start()` を呼ぶ、だけです。検証はまだありません。

## 公開するもの（実装済み）

| 名前 | 種類 | 内容 |
| --- | --- | --- |
| `loadCompiler` | 関数 | asc を読み込む |
| `buildApp` | 関数 | アプリを読んで WASM にビルドする |
| `mountApp` | 関数 | HTML を描き、アプリを起動してつなぐ |
| `Compiler`・`CompilerStream` | 型 | asc のうち、Scene が使う分 |
| `BuildOptions`・`BuiltApp` | 型 | `buildApp` の設定と結果 |
| `MountOptions`・`MountedApp` | 型 | `mountApp` の設定と結果 |

## loadCompiler

```ts
function loadCompiler(): Promise<Compiler>
```

- `import("assemblyscript/asc")` で asc を読み込みます。最初の呼び出しだけ読み込み、あとは同じ Promise を返します
- 読み込みに失敗したら覚えた Promise を捨て、次の呼び出しで読み込み直します
- `buildApp` は `compiler` を渡されなければこれを呼びます。読み込みの時間を分けて測りたいときは、先にこれを呼んで結果を `buildApp` に渡します
- asc は大きく（`vite build` で約 13.6 MB、gzip で約 2.9 MB の 1 つのチャンク）、読み込みは localhost でも 0.4〜0.5 秒かかります

```ts
interface CompilerStream {
  write(chunk: string | Uint8Array): void;
  toString(): string;
}
interface Compiler {
  main(argv: string[], options: {
    readFile: (name: string, baseDir: string) => string | null;
    writeFile: (name: string, contents: string | Uint8Array, baseDir: string) => void;
    listFiles: (dirname: string, baseDir: string) => string[] | null;
    stdout?: CompilerStream;
    stderr?: CompilerStream;
  }): Promise<{ error: Error | null }>;
  createMemoryStream(): CompilerStream;
}
```

`Compiler` は asc の型を使わず、Scene が使う分だけを自分で書いた型です。asc の型定義に頼ると、利用者の型検査に asc の大きな型定義が入るためです。

## buildApp

```ts
interface BuildOptions {
  /** 指定子 → AS のソース。例: { "jsr:@binette/replique": source } */
  libraries?: Record<string, string>;
  /** 使う asc。省略すると loadCompiler() */
  compiler?: Compiler;
}
interface BuiltApp {
  manifest: AppManifest;
  html: string;
  wasm: Uint8Array;
}
function buildApp(read: (path: string) => Promise<string>, options?: BuildOptions): Promise<BuiltApp>
```

`read` は、`app.json` を置いた場所からの相対パスを受けて、そのファイルの中身を返す関数です。取り方（`fetch`、`node:fs` など）は呼ぶ側が決めます。

1. `read("app.json")` を `parseAppManifest` で読む（誤りは `BinetteError`）
2. `read(manifest.entry.html)` と `read(manifest.entry.as)` を並べて読む
3. asc で AS を WASM にビルドする（下の「asc の呼び方」）
4. `{ manifest, html, wasm }` を返す

- `read` が reject したら、そのまま reject します
- `entry.css` は読みません
- ビルドに失敗したら、`Error` を投げます。`message` は `アプリをビルドできません。` の次の行に asc の出力を続けたものです。出力は標準エラー、それが空なら標準出力、それも空なら asc の `error.message` で、前後の空白を除きます。AS の型の誤りなら `TS2322` などのコードを含みます
- `app.json` の `binette`・`build` はまだ見ません。asc はいつも Scene が依存している版（`0.28.20`）です

### asc の呼び方

```ts
await asc.main(["main.ts", "--outFile", "main.wasm", "--optimizeLevel", "2", "--exportStart", "_start"], {
  readFile, writeFile, listFiles: () => [], stdout, stderr,
});
```

- `entry.as` のパスにかかわらず、AS のソースは `main.ts` という名前で渡します。asc の誤りの出力に出るファイル名も `main.ts` です
- `--exportStart _start` は、トップレベルの初期化を Régie が instance を作ったあとに走らせるためです（[regie.md](regie.md#ビルドのしかた)）
- ランタイムは asc の既定（`incremental`）です
- `writeFile` は `main.wasm` の中身（`Uint8Array`）だけを受け取り、ほかは捨てます
- 標準ライブラリは asc に入っているので、`readFile` で返す必要はありません

### ファイルの解決

asc はファイルを `readFile(name, baseDir)` で読みに来ます。Scene は次のように返します。

| `name` | 返すもの |
| --- | --- |
| `main.ts` | アプリの AS のソース |
| `node_modules/<指定子>.ts` | `libraries[<指定子>]`（あれば） |
| `node_modules/<指定子>/index.ts` | `libraries[<指定子>]`（あれば） |
| それ以外（`asconfig.json` など） | `null`（無い） |

- AS で `import { ui } from "jsr:@binette/replique"` と書くと、asc はこれをパッケージの import とみなし、`node_modules/jsr:@binette/replique.ts`、次に `node_modules/jsr:@binette/replique/index.ts` を読みに来ます。そこで `libraries["jsr:@binette/replique"]` を返すと解決します
- サブパス（`jsr:@binette/replique/glue` など）も、指定子をそのままキーにして引けます
- `libraries` に無い指定子や、AS のファイルどうしの相対 import（`./util`）は解決できず、ビルドの誤りになります
- Réplique はまだ公開していないので、今は呼ぶ側がワークスペースの `packages/replique/src/index.ts` の中身を渡します。将来は、`app.json` の `binette` の版に合う Réplique を Scene が JSR から取って差し込む（案。[app.md](app.md#インストール案)）

## mountApp

```ts
interface MountOptions {
  /** アプリの中で起きたエラーや、呼び出しの失敗 */
  onError?: (error: unknown) => void;
  /** Worker を作る関数。省略すると Régie の Blob URL の Worker */
  createWorker?: LaunchOptions["createWorker"];
}
interface MountedApp {
  /** Régie で動いているアプリ */
  readonly app: RegieApp;
  /** アプリを止め、クリックの受け付けをやめる */
  stop(): void;
}
function mountApp(element: HTMLElement, built: BuiltApp, options?: MountOptions): Promise<MountedApp>
```

1. `element.style.contain = "paint"` にする（アプリの描画が `element` の外に出ないように）
2. `element.innerHTML = built.html` で HTML を描く
3. Régie の `launchApp(built.wasm, …)` でアプリを起動する。`onText` を下の `bina-text` につなぐ
4. `element` に `click` のリスナーを 1 つ付ける（下の `bina-on-click`）
5. `app.exports` に `start` があれば `app.call("start")` を待つ。失敗したら `stop()` してから同じエラーで reject する
6. `{ app, stop }` で解決する

- 起動（3）に失敗したら、そのエラーで reject します。描いた HTML はそのまま残ります
- `stop()` はリスナーを外し、`app.stop()` を呼びます。描いた HTML は消しません
- DOM はグローバルの `document` を使わず、`element` から辿ります（テストで happy-dom を使うため）

### HTML とアプリのつなぎ方

属性の接頭辞は `bina-` にする（決定 2026-10-26）。`data-*` はアプリが自由に使える。

| HTML | 意味 | アプリ側（Réplique） | 状態 |
| --- | --- | --- | --- |
| `bina-text="name"` | 文字を差し込む | `ui.text("name", "…")` | 実装済み |
| `bina-on-click="fn"` | クリックで `fn()` | `export function fn(): void` | 実装済み |
| `bina-show="name"` | 表示・非表示 | `ui.show("name", true)` | 案 |
| `bina-enabled="name"` | 有効・無効 | `ui.enabled("name", false)` | 案 |
| `bina-value="name"` | 入力欄の値 | `ui.value("name", "")` | 案 |
| `bina-each="list"` ＋ `<template>` | 一覧の繰り返し | `ui.listClear` / `ui.listAdd` / `ui.itemText` | 案 |
| `bina-on-input="fn"` | 入力で `fn(値)` | `export function fn(value: string): void` | 案 |
| `bina-on-submit="fn"` | 送信で `fn()`（ページ移動はしない） | `export function fn(): void` | 案 |

- 一覧の中のイベントは、その行のキーを引数で渡す（案）

`bina-text`（実装済み）:

- `ui.text(name, value)` が届くたびに、`element` の中の `bina-text` を持つ要素のうち、属性の値が `name` と完全に一致するものすべての `textContent` を `value` にします
- 一致する要素が無ければ何もしません。HTML に最初から書いた文字（カウンターの `0` など）は、`ui.text` が来るまでそのまま出ます

`bina-on-click`（実装済み）:

- `element` で受けたクリックの `event.target` から `closest("[bina-on-click]")` で要素を探します。要素が `element` の中にあり、属性の値が空でなければ、その値の名前で `app.call(name)` を呼びます
- 既定の動作（リンクの移動、フォームの送信など）は止めません
- 呼び出しが失敗したら `onError` に渡します。Régie が `onError` で知らせたエラーと同じものは、二度は渡しません

### まだしていないこと

- HTML の検証（`<script>`・`on*` 属性・外部 URL が無いこと、`bina-on-*` の名前が export にあること）。今は `innerHTML` にそのまま入れます。`<script>` は `innerHTML` では実行されませんが、`on*` 属性は動きます
- `entry.css` の読み込みと、テーマの CSS 変数
- Shadow DOM などでの、フロントの CSS とアプリの CSS の分離

## デモ（実装済み）

`npm run demo:scene` で、Vite の dev サーバーを http://localhost:5175/ に起動します。

- Vite の `publicDir` をリポジトリの `examples/` にしてあり、`/counter/app.json` などを GET で取ります
- Réplique のソースは `packages/replique/src/index.ts?raw` で読み、`libraries` に渡します
- `loadCompiler()` と `buildApp()` の時間を別々に測って出します
