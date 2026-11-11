# Régie: ビルド

[Régie の目次](README.md)

アプリの AS を WASM にし、インストールできる形にする部分です。どのコードを動かしてよいかの検証もここに足していきます（現在は保存前に ABI の import を検査します。[下](#検証案)）。ビルドはカーネルの仕事とします（のぞみ 2026-10-28）。実装は `packages/regie/src/build.ts`・`prebuilt.ts`・`paths.ts`・`cli.ts` にあります。

## ブラウザでのビルド（案）

`buildAppInWorker` は目録で検証した `/system/tools/asc.js` と `/system/libraries/replique/index.json` （機能名 → 完全なパッケージ版）と同フォルダの `index.ts`・各機能の `.ts` を受け取り、独立した module Worker で `buildApp` を実行します。検証した asc のバイトから Worker 内で Blob URL を作って読み、URL を再取得しません。Décor の AS ソースは既存の `buildApp` が渡します。呼び出し側はソースを読む関数と `SystemDistribution` を渡し、Worker の URL・時間切れ・中止などを指定できます。`libraries` で Réplique を含むライブラリを指定できます。

`buildStoredApp` はアプリ所有領域の `/source`、無ければ `/apps/<id>/` のソースを読みます。ID と `app.json` の一致、および ABI の対応を確かめてから、所有領域の `/build/app.wasm`・`index.html`・AppStore の記録をまとめて保存します。`storage` のない FileTree では `/apps/<id>/build/` と起動記録を保存します。既存の `startSystem` のソースを読む経路にも、`browserBuild` を指定すると Worker を使えます。この `read` 経路は従来どおりソースを自動保存しないため、ファイルの木に置く操作は呼び出し側が行います。現在の OS の起動側は検証済みの配布物を使う `browserBuild` を渡します。システムアプリのビルド済み WASM はこの経路を通しません。パス、API、インストール時にソースをどのように取得するかは案です。

## 旧 ABI のアプリの復旧

### 起動時の自動復旧（決定）

- 通常起動・Cadre の起動・予定の画面なし起動で、実行前の ABI 検査が `unsupported_abi` のときだけ、保存ソースからの自動再ビルドを試します。ABI が対応している場合や、WASM 自体が壊れている場合は再ビルドしません。
- 対象は同じ親アプリ所有領域の `/source/app.json` を含む保存ソースです。別の入手元や `/apps/<id>/` の開発用ソースを代用せず、ネットワークからソースを取り直しません。`browserBuild` が無い利用者や、ソースを保存していないシステム・同梱アプリでは従来どおり起動エラーになります。
- `buildStoredApp` と共通の準備処理で、現在の検証済み SDK と asc を使ってビルドし、新しい WASM の ABI を検査します。保存済み manifest とも一致することを確認してから、`AppStore.replace` で開始時の記録・WASM がまだ一致する場合だけ成果物と記録を一括置換し、通常の起動を続けます。データ・保存ソース・許可済み権限・役割割り当て・インストール日時・提供リストの版を保ちます。manifest が異なる場合は、権限確認を省略した更新にならないよう自動復旧しません。
- 再ビルド中の手動削除・更新・入れ直しが先に保存されたら、遅れて完成した成果物は保存しません。`AppStore.replace` は既存の保存キューに入り、所有領域の `writeFilesIfUnchanged` が現在の記録・WASM の実バイトの比較と一括置換を同じ排他区間で行います。比較後に別の保存ハンドルで変更されても拒否し、削除済み所有領域を割り当て直しません。メモリでは既存の直列化、ブラウザの IndexedDB/OPFS では DB ごとの既存の Web Lock で通常の書込み・削除と排他します。Web Lock が使えない IndexedDB 環境や、条件付き置換の無い独自の AppStore／OwnerStorage は自動復旧を行わず、既存の起動エラーへ戻します。手動操作の経路は変えません。
- 同じ親の同時起動はサブアプリも含めて 1 つの再ビルド Promise を共有します。成功後は起動候補の成果物も差し替え、開いているアプリ管理の写しを更新します。次の起動ではビルドしません。OS の停止ではビルドを中止します。
- 再ビルド中は Scene の既存のステータス表示と同じ配置・余白で「今の OS 向けに作り直しています」を表示します。エラーとは別の `role="status"` の要素で、全再ビルドが終わると消します。
- 提供リストからのインストール時に `integrity` を `InstalledApp.sourceIntegrity` として記録します。自動再ビルド前に、ビルドへ渡す保存ソースの同じ写しを core の `verifyIntegrity` で再検証します。明記されたファイル・フォルダ・全体のハッシュを既存の方法で計算し、不一致や欠損ならコンパイラを起動しません。ローカルのファイル一式はビルドに必要なため既に読むもので、再ハッシュの追加負担は小さいと判断しました。記録の無い過去のインストールは再検証できないため、そのまま保存ソースを使います。最新カタログの別の版のハッシュでは代用しません。
- ソースなし、整合性不一致、manifest 不一致、`unsupported_sdk`、再度の `unsupported_abi`、ビルド・保存エラーでは元の記録を残し、元の起動エラーに戻ります。アプリ管理の「この OS では動きません。入れ直してください」と手動の「入れ直す」は維持します。失敗後の次の起動では再試行できます。
- システム・同梱アプリは `deno task build:system` が現在の SDK で毎回ビルドします。`deno task build`・`deno task start` もこれを実行します。OS を更新して読み込み直すと、`startSystem` が配布されたビルド済みアプリを毎回入れ直すため、アプリの版が同じでも新しい WASM に置き換わります。
- 手動で提供リストのアプリを入れ直す場合も現在の SDK を使い、同じ ID のデータを引き継ぎます。JSR の SDK を使うソースなら再ビルドで新しい ABI になりますが、旧 module 名を `@external` に直書きしたソースは宣言の修正も必要です。
- 開発用 TS API の `buildStoredApp` は従来どおり所有領域の `/source`、無ければ `/apps/<id>/` を読み、ABI の検査に通ってからソースと成果物を保存します。`startSystem` の開発用 `read` 入力は未インストールか版が変わったときにビルドしますが、ソースは自動保存しません。

ABI の検査は提供リストの準備時、`startSystem` が新しい成果物を保存する前、`buildStoredApp` と自動再ビルドの保存前、Worker の instantiate 前に行います。未対応の成果物で既存のアプリ・ソース・データを上書きしません。`AppStore.put` は保存層なので検査せず、別の保存実装を使う場合もインストール側と起動側で検査します。`HOST_ABI`・OS call・権限と役割の判定は変えず、旧 ABI の互換提供はしません。

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
| `/node_modules/<指定子>.ts`・`~lib/<指定子>.ts` と各 `index.ts` | ブラウザ向け asc が要求するライブラリも同じ辞書から返す |
| そのほかの `.ts` で終わるパス | `read(パス)` の結果。reject したら `null` |
| それ以外（`asconfig.json` など） | `null`（無い） |

- `name` は 2 と同じやり方で整えてから比べます
- 読めないファイルに `null` を返すと、asc が「見つからない」（`TS6054`）誤りを出し、ビルドの誤りになります

- AS で `import { document } from "jsr:@binette/replique"` と書くと、asc はこれをパッケージの import とみなし、`node_modules/jsr:@binette/replique.ts`、次に その指定子に対応する `index.ts` を読みに来ます。そこで `libraries["jsr:@binette/replique"]` を返すと解決します
- 各機能は `jsr:@binette/replique-ui@^0.1` のように版を指定できます。`jsr:@binette/replique-ui` のように版を省略すると提供中の完全な版へ解決し、版付きや旧入口と同じ実体を使います。`libraries` は完全な提供版（例: `jsr:@binette/replique-ui@0.1.0`）をキーに持ち、要求範囲をコンパイル前に照合します。exact・`^`・`~` を受け入れ、未対応・未知・不正な要求は `unsupported_sdk` で拒みます（[範囲とエラーの詳細](../replique.md#機能ごとの構成決定)）
- 旧 `jsr:@binette/replique/<機能名>` は互換入口として、同じ提供版の新パッケージへ解決します。アプリの原文を書き換えずにビルドでき、旧入口と新入口の状態は共有します
- AS のファイルどうしの相対 import（`import { x } from "./util"`）は `read` で読むので使えます
- `libraries` に無い指定子は解決できず、ビルドの誤りになります
- CLI は `packages/replique` の集約パッケージと各機能パッケージの設定・ソースを読みます。ブラウザは `/system/libraries/replique/index.json` の機能名 → 完全な版の辞書と、検証済みの各ソースを使います。要求した版をネットワークから追加取得することはありません

## 書き出し（実装済み）

システムアプリと同梱アプリは、1 アプリ 1 ファイルの `.binapp`（JSON）にします。

| 欄 | 内容 |
| --- | --- |
| `format` | `"binette-app"` |
| `version` | 形式の版 `"0.2"` |
| `manifest` | app.json のオブジェクト |
| `html` | HTML の文字列 |
| `css` | CSS の文字列。無ければ欄なし |
| `icon` | SVG の文字列。無ければ欄なし |
| `subIcons` | サブアプリの識別子から SVG の文字列への写し。無ければ欄なし |
| `wasm` | WASM のバイト列を base64 にした文字列 |

公開する `PrebuiltApp` は `{ manifest: AppManifest; html: string; css?: string; icon?: string; subIcons?: Record<string, string>; wasm: Uint8Array }` です。`stringifyPrebuiltApp(app): string` は JSON を作り、`parsePrebuiltApp(text): PrebuiltApp` は形式名・版・欄の型・base64 を確かめて戻します。manifest は core の `parseAppManifest` と同じ検査を通します。誤りは日本語の `Error` です。HTML や WASM の安全性の検証はしません。

```sh
deno run -A packages/regie/src/cli.ts build apps/cadre --out .binapp/system/cadre.binapp --replique packages/replique
```

CLI は `packages/regie/src/cli.ts`（入口 `@binette/regie/cli`）にあります。CLI は `buildApp` を呼び、親とサブアプリの SVG も読んで書き出します。アイコンのパスはインストールと共通の `iconPath` で確かめます。親フォルダは作成し、出力先があれば上書きします。成功時は絶対パスを標準出力に出します。誤りは標準エラーに `.binapp を書き出せません。<理由>` と出し、終了コード 1 で終わります。従来の引数 1 つによる生成モード、writeBindings、--bindings、gen:bindings は廃止しました（案・実装済み）。

`deno task build:system`（`scripts/build-system.ts`）は `apps/` の直下で `app.json` を持つフォルダを全部見つけ、`.binapp/system/<フォルダ名>.binapp` に書き出します。同じ処理で `bundled/` から `.binapp/bundled/<フォルダ名>.binapp` も作り、空の `bundled/` でも成功します。app.json の無いフォルダは無視します。各出力先と移行前の `.binapp/` 直下の古い `.binapp` は書き出す前に消し、失敗時はフォルダ名を出して終了コード 1 にします。フォルダ名は UTF-16 コード単位の辞書順（`<`・`>`）で比べます。このフォルダは gitignore に入れ、生成物はコミットしません。`deno task start` と `deno task build` は先にこのタスクを実行します。Binette は Vite の `import.meta.glob` で同梱した `.binapp` を fetch し、ブラウザでは asc を読みません。

## 入口（実装済み）

asc は大きいので、ビルドは `@binette/regie/build` という別の入口から公開します。CLI は `@binette/regie/cli` です。`@binette/regie` の本体だけを読む利用者（ビルド済みの `.binapp` だけを使う OS など）は asc を読みません。今も `loadCompiler` は初回だけ dynamic import するので、ビルドしなければ読み込みません。

## 検証（案）

今のビルドは、AS をコンパイルして Réplique の入口を足すだけです。アプリの安全は、Worker の隔離と、Régie が渡す呼び出しの一覧（[run.md](run.md#import)）で守っています。次の検証は、ここに足します。どれも未着手です。

- HTML: `script`、`on*` 属性、外の URL を含む場合にビルド時に警告するか。描画時には Scene が取り除く（[mount.md](../scene/mount.md#最初の-html案実装済み)）
- 権限: `app.json` の `permissions` と、使う呼び出しが合うか
- 入手元: ハッシュやコミットの記録（[app.md](../app.md#régie-が記録するもの案)）

## 宣言的 UI（案）

`entry.html` を省いたアプリは [宣言的 UI](../ui.md) を使います。`libraries` には `jsr:@binette/replique` と各機能の指定子を渡します。`jsr:@binette/replique-ui@^0.1` も実際の `ui.ts` を使い、ビルド側で再 export のソースを補いません。
