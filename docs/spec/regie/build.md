# Régie: ビルド

[Régie の目次](README.md)

アプリの AS を WASM にし、インストールできる形にする部分です。どのコードを動かしてよいかの検証もここに足していきます（今は検証をしていません。[下](#検証案)）。ビルドはカーネルの仕事とします（のぞみ 2026-10-28）。実装は `packages/regie/src/build.ts`・`prebuilt.ts`・`paths.ts`・`cli.ts` にあります。

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

`Compiler` は asc の型を使わず、Régie が使う分だけを自分で書いた型です。asc の型定義に頼ると、利用者の型検査に asc の大きな型定義が入るためです。

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

`read` は、`app.json` を置いた場所からの相対パスを受けて、そのファイルの中身を返す関数です。取り方（`fetch`、`Deno.readTextFile` など）は呼ぶ側が決めます。

1. `read("app.json")` を parseAppManifest で読む（誤りは BinetteError）
2. 入口のパスを整える。絶対パス・スキーム・バックスラッシュ・%・フォルダ外は拒む
3. `entry.html` があれば HTML と AS を読み、省略時は空の HTML と AS を使う（案）
4. AS の末尾に `\nexport { __bina_event, __bina_lifecycle, __bina_ui_event, __bina_ui_text, __bina_ui_value } from "jsr:@binette/replique";\n` を足す。元の行番号は変えない（案・実装済み）
5. asc でビルドし `{ manifest, html, wasm }` を返す

`bina.ts` の生成を無くすのは決定 2026-10-27 です。HTML の解析、クリック関数の export 検査、BuiltApp.bindings、BuildOptions.parser と ShellOptions.parser、HtmlParser、deno-dom の依存を無くしました（案・実装済み）。入口に bina.ts というファイル名も使えます。

- `read` が reject したら、そのまま reject します
- `entry.css` は読みません
- ビルドに失敗したら、`Error` を投げます。`message` は `アプリをビルドできません。` の次の行に asc の出力を続けたものです。出力は標準エラー、それが空なら標準出力、それも空なら asc の `error.message` で、前後の空白を除きます。AS の型の誤りなら `TS2322` などのコードを含みます
- `app.json` の `binette`・`build` はまだ見ません。asc はいつも Régie が依存している版（`0.28.20`）です

### asc の呼び方

```ts
await asc.main([entry, "--outFile", "main.wasm", "--optimizeLevel", "2", "--exportStart", "_start", "--exportRuntime"], {
  readFile, writeFile, listFiles: () => [], stdout, stderr,
});
```

- 入口には、整えた `entry.as` のパス（例 `src/main.ts`）をそのまま渡します。asc の誤りの出力にも、そのパスが出ます
- `--exportStart _start` は、トップレベルの初期化を Régie が instance を作ったあとに走らせるためです（[run.md](run.md#ビルドのしかた)）
- `--exportRuntime` は、Régie が `__new` で AS の文字列を確保して返すためです
- ランタイムは asc の既定（`incremental`）です
- `writeFile` は `main.wasm` の中身（`Uint8Array`）だけを受け取り、ほかは捨てます
- 標準ライブラリは asc に入っているので、`readFile` で返す必要はありません

### ファイルの解決

asc はファイルを `readFile(name, baseDir)` で読みに来ます。Régie は次のように返します。

| `name` | 返すもの |
| --- | --- |
| `app.json` のフォルダの外に出るパス、`/` で始まるパスなど | `null`（読まない） |
| `entry.as` と同じパス | アプリの AS のソースにイベントとライフサイクルの再 export を末尾追加したもの |
| `node_modules/<指定子>.ts` | `libraries[<指定子>]`（あれば） |
| `node_modules/<指定子>/index.ts` | `libraries[<指定子>]`（あれば） |
| そのほかの `.ts` で終わるパス | `read(パス)` の結果。reject したら `null` |
| それ以外（`asconfig.json` など） | `null`（無い） |

- `name` は 2 と同じやり方で整えてから比べます
- 読めないファイルに `null` を返すと、asc が「見つからない」（`TS6054`）誤りを出し、ビルドの誤りになります

- AS で `import { document } from "jsr:@binette/replique"` と書くと、asc はこれをパッケージの import とみなし、`node_modules/jsr:@binette/replique.ts`、次に `node_modules/jsr:@binette/replique/index.ts` を読みに来ます。そこで `libraries["jsr:@binette/replique"]` を返すと解決します
- サブパス（`jsr:@binette/replique/glue` など）も、指定子をそのままキーにして引けます
- AS のファイルどうしの相対 import（`import { x } from "./util"`）は `read` で読むので使えます
- `libraries` に無い指定子は解決できず、ビルドの誤りになります
- Réplique はまだ公開していないので、今は呼ぶ側がワークスペースの `packages/replique/src/index.ts` の中身を渡します。将来は、`app.json` の `binette` の版に合う Réplique を Régie が JSR から取って差し込む（案。[app.md](../app.md#インストール案)）

## 書き出し（実装済み）

システムアプリと同梱アプリは、1 アプリ 1 ファイルの `.binapp`（JSON）にします。

| 欄 | 内容 |
| --- | --- |
| `format` | `"binette-app"` |
| `version` | 形式の版 `"0.2"` |
| `manifest` | app.json のオブジェクト |
| `html` | HTML の文字列 |
| `icon` | SVG の文字列。無ければ欄なし |
| `wasm` | WASM のバイト列を base64 にした文字列 |

公開する `PrebuiltApp` は `{ manifest: AppManifest; html: string; icon?: string; wasm: Uint8Array }` です。`stringifyPrebuiltApp(app): string` は JSON を作り、`parsePrebuiltApp(text): PrebuiltApp` は形式名・版・欄の型・base64 を確かめて戻します。manifest は core の `parseAppManifest` と同じ検査を通します。誤りは日本語の `Error` です。HTML や WASM の安全性の検証はしません。

```sh
deno run -A packages/regie/src/cli.ts build apps/settings --out .binapp/system/settings.binapp --replique packages/replique/src/index.ts
```

CLI は `packages/regie/src/cli.ts`（入口 `@binette/regie/cli`）にあります。CLI は `buildApp` を呼び、SVG も読んで書き出します。アイコンのパスはインストールと共通の `iconPath` で確かめます。親フォルダは作成し、出力先があれば上書きします。成功時は絶対パスを標準出力に出します。誤りは標準エラーに `.binapp を書き出せません。<理由>` と出し、終了コード 1 で終わります。従来の引数 1 つによる生成モード、writeBindings、--bindings、gen:bindings は廃止しました（案・実装済み）。

`deno task build:system`（`scripts/build-system.ts`）は `apps/` の直下で `app.json` を持つフォルダを全部見つけ、`.binapp/system/<フォルダ名>.binapp` に書き出します。同じ処理で `bundled/` から `.binapp/bundled/<フォルダ名>.binapp` も作り、空の `bundled/` でも成功します。app.json の無いフォルダは無視します。各出力先と移行前の `.binapp/` 直下の古い `.binapp` は書き出す前に消し、失敗時はフォルダ名を出して終了コード 1 にします。フォルダ名は UTF-16 コード単位の辞書順（`<`・`>`）で比べます。このフォルダは gitignore に入れ、生成物はコミットしません。`deno task start` と `deno task build` は先にこのタスクを実行します。Binette は Vite の `import.meta.glob` で同梱した `.binapp` を fetch し、ブラウザでは asc を読みません。

## 入口（実装済み）

asc は大きいので、ビルドは `@binette/regie/build` という別の入口から公開します。CLI は `@binette/regie/cli` です。`@binette/regie` の本体だけを読む利用者（ビルド済みの `.binapp` だけを使う OS など）は asc を読みません。今も `loadCompiler` は初回だけ dynamic import するので、ビルドしなければ読み込みません。

## 検証（案）

今のビルドは、AS をコンパイルして Réplique の入口を足すだけです。アプリの安全は、Worker の隔離と、Régie が渡す呼び出しの一覧（[run.md](run.md#import)）で守っています。次の検証は、ここに足します。どれも未着手です。

- HTML: `script`、`on*` 属性、外の URL を含む場合にビルド時に警告するか。描画時には Scene が取り除く（[mount.md](../scene/mount.md#最初の-html案実装済み)）
- 権限: `app.json` の `permissions` と、使う呼び出しが合うか
- 入手元: ハッシュやコミットの記録（[app.md](../app.md#régie-が記録するもの案)）

## 宣言的 UI（案）

`entry.html` を省いたアプリは [宣言的 UI](../ui.md) を使います。`libraries` の `jsr:@binette/replique` があれば、`jsr:@binette/replique/ui` を省略しても自動的に解決します。明示した場合はそのソースを使います。
