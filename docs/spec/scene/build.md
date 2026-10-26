# Scene: ビルド

[Scene の目次](README.md)

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

`read` は、`app.json` を置いた場所からの相対パスを受けて、そのファイルの中身を返す関数です。取り方（`fetch`、`Deno.readTextFile` など）は呼ぶ側が決めます。

1. `read("app.json")` を `parseAppManifest` で読む（誤りは `BinetteError`）
2. `entry.html` と `entry.as` のパスを整える（`./` と途中の `../` を畳む）。`/` で始まる、`\` を含む、`%` を含む（`%2e%2e` は URL で読むと `..` になるため）、`https:` のようなスキームで始まる、`app.json` のフォルダの外に出る、のどれかなら `アプリの入口は app.json のフォルダ内の相対パスにしてください。` の `Error`。`entry.as` のファイル名が `bina.ts` なら `entry.as に bina.ts という名前は使えません。bina.ts は HTML から自動生成するファイルです。` の `Error`
3. `parser` を決める。省略されていて `globalThis.DOMParser` も無ければ `HTML を読む DOMParser がありません。parser を指定してください。` の `Error`
4. HTML と AS を並べて読む
5. HTML を `parseBindings` で読み（名前の誤りは `Error`）、`generateBindingsSource` で `bina.ts` のソースを作る（詳しくは [bindings.md](bindings.md)）
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
- `--exportStart _start` は、トップレベルの初期化を Régie が instance を作ったあとに走らせるためです（[regie.md](../regie.md#ビルドのしかた)）
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
- Réplique はまだ公開していないので、今は呼ぶ側がワークスペースの `packages/replique/src/index.ts` の中身を渡します。将来は、`app.json` の `binette` の版に合う Réplique を Scene が JSR から取って差し込む（案。[app.md](../app.md#インストール案)）

