# @binette/regie

[仕様の目次](README.md)

Régie（レジ、操作室）はカーネルです。アプリの WASM を Worker で動かし、アプリからの呼び出しを受けます。画面は持ちません。依存はありません。

## 役割（案）

- アプリの実行（Worker ＋ WASM）
- 権限の判断。フロントの設定画面から、アプリごとに権限を取り消せる
- アプリごとのストレージ。ほかのアプリからは読めない。容量の上限を持つ
- インストール済みアプリの記録（[app.md](app.md#régie-が記録するもの案)）
- アプリのデータは、アプリごとにまとめて書き出せる形で持つ。バックアップのときは、それを Coulisses に送る
- 動いているアプリの数に上限を持ち、裏に回ったアプリは止められる。状態はストレージから戻す前提にする
- アプリは Régie が渡した呼び出ししか使えない。ネットワークや DOM に直接は触れない

今のコードにあるのは、アプリの実行と、文字の書き換え（`elem.text`）の受け口だけです。

## 実行の流れ（実装済み）

```
メインスレッド（launchApp）              Worker（serveApp）
  ── init { wasm } ─────────────────→  WebAssembly.instantiate
                                        _start があれば呼ぶ（トップレベルの初期化）
  ←──────────── text { name, value } ─  （初期化中の elem.text）
  ←──────────── ready { exports } ────  export された関数名を返す
  launchApp が解決する
  ── call { id, name } ─────────────→  exports[name]() を呼ぶ
  ←──────────── text { name, value } ─  （呼び出し中の elem.text）
  ←──────────── done { id } ──────────  呼び終えた
  call が解決する
```

- 1 つの Worker で 1 つのアプリを動かします
- `start()` は Régie からは呼びません。呼ぶのは Scene です（[scene.md](scene.md#mountapp)）。Scene が HTML を描き終えてから呼ぶためです
- メッセージは届いた順に処理されます。呼び出し中の `text` は、その呼び出しの `done` より先に届きます

## API（実装済み）

### launchApp

```ts
function launchApp(wasm: Uint8Array | ArrayBuffer, options?: LaunchOptions): Promise<RegieApp>
```

アプリの WASM を Worker で起動します。

1. `options.createWorker` で Worker を作る。省略すると、下の「Blob URL の Worker」を作る
2. Worker の `message` を受け始めてから、`{ type: "init", wasm }` を送る。`wasm` は写しを作って transfer する（`Uint8Array`（大きなバッファの一部を見るもの、Node の `Buffer` を含む）なら `new Uint8Array(wasm).buffer`、`ArrayBuffer` なら `wasm.slice(0)`）。呼び出し側のバッファは変わらない。`postMessage` が投げたら、Worker を止め（`stop()` と同じ）、そのエラーで reject する
3. `ready` が来たら `RegieApp` で解決する
4. `failed` が来たら Worker を止め（`stop()` と同じ）、`failed` の `message` を持つ `Error` で reject する

- WASM の作り方は [WASM の約束](#wasm-の約束実装済み) に合わせます
- Worker のスクリプト自体が落ちたとき（`error` イベント）は、まだ扱っていません。そのときは解決も reject もしません

### LaunchOptions

```ts
interface LaunchOptions {
  /** アプリが要素の文字を書き換えたとき（elem(name).text = value） */
  onText?: (name: string, value: string) => void;
  /** アプリの中で起きたエラー（abort や、呼び出しの失敗） */
  onError?: (error: Error) => void;
  /** Worker を作る関数。省略すると Blob URL の Worker */
  createWorker?: () => RegieWorker;
}
```

- `onText` は `text` が届くたびに呼びます。`ready` より前（トップレベルの初期化）に届いたものも呼びます
- `onError` は `fail` が届くたびに呼びます。`failed`（起動の失敗）では呼ばず、`launchApp` の reject だけで知らせます

### RegieWorker

```ts
interface RegieWorker {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
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
  call(name: string): Promise<void>;
  /** Worker を止める */
  stop(): void;
}
```

- `exports` は凍結した配列です。WASM の export のうち関数だけで、`_start` を除きます。`memory` などは入りません
- `call(name)`:
  - 止めたあとに呼ぶと、`アプリは止まっています。` の `Error` で reject する（Worker には送らない）
  - 要求番号（1 から順に増える整数）を付けて `{ type: "call", id, name }` を送り、同じ番号の `done` で解決、`fail` で reject する
  - 引数は渡せません。今の呼び出しは引数も戻り値も無い関数だけです
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
| `init` | `wasm: ArrayBuffer` | WASM を起動する。1 つの Worker に 1 回だけ送る |
| `call` | `id: number`, `name: string` | export の `name` を引数なしで呼ぶ |

Worker → メインスレッド:

| `type` | 欄 | 意味 |
| --- | --- | --- |
| `ready` | `exports: string[]` | 起動できた。export された関数名（`_start` を除く） |
| `failed` | `message: string` | 起動できなかった。`message` は `アプリを起動できません: <理由>` |
| `text` | `name: string`, `value: string` | アプリが `elem(name).text = value` と書いた（import の `elem.text`） |
| `done` | `id: number` | `call` を呼び終えた |
| `fail` | `id: number`, `message: string` | `call` が失敗した |

`fail` の `message`:

| 場合 | `message` |
| --- | --- |
| `init` より前に `call` が来た | `アプリがまだ起動していません。` |
| export に `name` が無いか、関数でない | `アプリに関数 <name> がありません。` |
| アプリが `abort` した（AS の `throw` を含む） | `アプリが中断しました: <メッセージ> (<ファイル>:<行>:<列>)`。ファイル名が無ければ括弧の部分を付けない |
| そのほかの例外（WASM の trap など） | 例外の `message` |

- export に `name` があるかは `Object.hasOwn(instance.exports, name)` で確かめます
- 起動の失敗（`failed`）になるのは、WASM のコンパイル・リンクの失敗（下の import 以外を求める WASM など）と、`_start` の中の例外です
- `abort` のあと、アプリの状態（メモリ）はそのまま残り、次の `call` も受け付けます。続けて動かしてよいかは、まだ決めていません

## WASM の約束（実装済み）

### ビルドのしかた

- AssemblyScript を `--exportStart _start` でビルドします（Scene の `buildApp` がそうする。[scene.md](scene.md#buildapp)）
- `--exportStart` を付けると、トップレベルの初期化（グローバル変数の初期値、トップレベルの文）は WASM の start 節ではなく、export `_start` になります。Régie は instance を作り終えてから `_start` を呼びます。初期化の中で `elem(…).text` に書いても文字列を読めるようにするためです
- `_start` が無い WASM も起動できます（その場合は呼ばない）
- メモリは `memory` という名前で export されている必要があります（AS の既定）

### import

Régie が WASM に渡す import は次の 2 つだけです。ほかの import を求める WASM はリンクに失敗し、起動できません（`failed`）。

| モジュール | 名前 | 引数 | 内容 |
| --- | --- | --- | --- |
| `binette` | `elem.text` | `(name: i32, value: i32)` | 2 つとも AS の文字列のポインタ。読んで `text` を送る |
| `env` | `abort` | `(message: i32, fileName: i32, line: i32, column: i32)` | AS の `abort`。`message`・`fileName` は文字列のポインタで、`0` なら無し。例外を投げて、その呼び出しを止める |

- `binette` の import の名前は `<対象>.<操作>`（例: `elem.text`）にします。Réplique の書き込みの操作と 1 対 1 で対応します。読む操作（`Elem.text` の getter など）は Réplique の中で済むので、import はありません（[replique.md](replique.md#呼び出しの一覧)）

### 文字列の読み方

AS の文字列は UTF-16LE で、ポインタ `ptr` の 4 バイト前に長さ（バイト数、u32、リトルエンディアン）があります。

```ts
const memory = instance.exports.memory as WebAssembly.Memory;
const length = new Uint32Array(memory.buffer, ptr - 4, 1)[0];
const text = new TextDecoder("utf-16le").decode(new Uint8Array(memory.buffer, ptr, length));
```

- 文字列は読むだけで、Régie からアプリへ文字列を渡すことはまだありません
- 読むたびに `memory.buffer` を取り直します（メモリが伸びると `buffer` が変わるため）
