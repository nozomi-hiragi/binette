# @binette/regie

[仕様の目次](README.md)

Régie（レジ、操作室）はカーネルです。アプリの WASM を Worker で動かし、アプリからの呼び出しを受けます。画面は持ちません。`@binette/core` の型を使います。

## 役割（案）

- アプリの実行（Worker ＋ WASM）
- 権限の判断。システムアプリ `apps/settings` から、アプリごとに権限を取り消せる
- アプリごとのストレージ。ほかのアプリからは読めない。容量の上限を持つ
- インストール済みアプリの保存（実装済み。下の `AppStore`）。ハッシュや権限の記録はまだ無い
- アプリのデータは、アプリごとにまとめて書き出せる形で持つ。バックアップのときは、それを Coulisses に送る
- 動いているアプリの数に上限を持ち、裏に回ったアプリは止められる。状態はストレージから戻す前提にする
- アプリは Régie が渡した呼び出ししか使えない。ネットワークや DOM に直接は触れない

今のコードには、アプリの実行、文字・一覧・行のアイコン・ホーム用の呼び出しの受け口、インストール済みアプリの保存があります（実装済み、呼び出しの形は案）。

## 実行の流れ（実装済み）

```
メインスレッド（launchApp）              Worker（serveApp）
  ── init { wasm, apps? } ─────────────────→  WebAssembly.instantiate
                                        _start があれば呼ぶ（トップレベルの初期化）
  ←──────────── text { name, value } ─  （初期化中の elem.text）
  ←──────────── ready { exports } ────  export された関数名を返す
  launchApp が解決する
  ── call { id, name, arg? } ─────────────→  exports[name](arg?) を呼ぶ
  ←──────────── text { name, value } ─  （呼び出し中の elem.text）
  ←──────────── done { id } ──────────  呼び終えた
  call が解決する
```

- 1 つの Worker で 1 つのアプリを動かします
- `start()` は Régie からは呼びません。呼ぶのは Scene です（[scene/mount.md](scene/mount.md#mountapp)）。Scene が HTML を描き終えてから呼ぶためです
- メッセージは届いた順に処理されます。呼び出し中の `text` は、その呼び出しの `done` より先に届きます

## API（実装済み）

### launchApp

```ts
function launchApp(wasm: Uint8Array | ArrayBuffer, options?: LaunchOptions): Promise<RegieApp>
```

アプリの WASM を Worker で起動します。

1. `options.createWorker` で Worker を作る。省略すると、下の「Blob URL の Worker」を作る
2. Worker の `message` を受け始めてから、`{ type: "init", wasm, apps? }` を送る。`wasm` は写しを作って transfer する（`Uint8Array`（大きなバッファの一部を見るものを含む）なら `new Uint8Array(wasm).buffer`、`ArrayBuffer` なら `wasm.slice(0)`）。呼び出し側のバッファは変わらない。`postMessage` が投げたら、Worker を止め（`stop()` と同じ）、そのエラーで reject する
3. `ready` が来たら `RegieApp` で解決する
4. `failed` が来たら Worker を止め（`stop()` と同じ）、`failed` の `message` を持つ `Error` で reject する

- WASM の作り方は [WASM の約束](#wasm-の約束実装済み) に合わせます
- Worker の `error`・`messageerror`、アプリの中の例外では、アプリが終了したものとして Worker を止めます。ready 前なら起動を reject し、ready 後なら待っている call をすべて同じ Error で reject して `onExit` を 1 回呼びます。以後の call は `アプリは止まっています。` で reject します
- `error` の文は `アプリが落ちました: <message>`。message が無ければ `アプリが落ちました。` です。`messageerror` は `アプリとのやりとりに失敗しました。` です
- 無限ループの時間切れは未決です

### LaunchOptions

```ts
interface LaunchOptions {
  /** アプリが要素の文字を書き換えたとき（elem(name).text = value） */
  onText?: (name: string, value: string) => void;
  apps?: { id: string; name: string }[];
  onListAdd?: (list: string, row: number) => void;
  onListClear?: (list: string) => void;
  onItemText?: (list: string, row: number, name: string, value: string) => void;
  onItemIcon?: (list: string, row: number, app: number) => void;
  onOpen?: (i: number) => void;
  /** アプリを終了しない呼び出しの失敗 */
  onError?: (error: Error) => void;
  /** 起動後にアプリが終了したとき。stop や signal では呼ばない */
  onExit?: (error: Error) => void;
  /** Worker を作る関数。省略すると Blob URL の Worker */
  createWorker?: () => RegieWorker;
  /** 起動中でも Worker を止める */
  signal?: AbortSignal;
}
```

- `signal` が中断されたら Worker を止め、起動や呼び出しの待ちを reject する。中断済みなら Worker は作らない
- `onText` は `text` が届くたびに呼びます。`ready` より前（トップレベルの初期化）に届いたものも呼びます
- `onExit` は起動後にアプリが終了したときだけ呼びます。`stop()` や `signal` では呼びません
- `onError` は終了しない `fail` が届くたびに呼びます。`failed`（起動の失敗）では呼ばず、`launchApp` の reject だけで知らせます

### RegieWorker

```ts
interface RegieWorker {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener<K extends "message" | "error" | "messageerror">(type: K, listener: (event: K extends "error" ? ErrorEvent : MessageEvent) => void): void;
  terminate(): void;
}
```

ブラウザの `Worker` はこの形を持ちます。テストでは `MessageChannel` の片方を包んで渡します（`terminate` で両方の port を閉じる）。

### RegieApp

```ts
interface RegieApp {
  /** アプリが export している関数の名前。_start は含まない */
  readonly exports: readonly string[];
  /** export した関数を呼ぶ。終わったら解決する */
  call(name: string, arg?: number): Promise<void>;
  /** Worker を止める */
  stop(): void;
}
```

- `exports` は凍結した配列です。WASM の export のうち関数だけで、`_start` と `__` で始まるランタイムの関数を除きます。`memory` などは入りません
- `call(name, arg?)`:
  - 止めたあとに呼ぶと、`アプリは止まっています。` の `Error` で reject する（Worker には送らない）
  - 要求番号（1 から順に増える整数）を付けて `{ type: "call", id, name, arg }` を送り、同じ番号の `done` で解決、`fail` で reject する
  - `arg` があれば i32 の引数を 1 つ渡します。戻り値は返しません
- `stop()`: Worker を `terminate` し、待っている `call` をすべて `アプリを止めました。` の `Error` で reject します。2 回目からは何もしません

### serveApp

```ts
interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}
function serveApp(scope: WorkerScope): void
```

Worker の側の処理です。Worker の `self` か、テストでは `MessageChannel` の片方を渡します。

- `serveApp` は、外の import や関数を一切参照しない自己完結の関数です。`toString()` で取り出して Worker のソースにするためです。中で使う補助の関数も、中に書きます

### Blob URL の Worker

`createWorker` を省略すると、次の Worker を作ります。

```ts
const source = `(${serveApp.toString()})(self)`;
const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
const worker = new Worker(url); // classic Worker
URL.revokeObjectURL(url);
```

- ワーカーのファイルの置き場所に頼らないので、JSR から読んだ .ts をそのまま使う場合でも、バンドラーでまとめた場合でも、設定なしで動きます
- そのかわり、Content Security Policy を使うページでは `worker-src blob:` を許す必要があります
- Worker の作り方をこのままにするかは未決です

## メッセージ（実装済み）

メインスレッド → Worker:

| `type` | 欄 | 意味 |
| --- | --- | --- |
| `init` | `wasm: ArrayBuffer`, `apps?: { id: string; name: string }[]` | WASM を起動する。1 つの Worker に 1 回だけ送る |
| `call` | `id: number`, `name: string`, `arg?: number` | export の `name` を呼ぶ。arg があれば i32 を 1 つ渡す |

Worker → メインスレッド:

| `type` | 欄 | 意味 |
| --- | --- | --- |
| `ready` | `exports: string[]` | 起動できた。export された関数名（`_start` と `__` で始まる名前を除く） |
| `failed` | `message: string` | 起動できなかった。`message` は `アプリを起動できません: <理由>` |
| `text` | `name: string`, `value: string` | アプリが `elem(name).text = value` と書いた（import の `elem.text`） |
| `list.add` | `list: string`, `row: number` | 行を足す。番号は Worker が 0 から数える |
| `list.clear` | `list: string` | 全行を消し、番号を戻す |
| `item.text` | `list: string`, `row: number`, `name: string`, `value: string` | 行の文字 |
| `item.icon` | `list: string`, `row: number`, `app: number` | 行のアイコン |
| `apps.open` | `i: number` | アプリを開く |
| `done` | `id: number` | `call` を呼び終えた |
| `fail` | `id: number`, `message: string`, `exit?: boolean` | `call` が失敗した。`exit: true` ならアプリを終了する |

`fail` の `message`:

| 場合 | `message` | `exit` |
| --- | --- | --- |
| `init` より前に `call` が来た | `アプリがまだ起動していません。` | 無し |
| export に `name` が無いか、関数でない | `アプリに関数 <name> がありません。` | 無し |
| アプリが `abort` した（AS の `throw` を含む） | `アプリが中断しました: <メッセージ> (<ファイル>:<行>:<列>)`。ファイル名が無ければ括弧の部分を付けない | `true` |
| そのほかの例外（WASM の trap など） | 例外の `message` | `true` |

- export に `name` があるかは `Object.hasOwn(instance.exports, name)` で確かめます
- 起動の失敗（`failed`）になるのは、WASM のコンパイル・リンクの失敗（下の import 以外を求める WASM など）と、`_start` の中の例外です
- export 関数の実行中の例外（AS の abort/throw、WASM の trap、import の例外）は `exit: true` の fail を送り、以後の call を実行しません。メイン側は Worker を止め、onError は呼ばず onExit で知らせます。未起動と関数が無い場合の fail は終了せず、onError に知らせます

## WASM の約束（実装済み）

### ビルドのしかた

- AssemblyScript を `--exportStart _start --exportRuntime` でビルドします（Scene の `buildApp` がそうする。[scene/build.md](scene/build.md#buildapp)）
- `--exportStart` を付けると、トップレベルの初期化（グローバル変数の初期値、トップレベルの文）は WASM の start 節ではなく、export `_start` になります。Régie は instance を作り終えてから `_start` を呼びます。初期化の中で `elem(…).text` に書いても文字列を読めるようにするためです
- `_start` が無い WASM も起動できます（その場合は呼ばない）
- メモリは `memory` という名前で export されている必要があります（AS の既定）

### import

Régie が WASM に渡す import は次の表と、下の一覧・ホーム用の呼び出しです。ほかの import を求める WASM はリンクに失敗し、起動できません（`failed`）。

| モジュール | 名前 | 引数 | 内容 |
| --- | --- | --- | --- |
| `binette` | `elem.text` | `(name: i32, value: i32)` | 2 つとも AS の文字列のポインタ。読んで `text` を送る |
| `env` | `abort` | `(message: i32, fileName: i32, line: i32, column: i32)` | AS の `abort`。`message`・`fileName` は文字列のポインタで、`0` なら無し。例外を投げて、その呼び出しを止める |

- `binette` の import の名前は `<対象>.<操作>`（例: `elem.text`）にします。Réplique の書き込みの操作と 1 対 1 で対応します。読む操作（`Elem.text` の getter など）は Réplique の中で済むので、import はありません（[replique.md](replique.md#呼び出しの一覧)）

一覧・ホーム用の import（実装済み、形は案）:

| 名前（モジュールは `binette`） | 引数 → 戻り値 |
| --- | --- |
| `list.add` | `(name: i32) → i32` |
| `list.clear` | `(name: i32) → void` |
| `item.text` | `(list: i32, row: i32, name: i32, value: i32) → void` |
| `item.icon` | `(list: i32, row: i32, app: i32) → void` |
| `apps.count` | `() → i32` |
| `apps.name`・`apps.id` | `(i: i32) → i32`（文字列ポインタ） |
| `apps.open` | `(i: i32) → void` |

文字列の引数はすべて AS のポインタです。`apps` を渡したときだけ init に含め、Worker が同期で読みます。渡していないアプリの `apps.*` は `この呼び出しはホームのアプリだけが使えます。` の例外で失敗します。アプリ番号や行番号が範囲外でも例外です。各メッセージは対応する `onListAdd`・`onListClear`・`onItemText`・`onItemIcon`・`onOpen` に届きます。

### 文字列の読み方

AS の文字列は UTF-16LE で、ポインタ `ptr` の 4 バイト前に長さ（バイト数、u32、リトルエンディアン）があります。

```ts
const memory = instance.exports.memory as WebAssembly.Memory;
const length = new Uint32Array(memory.buffer, ptr - 4, 1)[0];
const text = new TextDecoder("utf-16le").decode(new Uint8Array(memory.buffer, ptr, length));
```

- `apps.name` と `apps.id` は文字列を返します。export の `__new(文字列のバイト数, 2)` で AS の文字列を確保し、メモリを取り直して UTF-16LE のコード単位を書き、ポインタを返します。クラス ID は 2 です
- 読むたびに `memory.buffer` を取り直します（メモリが伸びると `buffer` が変わるため）

## AppStore（実装済み）

ビルド結果を保存します。アプリ自身が使うデータのストレージとは別です。

```ts
interface InstalledApp {
  key: string;
  source: string;
  manifest: AppManifest;
  icon: string | undefined;
  html: string;
  wasm: Uint8Array;
  installedAt: number;
}
interface AppStore {
  list(): Promise<InstalledApp[]>;
  get(key: string): Promise<InstalledApp | undefined>;
  put(app: InstalledApp): Promise<void>;
}
```

- `installedAppKey(source, id)` は `JSON.stringify([source, id])` を返す。`key` はこれを使う。入手元と ID の区切りが衝突しない形にする
- `icon` は SVG の文字列。無ければ `undefined`
- `installedAt` は `Date.now()` の値。Unix epoch からのミリ秒を `number` で持つ
- `put` は同じ key の記録を置き換える。`get` は無ければ `undefined`
- `createMemoryAppStore()` はメモリに保存する。再読み込みで消える
- `createIndexedDbAppStore(options?)` はグローバルの `indexedDB` に保存する。`options.name` で DB 名を指定できる（既定は `binette-apps`）。再読み込み後も使える

版を比べてビルドするか決めるのは Scene の `mountShell` です。入手元の検証や権限の確認はまだしません。
