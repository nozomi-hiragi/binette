# Régie: 実行

[Régie の目次](README.md)

アプリの WASM を Worker で動かし、アプリからの呼び出しを受ける部分です。1 つのアプリを動かす一番下の層で、状態の移り変わり（[process.md](process.md)）はこの上に載ります。今のコードでは `packages/regie/src/launch.ts`・`worker.ts` にあります（場所は変えません）。

## 実行の流れ（実装済み）

```
メインスレッド（launchApp）              Worker（serveApp）
  ── init { wasm, page, apps?, os? } ─────────────→  WebAssembly.instantiate
                                        _start があれば呼ぶ（トップレベルの初期化）
  ←──────────── dom { ops } ─  （初期化中の操作）
  ←──────────── ready { exports } ────  export された関数名を返す
  launchApp が解決する
  ── call { id, name, args } ─────────────→  exports[name](...args) を呼ぶ
  ←──────────── dom { ops } ─  （呼び出し中の操作）
  ←──────────── done { id } ──────────  呼び終えた
  call が解決する
```

- 1 つの Worker で 1 つのアプリを動かします
- 状態の通知は、Scene が HTML を描き終えてから、プロセス（[process.md](process.md)）が `__bina_lifecycle` で呼びます
- メッセージは届いた順に処理されます。呼び出し中の `dom` は、その呼び出しの `done` より先に届きます

## API（実装済み）

### launchApp

```ts
function launchApp(wasm: Uint8Array | ArrayBuffer, options?: LaunchOptions): Promise<RegieApp>
```

アプリの WASM を Worker で起動します。

1. `options.createWorker` で Worker を作る。省略すると `options.workerUrl`、さらに省略すると下の「独立した Worker のファイル」を使う
2. Worker の `message` を受け始めてから、`{ type: "init", wasm, page, apps?, os? }` を送る。`wasm` は写しを作って transfer する（`Uint8Array`（大きなバッファの一部を見るものを含む）なら `new Uint8Array(wasm).buffer`、`ArrayBuffer` なら `wasm.slice(0)`）。呼び出し側のバッファは変わらない。`postMessage` が投げたら、Worker を止め（`stop()` と同じ）、そのエラーで reject する
3. `ready` が来たら `RegieApp` で解決する
4. `failed` が来たら Worker を止め（`stop()` と同じ）、`failed` の `message` を持つ `Error` で reject する

- WASM の作り方は [WASM の約束](#wasm-の約束実装済み) に合わせます
- Worker の `error`・`messageerror`、アプリの中の例外では、アプリが終了したものとして Worker を止めます。ready 前なら起動を reject し、ready 後なら待っている call をすべて同じ Error で reject して `onExit` を 1 回呼びます。以後の call は `アプリは止まっています。` で reject します
- `error` の文は `アプリが落ちました: <message>`。message が無ければ `アプリが落ちました。` です。`messageerror` は `アプリとのやりとりに失敗しました。` です
- init の送信から ready まで、および call の送信から完了まで、既定 5 秒で時間切れにします。Worker を止め、待つ call をすべて同じ Error（`アプリが応答しないので終了しました。`）で reject します。ready 前は launchApp の reject、ready 後は onExit で一回知らせます。完了や停止時にはタイマーを解除します

### LaunchOptions

```ts
interface LaunchOptions {
  callTimeout?: number; // ミリ秒、既定 5000
  page?: string; // 省略時は空文字列
  last?: LifecycleRecord; // 前回の記録。省略時の page は空文字列、reason は User/Os
  onFinish?: () => void;
  onDom?: (ops: DomOp[]) => void;
  // 辞書のキーごとの入力。省略したキーはアプリに届かない
  apps?: { id: string; name: string }[];
  onOpen?: (i: number) => void;
  os?: OsSnapshot;
  onSet?: (name: string, value: number) => void;
  onAssign?: (role: string, i: number) => void;
  onUpdate?: () => void;
  storage?: Map<string, string>;
  onStorage?: (name: string, value: string | null) => void; // value が null なら削除
  /** 辞書に載せなかったキーの理由。書かれていないキーは NotGranted */
  denied?: Record<string, "NotGranted" | "NotAssigned">;
  /** アプリを終了しない呼び出しの失敗 */
  onError?: (error: Error) => void;
  /** 起動後にアプリが終了したとき。stop や signal では呼ばない */
  onExit?: (error: Error) => void;
  /** Worker を作る関数。省略すると独立した module Worker */
  createWorker?: () => RegieWorker;
  /** module Worker の URL。createWorker があればそちらを優先 */
  workerUrl?: string | URL;
  /** 起動中でも Worker を止める */
  signal?: AbortSignal;
}
interface OsSnapshot {
  settings: Omit<SystemSettings, "roles">;
  roles: Record<string, string>; // 役割に割り当てたアプリの installedAppKey
  candidates: Record<string, { id: string; name: string }[]>; // 役割ごとの選べるアプリ。id は installedAppKey
  launches: { time: number; name: string }[]; // 新しい順
  updateAvailable: boolean; // 新しい版の /system があるか
}
type ApiDenial = "NotGranted" | "NotAssigned";
const API_KEYS = ["apps", "os", "storage", "fs", "cadre"] as const;
```

- `signal` が中断されたら Worker を止め、起動や呼び出しの待ちを reject する。中断済みなら Worker は作らない
- `onDom` は `dom` が届くたびに呼びます。`ready` より前（トップレベルの初期化）に届いたものも呼びます
- `onExit` は起動後にアプリが終了したときだけ呼びます。`stop()` や `signal` では呼びません
- `onError` は終了しない `fail` が届くたびに呼びます。`failed`（起動の失敗）では呼ばず、`launchApp` の reject だけで知らせます
- `apps`・`os`・`storage` は、API の辞書（[Réplique](../replique.md#api-の辞書実装済み形は案)）のキーに載せる起動時の入力です。渡す条件はシステム（[system.md](system.md#権限)）が確かめます。省略したキーは辞書に載らず、アプリの `api.get` は null を返します。辞書を通さずにその import を直接呼ぶと、例外でアプリを終了します。`denied` は載せなかったキーの理由（`api.why` が返す）で、書かれていないキーは NotGranted です。`fs` はキーだけあり、今は誰にも載りません
- onSet・onStorage・onUpdate はメッセージが来たときに通知します。onAssign は呼び出しの完了後に通知します。プロセスはさらに状態の通知と起動の完了を待って知らせ、システムが役割の割り当てを変更します。API と範囲は [Réplique](../replique.md#api-の辞書実装済み形は案) を参照してください

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
  call(name: string, ...args: number[]): Promise<void>;
  /** Worker を止める */
  stop(): void;
}
```

- `exports` は凍結した配列です。WASM の export のうち関数だけで、`_start` と `__` で始まるランタイムの関数を除きます。`memory` などは入りません
- `call(name, ...args)`:
  - 止めたあとに呼ぶと、`アプリは止まっています。` の `Error` で reject する（Worker には送らない）
  - 要求番号（1 から順に増える整数）を付けて `{ type: "call", id, name, args }` を送り、同じ番号の `done` で解決、`fail` で reject する
  - `args` をそのまま可変長の数値引数として渡します。戻り値は返しません
- `stop()`: Worker を `terminate` し、待っている `call` をすべて `アプリを止めました。` の `Error` で reject します。2 回目からは何もしません

### serveApp

```ts
interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}
function serveApp(scope: WorkerScope, differ?: typeof createUiDiffer): void
```

Worker の側の処理です。Worker の `self` か、テストでは `MessageChannel` の片方を渡します。

- `serveApp` は Worker の入口（`worker-entry.ts`、本番の `regie-worker.js`）から呼びます。宣言 UI の差分は Décor の `createUiDiffer` を引数 `differ` で受け取ります
- 自分で Worker を作るときは、`workerUrl` に module Worker の URL を渡すか、`createWorker` で `serveApp` をつないだものを渡します。以前の `workerSource()`（Blob URL 用のソース文字列）は廃止しました

### 独立した Worker のファイル

`createWorker` を省略すると、`workerUrl` で指定した URL、または Régie に同梱する入口から module Worker を作ります。

```ts
const worker = new Worker(url, { type: "module" });
```

- 本番ビルドでは `regie-worker.js` に出力します。Binette は Blob URL を使わないため、CSP の `worker-src blob:` は要りません
- Worker の改変検知方法は [起動と配布](../boot.md#改変の検知決定-2026-11-01) を参照してください

## メッセージ（実装済み）

メインスレッド → Worker:

| `type` | 欄 | 意味 |
| --- | --- | --- |
| `init` | `wasm: ArrayBuffer`, `page: string`, `last?: LifecycleRecord`, `apps?: { id: string; name: string }[]`, `os?: OsSnapshot`, `storage?: Map<string, string>`, `denied?: Record<string, ApiDenial>` | WASM を起動する。1 つの Worker に 1 回だけ送る。辞書に載るキーは、渡された `apps`・`os`・`storage` |
| `call` | `id: number`, `name: string`, `args: number[]` | export の `name` に可変長の数値引数を渡す |

Worker → メインスレッド:

| `type` | 欄 | 意味 |
| --- | --- | --- |
| `ready` | `exports: string[]` | 起動できた。export された関数名（`_start` と `__` で始まる名前を除く） |
| `failed` | `message: string` | 起動できなかった。`message` は `アプリを起動できません: <理由>` |
| `dom` | `ops: DomOp[]` | 一回分の DOM 操作 |
| `apps.open` | `i: number` | アプリを開く |
| `os.set` | `name: string`, `value: number` | 数の設定を変更する。Worker と OS の両方で範囲を確かめる |
| `os.assign` | `role: string`, `i: number` | 役割に割り当てるアプリを、候補の番号で選ぶ |
| `os.update` | なし | `/system` の更新を頼む |
| `storage.write` | `name: string`, `value: string \| null` | アプリごとのデータを書く。null は削除 |
| `finish` | なし | アプリが自分を閉じる |
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

- AssemblyScript を `--exportStart _start --exportRuntime` でビルドします（`buildApp` がそうする。[build.md](build.md#buildapp)）
- `--exportStart` を付けると、トップレベルの初期化（グローバル変数の初期値、トップレベルの文）は WASM の start 節ではなく、export `_start` になります。Régie は instance を作り終えてから `_start` を呼びます。初期化の中で `document` の操作をしても文字列を読めるようにするためです
- `_start` が無い WASM も起動できます（その場合は呼ばない）
- メモリは `memory` という名前で export されている必要があります（AS の既定）

### import

Régie が WASM に渡すのは `binette` の [Réplique の import](../replique.md#wasm-import案実装済み) と `env.abort(message, fileName, line, column)` です（案・実装済み）。abort の文字列は AS のポインタで、0 なら無しです。ほかの import はリンクに失敗します。

ページの識別子は init で受け取り、`app.page` から返します。Last 用の `app.lastPage`・`app.lastKind`・`app.lastCause` は init の last から返します。省略時は空文字列・0・0 です。文字列は既存の `__new` で確保して返します。

### DOM の配送（案・実装済み）

`dom.*` と `apps.icon` はその場では送らず配列に溜めます。`_start` 後の ready 前、および各 call 後の done / fail 前に `{ type: "dom", ops }` を一回送ります。空なら送りません。call の例外でもそこまでの操作を送り、初期化失敗時は捨てます。`onDom` は launchApp / call の解決・拒否より先に届きます。

### 辞書を通さない呼び出し（実装済み）

アプリの `Api` は import `api.why(key)` で、キーが載っているか（0）、NotGranted（1）、NotAssigned（2）を Worker に聞きます。載っていないキーを取ろうとしても、アプリは終了せず null を受け取ります。一方、辞書を通さずに `apps.*`・`os.*`・`storage.*`・`cadre.*` の import を直接呼んだときは、従来の決まりのまま例外でアプリを終了します（`この呼び出しは apps が届いたアプリだけが使えます。` など）。つまり、辞書は「使えるか調べる」ための入口で、権限の強制は import 側が続けて受け持ちます。

`apps.open` と `app.finish` の import は即時にメッセージを送ります。メインは ready または待つ call の完了まで要求を保留し、DOM 操作が届いたあとに onOpen / onFinish を呼びます。同じ呼び出しの finish は open より優先します。

公開する判別共用体 `DomOp`（案・実装済み。core で公開。[core.md](../core.md#domop案)）:

```ts
type DomOp =
  | { op: "byId"; handle: number; id: string }
  | { op: "create"; handle: number; tag: string }
  | { op: "text"; handle: number; value: string }
  | { op: "class"; handle: number; value: string }
  | { op: "append"; parent: number; child: number }
  | { op: "remove"; handle: number }
  | { op: "listen"; handle: number; type: string; listener: number }
  | { op: "icon"; handle: number; app: number };

```

`apps.icon` も apps が無ければ例外、番号の範囲外も例外でアプリを終了します。`__bina_event` と `__bina_lifecycle` は exports 一覧から除かれますが、call では呼べます。プロセスの `dispatch(listener)` が、届けてよいときだけ `call("__bina_event", listener)` でイベントを伝えます（[process.md](process.md#イベントを届けるか)）。

### 文字列の読み方

AS の文字列は UTF-16LE で、ポインタ `ptr` の 4 バイト前に長さ（バイト数、u32、リトルエンディアン）があります。

```ts
const memory = instance.exports.memory as WebAssembly.Memory;
const length = new Uint32Array(memory.buffer, ptr - 4, 1)[0];
const text = new TextDecoder("utf-16le").decode(new Uint8Array(memory.buffer, ptr, length));
```

- `apps.name` と `apps.id` は文字列を返します。export の `__new(文字列のバイト数, 2)` で AS の文字列を確保し、メモリを取り直して UTF-16LE のコード単位を書き、ポインタを返します。クラス ID は 2 です
- 読むたびに `memory.buffer` を取り直します（メモリが伸びると `buffer` が変わるため）


## Cadre の同期（実装済み、形は案）

起動時の `cadre?: CadreSnapshot` が辞書の `cadre` キーを有効にします。`CadreSnapshot` は `instances`（各アプリの `id`・`appIndex`・`name`・`front`・`hasIcon`）、`homeFront`、`installed`、`installBusy` を持ちます。`syncCadre` で Worker の一覧を更新し、`__bina_cadre_sync` で宣言 UI を描き直します。`onCadreOpen`・`onCadreClose` はインスタンスの ID、`onCadreHome`・`onCadreBack`・`onCadreInstall` は操作、`onCadreNotify` は文字列をシステムへ届けます。権限のない `cadre.*` の直接呼び出しはほかのキーと同じく終了します。
