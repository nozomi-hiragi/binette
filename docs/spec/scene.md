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
| `parseBindings` | 関数 | HTML から `bina` の名前と `bina-on-click` の関数名を集める |
| `generateBindingsSource` | 関数 | 名前から `bina.ts`（AS のソース）を作る |
| `mountApp` | 関数 | HTML を描き、アプリを起動してつなぐ |
| `Compiler`・`CompilerStream` | 型 | asc のうち、Scene が使う分 |
| `BuildOptions`・`BuiltApp` | 型 | `buildApp` の設定と結果 |
| `HtmlParser`・`Bindings`・`BindingKind` | 型 | `parseBindings` の入力と結果 |
| `MountOptions`・`MountedApp` | 型 | `mountApp` の設定と結果 |

ほかに、書き出しコマンド `jsr:@binette/scene/cli`（`writeBindings`）があります（[下](#書き出しコマンド)）。

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
    readFile: (name: string, baseDir: string) => string | null | Promise<string | null>;
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
  /** HTML を読む DOMParser。省略するとブラウザの globalThis.DOMParser */
  parser?: HtmlParser;
  /** 指定子 → AS のソース。例: { "jsr:@binette/replique": source } */
  libraries?: Record<string, string>;
  /** 使う asc。省略すると loadCompiler() */
  compiler?: Compiler;
}
interface BuiltApp {
  /** HTML から集めた名前（parseBindings の結果） */
  bindings: Bindings;
  manifest: AppManifest;
  html: string;
  wasm: Uint8Array;
}
function buildApp(read: (path: string) => Promise<string>, options?: BuildOptions): Promise<BuiltApp>
```

`read` は、`app.json` を置いた場所からの相対パスを受けて、そのファイルの中身を返す関数です。取り方（`fetch`、`node:fs` など）は呼ぶ側が決めます。

1. `read("app.json")` を `parseAppManifest` で読む（誤りは `BinetteError`）
2. `entry.html` と `entry.as` のパスを整える（`./` と途中の `../` を畳む）。`/` で始まる、`\` を含む、`%` を含む（`%2e%2e` は URL で読むと `..` になるため）、`https:` のようなスキームで始まる、`app.json` のフォルダの外に出る、のどれかなら `アプリの入口は app.json のフォルダ内の相対パスにしてください。` の `Error`。`entry.as` のファイル名が `bina.ts` なら `entry.as に bina.ts という名前は使えません。bina.ts は HTML から自動生成するファイルです。` の `Error`
3. `parser` を決める。省略されていて `globalThis.DOMParser` も無ければ `HTML を読む DOMParser がありません。parser を指定してください。` の `Error`
4. HTML と AS を並べて読む
5. HTML を `parseBindings` で読み（名前の誤りは `Error`）、`generateBindingsSource` で `bina.ts` のソースを作る
6. asc で AS を WASM にビルドする（下の「asc の呼び方」と「ファイルの解決」）
7. WASM を `WebAssembly.compile` し、`bindings.clicks` の関数名がすべて export された関数にあるか確かめる。無ければ `アプリをビルドできません。クリックで呼ぶ関数が export にありません: <名前>、<名前>` の `Error`
8. `{ manifest, html, wasm, bindings }` を返す

- `read` が reject したら、そのまま reject します
- `entry.css` は読みません
- ビルドに失敗したら、`Error` を投げます。`message` は `アプリをビルドできません。` の次の行に asc の出力を続けたものです。出力は標準エラー、それが空なら標準出力、それも空なら asc の `error.message` で、前後の空白を除きます。AS の型の誤りなら `TS2322` などのコードを含みます
- `app.json` の `binette`・`build` はまだ見ません。asc はいつも Scene が依存している版（`0.28.20`）です

### asc の呼び方

```ts
await asc.main([entry, "--outFile", "main.wasm", "--optimizeLevel", "2", "--exportStart", "_start"], {
  readFile, writeFile, listFiles: () => [], stdout, stderr,
});
```

- 入口には、整えた `entry.as` のパス（例 `src/main.ts`）をそのまま渡します。asc の誤りの出力にも、そのパスが出ます
- `--exportStart _start` は、トップレベルの初期化を Régie が instance を作ったあとに走らせるためです（[regie.md](regie.md#ビルドのしかた)）
- ランタイムは asc の既定（`incremental`）です
- `writeFile` は `main.wasm` の中身（`Uint8Array`）だけを受け取り、ほかは捨てます
- 標準ライブラリは asc に入っているので、`readFile` で返す必要はありません

### ファイルの解決

asc はファイルを `readFile(name, baseDir)` で読みに来ます。Scene は次のように返します。

| `name` | 返すもの |
| --- | --- |
| `app.json` のフォルダの外に出るパス、`/` で始まるパスなど | `null`（読まない） |
| `entry.as` と同じパス | アプリの AS のソース（読み済みのもの） |
| `entry.as` と同じフォルダの `bina.ts` | 生成した `bina.ts`。アプリのフォルダに `bina.ts` があっても、生成したものを使う |
| `node_modules/<指定子>.ts` | `libraries[<指定子>]`（あれば） |
| `node_modules/<指定子>/index.ts` | `libraries[<指定子>]`（あれば） |
| そのほかの `.ts` で終わるパス | `read(パス)` の結果。reject したら `null` |
| それ以外（`asconfig.json` など） | `null`（無い） |

- `name` は 2 と同じやり方で整えてから比べます
- 読めないファイルに `null` を返すと、asc が「見つからない」（`TS6054`）誤りを出し、ビルドの誤りになります

- AS で `import { elem } from "jsr:@binette/replique"` と書くと、asc はこれをパッケージの import とみなし、`node_modules/jsr:@binette/replique.ts`、次に `node_modules/jsr:@binette/replique/index.ts` を読みに来ます。そこで `libraries["jsr:@binette/replique"]` を返すと解決します
- サブパス（`jsr:@binette/replique/glue` など）も、指定子をそのままキーにして引けます
- AS のファイルどうしの相対 import（`import { x } from "./util"`）は `read` で読むので使えます
- `libraries` に無い指定子は解決できず、ビルドの誤りになります
- Réplique はまだ公開していないので、今は呼ぶ側がワークスペースの `packages/replique/src/index.ts` の中身を渡します。将来は、`app.json` の `binette` の版に合う Réplique を Scene が JSR から取って差し込む（案。[app.md](app.md#インストール案)）

## HTML の名前の木

次のことを決めました（決定 2026-10-26、のぞみ）。

- HTML は、ビルドの前に解析して「名前の木」にする
- 名前と要素の種類から AS の型（`bina.ts`）を作り、エディタの補完と、ビルドでの名前の検査を効かせる

今の木は平らな一覧（名前 → 数と種類）です。一覧の行（`bina-each` にあたるもの）を入れるときに、入れ子を持たせます（案）。

### parseBindings（実装済み）

```ts
/** DOMParser の形。本番はブラウザ、テストと CLI は happy-dom を使う */
interface HtmlParser { parseFromString(html: string, type: "text/html"): Document }
interface BindingKind { tag: string; type?: string }
interface Bindings {
  /** 名前ごとの要素数と、出てきた順の種類（重複なし） */
  elements: Record<string, { count: number; kinds: BindingKind[] }>;
  /** bina-on-click に書いた関数名（重複なし、出てきた順） */
  clicks: string[];
}
function parseBindings(html: string, parser: HtmlParser): Bindings
```

- `parser.parseFromString(html, "text/html")` で読み、`[bina], [bina-on-click]` の要素を文書の順に見ます
- `kinds` の `tag` は小文字のタグ名です。`input` のときだけ `type`（小文字。属性が無ければ `"text"`）を持ちます
- 同じ名前に種類の違う要素があっても誤りにしません（`kinds` に並べるだけ）。今の操作は `text` だけで、どの要素にも使えるためです
- `elements` はプロトタイプの無いオブジェクトです（`toString` のような名前も入れられるように）

名前の検査（`bina` と `bina-on-click` の両方）。使えない名前は、`bina の名前「x」は使えません。<理由>。`（`bina-on-click` なら `bina-on-click の名前…`）の `Error` です。

| 条件 | 理由 |
| --- | --- |
| `/^[A-Za-z_$][A-Za-z0-9_$]*$/` に合わない（空、数字始まり、`-` を含む など） | `AS の識別子の形ではありません` |
| JS・TS の予約語と文脈キーワード、AS の型名（`i32`・`string` など） | `予約語または型名です` |
| `__` で始まる | `__ で始まる名前は自動生成用です` |
| `bina` の名前が `elem` | `elem は自動生成ファイルの import に使います` |
| `bina-on-click` の名前が `_start` | `_start はビルドの初期化に使います` |

予約語の一覧は `packages/scene/src/bindings.ts` にあります。

### bina.ts（実装済み）

`generateBindingsSource(bindings)` は、名前を辞書順に並べた次の AS のソースを作ります。末尾の改行は 1 つです。名前が無ければ、コメントと import だけです。

```ts
// bina.ts（HTML から自動生成。手で書き換えない）
import { elem } from "jsr:@binette/replique";

export const count = elem("count");
```

アプリは次のように書けます。`elem("count")` も今までどおり使えます。

```ts
import { count } from "./bina";
count.text = "1";
```

- HTML に無い名前を `./bina` から import すると、ビルドの誤りになります（名前の打ち間違いが分かる）
- `entry.as` を `bina.ts` という名前にはできません。生成したファイルが入口を上書きしてしまうため、`buildApp` も書き出しコマンドも誤りにします
- 種類ごとの型（入力欄の `value`、チェックボックスの `checked` など）は、それらの操作を足すときに作ります（案）。そのときは、`kinds` に合わせて `elem()` ではなく種類ごとのクラスを返し、合わない操作をビルドの誤りにします

### 書き出しコマンド

エディタで補完を効かせるには、`bina.ts` がアプリのフォルダに要ります。そのためのコマンドです（実装済み）。

```sh
deno run -A jsr:@binette/scene/cli <アプリのフォルダ>
```

- `app.json` を読み、HTML を happy-dom の DOMParser で `parseBindings` し、`entry.as` と同じフォルダに `bina.ts` を書きます。書いたパスを表示します
- 誤りは標準エラーに `bina.ts を書き出せません。<理由>` と出し、終了コード 1 で終わります
- 関数としては `writeBindings(dir: string): Promise<string>`（書いたパスを返す）です
- ワークスペースでは `deno task gen:counter` で `examples/counter` に書き出します

運用（案）:

- ファイル名は `bina.ts`。生成したものはアプリのリポジトリにコミットする（エディタで補完が効くように）
- ビルドはいつも HTML から作り直すので、コミットした `bina.ts` が古くても、ビルドの結果には影響しない。古いと補完がずれるだけ
- `examples/counter/src/bina.ts` が HTML と一致しているかは、テストで確かめている

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
3. Régie の `launchApp(built.wasm, …)` でアプリを起動する。`onText` を下の `bina` につなぐ
4. `element` に `click` のリスナーを 1 つ付ける（下の `bina-on-click`）
5. `app.exports` に `start` があれば `app.call("start")` を待つ。失敗したら `stop()` してから同じエラーで reject する
6. `{ app, stop }` で解決する

- 起動（3）に失敗したら、そのエラーで reject します。描いた HTML はそのまま残ります
- `stop()` はリスナーを外し、`app.stop()` を呼びます。描いた HTML は消しません
- DOM はグローバルの `document` を使わず、`element` から辿ります（テストで happy-dom を使うため）

### HTML とアプリのつなぎ方

次のことを決めました（決定 2026-10-26）。

- HTML では、要素に `bina="名前"` で名前を付ける。アプリ（AS）は `elem("名前")` でその要素を操作する
- 同じ名前の要素はまとめて変わる（見出しと本文に同じ件数を出す、など）
- 名前を探すのは、そのアプリの領域（`mountApp` の `element`）の中だけ。フロントやほかのアプリの要素には届かない
- Binette の属性の接頭辞は `bina`。`data-*`・`id`・`class` はアプリが自由に使える

```html
<h1 bina="count">0</h1>
<p>いま <span bina="count">0</span> 件</p>
<button bina-on-click="increment">+1</button>
```

| HTML | アプリ側（Réplique） | 意味 | 状態 |
| --- | --- | --- | --- |
| `bina="name"` | `elem("name").text = "…"` | 文字を書き換える | 実装済み |
| `bina="name"` | `elem("name").text` | アプリが最後に書いた文字を読む | 実装済み |
| `bina-on-click="fn"` | `export function fn(): void` | クリックで `fn()` | 実装済み |
| `bina="name"` | `elem("name").show = true` | 表示・非表示 | 案 |
| `bina="name"` | `elem("name").enabled = false` | 有効・無効 | 案 |
| `bina="name"` | `elem("name").value` | 入力欄の値の読み書き | 案 |
| `bina="list"` ＋ `<template>` | `list("list").add()` などで行を足し、行から `item.elem("…")` | 一覧の繰り返し | 案 |
| `bina-on-input="fn"` | `export function fn(value: string): void` | 入力で `fn(値)` | 案 |
| `bina-on-submit="fn"` | `export function fn(): void` | 送信で `fn()`（ページ移動はしない） | 案 |

- 一覧の中のイベントは、その行のキーを引数で渡す（案）

`bina="name"`（実装済み）:

- アプリが `elem(name).text = value` と書くと、Régie から Scene に届き、`element` の中の `bina` を持つ要素のうち、属性の値が `name` と完全に一致するものすべての `textContent` を `value` にします
- 一致する要素が無ければ何もしません。HTML に最初から書いた文字（カウンターの `0` など）は、アプリが書くまでそのまま出ます
- `element` の外にある、同じ名前の要素は変えません

`bina-on-click`（実装済み）:

- `element` で受けたクリックの `event.target` から `closest("[bina-on-click]")` で要素を探します。要素が `element` の中にあり、属性の値が空でなければ、その値の名前で `app.call(name)` を呼びます
- 既定の動作（リンクの移動、フォームの送信など）は止めません
- 呼び出しが失敗したら `onError` に渡します。Régie が `onError` で知らせたエラーと同じものは、二度は渡しません

### 読める値（案）

アプリは Worker の中にいて、画面（DOM）にその場で聞くことはできません。読めるのは「アプリの手元に写しがある値」だけです。

- アプリが自分で書いた値（`text` など）: Réplique が書くときに覚えておく（`text` は実装済み）
- 入力欄の値（`value`）: 入力のたびに Scene が Régie を通して値を送り、Réplique が覚えておく。Worker はメッセージを順に処理するので、ボタンを押したときには、それより前の入力はもう届いている
- 要素の大きさや位置など、写しの無い値: 「終わったら呼ぶ関数」を渡して受け取る。AS には Promise・async・クロージャが無いため（[replique.md](replique.md#結果を受け取る呼び出し案)）

### 止める操作（案）

`elem()` からできる操作は、Binette が決めた一覧だけにします。次のような危ない操作は用意しません。

- HTML の差し込み（`innerHTML` にあたるもの）。文字は `textContent` で入れる
- `on*` 属性（`onclick` など）を付けること
- 外の URL を `src`・`href`・CSS の `url()` に入れること

### まだしていないこと

- HTML の検証（`<script>`・`on*` 属性・外部 URL が無いこと、`bina-on-*` の名前が export にあること）。今は `innerHTML` にそのまま入れます。`<script>` は `innerHTML` では実行されませんが、`on*` 属性は動きます
- `entry.css` の読み込みと、テーマの CSS 変数
- Shadow DOM などでの、フロントの CSS とアプリの CSS の分離

## デモ（実装済み）

`deno task demo:scene` で、Vite の dev サーバーを Deno から http://localhost:5175/ に起動します。

- ワークスペースのパッケージ（`@binette/core`・`@binette/regie`・`@binette/scene`）は、Vite の `resolve.alias` でソースに向けています
- Vite の `publicDir` をリポジトリの `examples/` にしてあり、`/counter/app.json` などを GET で取ります
- Réplique のソースは `packages/replique/src/index.ts?raw` で読み、`libraries` に渡します
- `loadCompiler()` と `buildApp()` の時間を別々に測って出します
