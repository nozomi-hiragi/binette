# @binette/replique

[仕様の目次](README.md)

Réplique（レプリク、セリフ）はアプリが Régie を呼ぶ AssemblyScript のライブラリです。WASM の import と、要素・リスナー・最後に書いた値の管理を持ちます。

## 機能ごとの構成（決定）

Réplique はホストの `@external("binette:<機能名>@0.1", "関数名")` に対応する単位で、`packages/replique/<機能名>/src/index.ts` の機能別のソースに分けます。各機能は OS 内で独立した版を持ち、初期版は `0.1.0` です。JSR には全機能のソースを含む単一の `@binette/replique` を公開し、集約入口から既存の公開名を再 export します。API の取得には各機能の `XxxApi.from(api)` を使います。WASM の `__bina_*` の呼び出し口は変えません。

| 機能名 | 内容 |
| --- | --- |
| `app` | `App`・`launch`・状態とライフサイクル、`Api`・`Why`、共有の状態と文字列処理、再描画用の関数参照 |
| `dom` | `Element`・`Event`・`document` と DOM イベント |
| `ui` | `View`・`column` などの Décor の部品、宣言的 UI の描画・イベント処理と `ui.*` の外部呼び出し |
| `storage`・`pigeon`・`shares` | アプリの保存領域、手紙、共有 |
| `os`・`apps`・`manager` | OS 設定、アプリ一覧、アプリ管理 |
| `scheduler`・`schedule` | 予定の管理、自分の予定 |
| `cadre`・`fs` | Cadre の操作、ファイル API の予約 |

OS のビルドでは機能間とアプリから `jsr:@binette/replique-<機能名>@^0.1` で参照できます。JSR では集約入口 `jsr:@binette/replique` と `jsr:@binette/replique/<機能名>` を使えます。`Api` は `sub()` と `why(key)` を提供し、各機能の API クラスは参照しません。各クラスの `static from(api: Api): XxxApi | null` が対応するキーを確かめて取得します。ホスト ABI の版は機能ごとに管理します。辞書と権限・役割の判定は維持します。

旧指定子 `jsr:@binette/replique/<機能名>` も全 13 機能の互換入口として維持します。Régie は版指定のない旧入口を提供中の機能パッケージの完全な版へ解決し、新しい指定子・集約入口と同じクラスと状態を使います。未知の機能や不正なサブパスは `unsupported_sdk` です。JSR の集約パッケージにも各旧サブパスを exports として残し、各機能を再 export します。機能別の指定子は OS 内で解決され、個別の JSR パッケージとしては公開しません。旧 import の原文を保持して integrity を求める振る舞いは、小さな fixture で検証します。デザイナーのソースと配布は binette-apps が持ちます。ハッシュの対象と計算方法は変更しません。

`app/src/index.ts` は Décor の `View` だけを import し、Réplique のほかの機能には依存しません。`ui/src/index.ts` がトップレベルで描画関数を `app/src/index.ts` の `setRebuild` に登録し、ライフサイクルからの `rebuild` はその関数参照を呼びます。未登録なら何もしません。クロージャを使わず、機能間の import に循環を作らない構造です。集約入口の `index.ts` だけを import するアプリでも描画関数が登録されます。

OS は `/system/libraries/replique/` に `index.ts` と各機能の `.ts`、機能名から完全なパッケージ版への JSON 辞書 `index.json`（例: `{"app":"0.1.0","ui":"0.1.0"}`。実際は全 13 機能）を置きます。辞書に `index` 自体は含めません。すべてを配布目録のハッシュ対象にし、ブラウザのビルドは検証済みの目録と各ファイルを読みます。旧 `/system/libraries/replique.ts` は配布しません。

CLI の `--replique` には `packages/replique` のパッケージルートを渡します。集約入口と各機能の `deno.json`・`src/index.ts` を読み、集約入口を `jsr:@binette/replique`、機能を `jsr:@binette/replique-<機能名>@<完全な版>` としてビルドへ渡します。旧ソースフォルダや単一ファイル、パッケージの欠損・設定不正は、指定すべきルートを示すエラーです。

ビルドは静的 import と再 export、および相対 import の依存先をコンパイル前に調べます。`jsr:@binette/replique-ui` のように版を省略した機能指定子も受け入れ、その機能の提供中の完全な版へ解決します。初期版に固定せず、新旧・版付きの指定子とクラスや状態を共有します。未知の機能は版なしでも `unsupported_sdk` です。要求版には完全一致の `0.1.0`、`^0.1`・`^0.1.0`、`~0.1`・`~0.1.0` などを使えます。`^` は最初の 0 でない要素、`~` は minor の範囲で互換な版を認めます（major だけの範囲指定も使用可）。`^0.1` と `~0.1` は `0.1.0` 以上 `0.2.0` 未満です。完全一致では 3 要素が必要です。ワイルドカード・比較演算子・範囲の結合・事前版・ビルドメタデータは非対応です。要求範囲内の提供版を同じ指定子にそろえ、集約入口と混在してもクラスと状態は共有します。

範囲外なら要求版と提供版、未知の機能なら機能名、形式が不正なら指定子と使用可能な形式を表示し、`BinetteError` の `unsupported_sdk` でコンパイル前に拒みます。ブラウザのビルド Worker を越えてもコードを保ちます。SDK の解決はソースを読むための検査であり、WASM の ABI 検査とは別です。各機能のパッケージ版は ABI の版と照合します（0.x は `0.minor`、1 以降は `major`）。

## 画面を操作する方針（決定 2026-10-27）

- HTML（スクリプトは書かない）＋ AS → WASM、Worker で動かす形を保つ
- OS は HTML の `bina-*` 属性を読まない。アプリが AS の `document` API で変更とクリックを扱う
- 要素は普通の `id` で探す
- 無い id は何も起きないだけで、アプリを終了しない。AS で null に触ると終了するため、null は返さない
- `bina.ts` の生成を無くす
- DOM の動きは段階的に足す。今回は小さくし、危ない機能は用意しない
- 宣言的 UI を併用する案は [宣言的 UI](ui.md) に記載する

## 宣言的 UI（案）

`App.build(): View | null` と `jsr:@binette/replique-ui@^0.1` の部品で画面を作れます。`filePick(label, handler)` は端末のファイル選択画面を開き、選択した名前と Base64 の内容を JSON 文字列で届けます。詳しくは [宣言的 UI](ui.md) を参照してください。既定の `build()` は `null` です。

## 使い方（実装済み）

```ts
import { Api, App, Last, document, launch } from "jsr:@binette/replique";

class Counter extends App {
  private value: i32 = 0;
  onCreate(_last: Last, _api: Api): void {
    document.getElementById("increment").addEventListener("click", () => counter.increment());
  }
  increment(): void {
    this.value++;
    document.getElementById("count").textContent = this.value.toString();
  }
}
const counter = new Counter();
launch(counter);
```

HTML は `<p id="count">0</p><button id="increment">+1</button>` とします。OS は画面を用意してから `onCreate` → `onStart(State.Create)` → `onResume` を呼びます。トップレベルの初期化でも操作できます。`_start` は初期化用なのでアプリには使いません。

## アプリの状態（実装済み）

```ts
export enum State { None, Create, Start, Resume, Pause, Stop, Destroy }
export enum DestroyKind { User, System }
export enum DestroyCause { Os, App, Stack, Update, Uninstall }
export class DestroyReason {
  constructor(readonly kind: DestroyKind, readonly cause: DestroyCause) {}
}
export class Last {
  constructor(readonly state: State, readonly done: boolean, readonly page: string, readonly reason: DestroyReason) {}
}
export class App {
  onCreate(last: Last, api: Api): void {}
  onStart(last: State): void {}
  onResume(): void {}
  onPause(): void {}
  onStop(): void {}
  onDestroy(reason: DestroyReason): void {}
  get page(): string;
  finish(): void;
}
export function launch(app: App): void;
export function __bina_lifecycle(kind: i32, a: i32, b: i32): void;
```

`launch` はトップレベルで一回だけ呼びます。グローバルにインスタンスを保持して GC から守り、仮想メソッドで通知します。二回目は例外でアプリを終了します。呼ばなければ状態の通知は何もせず、document とイベントは使えます。従来の `export function start()` は呼びません。

`this.page` は今のページの識別子です。`finish()` は今の呼び出しの完了後、Pause → Stop → Destroy（User・App）でホームに戻します。`onStart` の引数は Create または Stop です。Last は OS が各メソッドの前後に保存した最後の記録です。初回だけ None・done=true・page=""・reason=User/Os です。途中で落ちたメソッドは done=false が残ります。

`onCreate` の第 2 引数 `api` は、そのアプリに届く API の辞書です（[API の辞書](#api-の辞書実装済み形は案)）。古い `onCreate(last: Last)` の形は、AS がオーバーロードを認めないためコンパイルエラーになります。引数が 1 つの上書きは、`api: Api` を足して移行してください（決定。互換の形は用意しない）。

`__bina_lifecycle` の kind は State、Create の a/b は last.state/last.done、Start の a は前の State、Destroy の a/b は kind/cause です。Last のページと理由は import で受け取ります。Régie のビルドが入口に再 export を足し、`__bina_event` と同じく OS から call します。

## API（案・実装済み）

| API | 内容 |
| --- | --- |
| `document.getElementById(id: string): Element` | 画面に問い合わせず番号を返す。同じ id は Map から同じ Element オブジェクトを返す |
| `document.createElement(tag: string): Element` | 呼ぶたびに新しい番号。許可タグは [scene/mount.md](scene/mount.md#要素と操作案実装済み) |
| `Element.textContent: string` | 書くと子をすべて消して文字だけにする。読むとアプリが最後に書いた文字。まだなら空文字列 |
| `Element.className: string` | 書くとクラスを変える。読むと最後に書いた値。まだなら空文字列 |
| `Element.appendChild(child: Element): Element` | 子を追加し、その child を返す |
| `Element.remove(): void` | 要素と既知の子孫を解放し、取り除く |
| `Element.addEventListener(type: string, listener: (event: Event) => void): void` | 今は click のみ。リスナー番号を送る |
| `Element.removeEventListener(type: string, listener: (event: Event) => void): void` | 同じ要素・種類・関数の登録を解除する |
| `Event.type: string`（readonly） | イベントの種類 |
| `Event.currentTarget: Element`（readonly） | リスナーを付けた Element |
| `Api.sub(): string` | 起動したサブアプリの識別子。親なら空文字列 |
| `Api.why(key: string): Why` | API の辞書。[下](#api-の辞書実装済み形は案)に書く |
| `__bina_event(listener: i32): void` | リスナー番号で Event を作って呼ぶ。Régie のビルドが入口からの再 export を差し込む |
| `__bina_listener_count(): i32` / `__bina_element_count(): i32` | テスト用に保持中のリスナー数・id の要素数を返す |

Element の中身は i32 の handle です。id とリスナーは Map で保持し、登録中は GC から守ります。`Map<Element, i32>` のキーに使えます。getter は画面に聞かず、HTML の初期値や子の変更から値を計算しません。

### リスナーと要素の解放（案）

リスナー番号は単調に増やして再利用せず、解除後の番号で届いたイベントは無視します。i32 の番号を使い切る前に追加を例外で止めます。`removeEventListener` は関数の同一性と種類を比べ、同じ登録が複数ある場合は一つ解除します。渡す関数は登録時と同じものを保持してください。

`appendChild` で把握した親子関係を記録し、別の親へ移すと記録も移します。`remove` は要素自身と既知の子孫を、`textContent` の代入は既知の子孫だけを解放します。解放時にリスナーと id の登録を消し、解放済み要素への変更は無視します。同じ id を再取得すると新しいハンドルになります。自己参照や既知の祖先を子にする操作は無視します。

最初の HTML の親子関係は Réplique には分かりません。その子孫を `getElementById` で取得してリスナーを付け、親を `remove` しても、Réplique 側にはそのクロージャが残ります。Scene 側は実際の DOM の部分木を解放します。

`() => {}` もリスナー引数に書けます。asc 0.28.20 では引数なしの名前付き関数を直接渡すと型エラーになるため、`() => showDetails()` と包みます。無名関数から this やローカル変数は参照できず、グローバルのインスタンスを通します。

### WASM import（決定・実装済み）

module 名は 0.x では `binette:<機能名>@0.<minor>`、1 以降では `binette:<機能名>@<major>`、関数名は機能名を除いた名前です。例は `binette:dom@0.1` / `text` です。文字列は AS のポインタ、番号は i32 です。`api.why`・`api.sub` は `app/src/index.ts` の機能なので `binette:app@0.1` / `why`・`sub` になります。以下の表の `dom.text` などは説明用の機能名＋関数名で、WASM の関数名に `dom.` は含めません。

ABI の版は JSR パッケージや OS の版と独立です。既存の呼び出しを壊す変更で版を変え、追加のみでは変更しません。OS は旧版と新版の実装を別の module として並存させられます。module 名が完全に一致するものだけを受け入れ、別の minor 版へ自動的に読み替えません。現在の提供 module と関数数は次のとおりです。

| module | 関数数 |
| --- | ---: |
| `binette:app@0.1` | 7 |
| `binette:dom@0.1` | 8 |
| `binette:ui@0.1` | 1 |
| `binette:apps@0.1` | 5 |
| `binette:os@0.1` | 22 |
| `binette:storage@0.1` | 6 |
| `binette:pigeon@0.1` | 11 |
| `binette:shares@0.1` | 2 |
| `binette:cadre@0.1` | 28 |
| `binette:manager@0.1` | 3 |
| `binette:scheduler@0.1` | 3 |
| `binette:schedule@0.1` | 3 |

`env.abort` は AssemblyScript の中断通知用に別途提供します。`fs` も `ABI_VERSION` を一度宣言して検査しますが、外部呼び出しがまだないため module を提供しません。

各 SDK 機能は `ABI_VERSION = "0.1"` を一箇所で宣言します。asc の `@external` は定数参照や連結式を受け取らず文字列リテラルを要求するため、各宣言には完全な module 名を書き、宣言した版との一致をテストで検査します。Régie の `src/abi.ts` の提供一覧は Worker の import object の型と検査で共有し、SDK の全外部宣言と関数名・module 名の一致、および実際の WASM のリンクをテストします。

起動時は WASM をコンパイルして `WebAssembly.Module.imports` を読み、instantiate と `_start` より前に検査します。未対応 module は `この OS では動きません（storage 0.9）。アプリの管理から入れ直すと直ります` のように機能と版を表示して拒みます。複数なら表示名で並べ替え、`この OS では動きません（storage 0.9、ui 0.2）。アプリの管理から入れ直すと直ります` とします。形式外の module 名はそのまま表示し、旧 `binette` なら `この OS では動きません（binette）。アプリの管理から入れ直すと直ります` です。提供 module 内の未知関数や関数以外の import は `この OS では動きません（storage 0.1 の read2）。アプリの管理から入れ直すと直ります` のように名前も表示します。未対応 ABI は `BinetteError` の専用コード `unsupported_abi` で識別します。起動では Worker の `failed` メッセージにコードを載せ、`launchApp` が `BinetteError` を復元して、既存の起動失敗通知を通じて Scene のエラー表示へ届けます。起動時も余分な接頭辞は付けず、この文言をそのまま表示します。インストールの reject と報告でも同じコードと文言を保ちます。提供リストからのインストール・更新、起動時に登録するソース／ビルド済みアプリ、`buildStoredApp` も保存前に同じ検査を行います。検査は import の対応だけを判断し、呼び出し時の権限・役割判定と OS call の実装は変えません。

旧 `binette` module は非対応です。保存済みの旧 WASM を自動で書き換えたり、ABI の変更だけで自動再ビルドしたりはしません。復旧は [ビルドと旧アプリの復旧](regie/build.md#旧-abi-のアプリの復旧) を参照してください。

| 名前 | 引数 |
| --- | --- |
| `dom.byId` | handle, id |
| `dom.create` | handle, tag |
| `dom.text` / `dom.class` | handle, value |
| `dom.append` | parent, child |
| `dom.remove` | handle |
| `dom.listen` / `dom.unlisten` | handle, type, listener |
| `apps.icon` | handle, i |
| `apps.count` | なし（i32 を返す） |
| `apps.name` / `apps.id` | i（文字列ポインタを返す） |
| `apps.open` | i |
| `os.get` / `os.set` | name、name と value |
| `os.role` | role（文字列ポインタを返す） |
| `os.candidateCount` | role |
| `os.candidateName` / `os.candidateId` | role, i（文字列ポインタを返す） |
| `os.assign` | role, i |
| `os.launchCount` / `os.launchTime` / `os.launchName` | なし、i、i |
| `os.updateAvailable` / `os.update` | なし |
| `storage.has` / `storage.read` / `storage.write` / `storage.remove` | name、name（文字列ポインタか 0 を返す）、name と value、name |
| `storage.count` / `storage.name` | なし、i |
| `api.why` | key（0 は届いている、1 は NotGranted、2 は NotAssigned） |
| `app.page` / `app.lastPage` | なし（文字列ポインタを返す） |
| `app.lastKind` / `app.lastCause` | なし（i32 を返す。今はどちらも 0） |
| `app.finish` | なし（自分を閉じる要求） |

アプリは `apps.*`・`os.*`・`storage.*`・`cadre.*` の import を直接は使わず、辞書から取ったクラスを通します。辞書に載っていないキーの import を直接呼ぶと（辞書を通さない呼び出し）、権限のない呼び出しとして例外でアプリを終了します（[regie/run.md](regie/run.md#メッセージ実装済み)）。番号の範囲外も例外です。任意の URL や SVG をアプリから渡す API はありません。

## API の辞書（実装済み、形は案）

[役割と API](roles.md) の辞書です。OS が `onCreate(last, api)` の第 2 引数で渡します。各機能の `XxxApi.from(api)` が対応するキーについて `api.why(key) == Why.Granted` を確かめ、届いていればそのクラスの新しいインスタンスを、届いていなければ null を返します。キーは各クラスが持ち、呼び出し側で型引数とキーを組み合わせる必要はありません。

```ts
export enum Why { Granted, NotGranted, NotAssigned }
export class Api {
  sub(): string;
  why(key: string): Why;
}
export class AppsApi {
  static from(api: Api): AppsApi | null;
}
```

- `why` は取れない理由を返します。`NotGranted` は権限がない、`NotAssigned` はそのキーを持つ役割に割り当てられていません。取れるなら `Granted` です。知らないキーはどの役割にも属さないので `NotAssigned` です（案）
- 辞書の中身は起動のときに決まり、その場では変わりません。ホームの割り当てを設定アプリで変えると、前のホームは Destroy され、新しいホームが次の起動から `apps` を受け取ります（ほかの役割の変え方は未決）
- `Api` はコンストラクタを持つので `new Api()` でも作れますが、辞書の中身は `onCreate` で渡すものと同じです。トップレベルの初期化（`_start`）から使ってもかまいません

| キー | クラス | 届く相手 | 内容 |
| --- | --- | --- | --- |
| `cadre` | `CadreApi` | Cadre | 起動中の一覧、切り替え、閉じる、ホーム、戻る、インストール案内。通知の表示と応答（[apps/cadre.md](apps/cadre.md)） |
| `apps` | `AppsApi` | ホーム（と Cadre） | `count()`・`name(i)`・`id(i)`・`open(i)`・`icon(img, i)`。ホームに渡すアプリの一覧と起動 |
| `os` | `OsApi` | 設定アプリ | `get(name)`・`set(name, value)`、役割と起動履歴、ソフトウェア更新の確認・状態・適用 |
| `manager` | `AppManagerApi` | アプリ管理 | 提供リスト・インストール・更新・削除（[app-manager.md](app-manager.md)） |
| `scheduler` | `SchedulerApi` | 設定アプリ | OS とすべてのアプリの予定の一覧、形の変更、止める・再開、今すぐ実行（[scheduler.md](scheduler.md)） |
| `schedule` | `ScheduleApi` | `permissions` に `schedule` を書いたアプリ | 自分の予定の登録・変更・削除・今すぐ実行と読み取り（[scheduler.md](scheduler.md#アプリの予定)） |
| `pigeon` | `PigeonApi` | すべてのアプリ | 手紙の送信・受信欄の同期読み取り・削除（[pigeon.md](pigeon.md)） |
| `shares` | `SharesApi` | すべてのアプリ | 共有の作成・一覧・承認・退出とファイル操作（[file-sharing.md](file-sharing.md)） |
| `storage` | `StorageApi` | すべてのアプリ | `has(name)`・`read(name)`・`write(name, value)`・`remove(name)`・`count()`・`name(i)`。アプリ自身の領域のデータ（`/data/…`） |
| `fs` | `FsApi` | 誰にも届かない（案） | `from(api)` だけを持つ。範囲の決め方が未決なので、キーだけ用意している |

```ts
class Home extends App {
  onCreate(_last: Last, api: Api): void {
    const apps = AppsApi.from(api);
    if (apps == null) { /* api.why("apps") で NotAssigned などを見る */ }
  }
}
```

### OsApi

設定アプリ（役割 settings に割り当てられたアプリ）だけに届きます。`binette:os@0.1` module の同名の WASM import に対応します。

- get/set の name は `stackSize`・`stopDelay`・`callTimeout`・`destroyTimeout`・`historyLimit`・`homeRetryWindow`。時間はミリ秒。stackSize は 1 以上、historyLimit は 0 以上、stopDelay/homeRetryWindow は 0 以上、callTimeout/destroyTimeout は 1000 以上。set は範囲外や知らない名前なら false を返して変更せず、OS にも送りません。get の知らない名前は例外です
- set は Worker の写しも更新し、続く get に反映します。OS は範囲を再確認して SystemStore に保存し、[変更が効く時点](lifecycle.md#値を変えたときに効く所案実装済み)から使います。bool は範囲の検査の結果で、保存の完了通知ではありません。保存の失敗は OS のエラー表示に出ます
- `role(role)` は役割に割り当てたアプリの完全なアプリ ID です。割り当てが無ければ空文字列です。`candidateCount`・`candidateName`・`candidateId` は、その役割に選べるアプリの数・名前・完全なアプリ ID です。割り当てを変えられるのは `home` と `cadre`（今）で、ほかの役割は 0 です。候補は保存済みの、その役割を名乗るアプリで、入手元を問いません。`assign(role, i)` はその番号のアプリを割り当てて保存し、Worker の `role` も更新します。番号の範囲外は例外です。割り当てを変えられない役割（設定など）は候補が 0 なので、assign は必ず例外になります
- letterCount と `letterId(i)`・`letterFrom(i)`（差出人の完全なアプリ ID）・`letterName(i)`（差出人の名前。もう無いアプリは ID）・`letterTitle(i)`・`letterBody(i)`・`letterTime(i)`（届いた時刻。OS のタイムゾーンの「YYYY-MM-DD HH:MM」）・`letterOpened(i)` は、ユーザー宛てに届いた手紙の写しです。新しい順で、届く・開封・削除のたびに OS が同期します。操作には番号ではなく `letterId(i)` を渡します。`showLetter(id)` は開封にして差出人のアプリを開き、`openLetter(id)`・`openAllLetters()` は開封にするだけ、`deleteLetter(id)`・`deleteAllLetters()` は消します（[Pigeon](pigeon.md#届いた通知と開封)）
- launchCount/launchTime/launchName は設定アプリのインスタンスを作る直前の起動の履歴の写しです。新しい順、日時は Unix epoch ミリ秒の f64、名前が無ければ完全なアプリ ID。番号の範囲外は例外です。閉じて開き直すと更新し、前面へ戻すだけでは更新しません
- `updateAvailable()` は準備済みの新しい版があるかです。`updateCurrent()`・`updateNext()` は現在と新しい版の表示用の文字列、`updatePhase()` は確認や更新の状態です。`checkUpdate()` は確認を、`update()` は準備済みの組への更新を、`openRecovery()` は復旧画面を開くことを OS に頼みます。状態の変化は設定アプリに同期され、画面を描き直します。呼び出し名と状態の形は案です
- role/candidateName/candidateId/launchName は文字列ポインタ、launchTime は f64、それ以外の番号・数値・bool は i32 を使います

### SchedulerApi

設定アプリ（役割 settings に割り当てられた `binette:system` のアプリ）だけに届きます。一覧は番号で数え、操作は予定の ID で指します（実装済み、形は案）。

- `count()`・`id(i)`・`owner(i)`（`os` か完全なアプリ ID）・`ownerName(i)`（OS は「OS」）・`label(i)`・`rule(i)`（予定の形の JSON）
- `description(i)` は予定の形を読める文にしたもの（「30 分ごと」「毎日 07:30」「毎週 月・木 07:30」など）。`every(i)` は間隔の予定なら秒、ほかは 0
- `enabled(i)`・`running(i)`・`next(i)`・`lastTime(i)`（端末の時刻帯で `YYYY-MM-DD HH:MM`、無ければ空）・`lastResult(i)`（`ok`・`error: …`・空）
- `update(id, rule)`・`setEnabled(id, on)`・`runNow(id)` は OS に頼むだけで、すぐ戻ります。予定が変わると OS が写しを送り直し、画面を描き直します。形の検査に落ちた変更は OS のエラー表示に出ます
- 番号の範囲外は例外です

### ScheduleApi

`app.json` の `permissions` に `schedule` を書いたアプリに届きます。自分の予定だけを、枠番号（0 から。今は枠 0 だけ）で扱います（実装済み）。

- `register(slot, rule, label = "")` は、その枠が空いているときだけ登録して true を返します。すでにあるときは何もせず false です。起動のたびに呼んでも、ユーザーが設定で変えた値は消えません
- `update(slot, rule)` はその枠に予定があるときだけ形を変えます。`remove(slot)` は消し、`runNow(slot)` は止めていても今すぐ実行します。どれも予定が無ければ false です
- 形は JSON の文字列（`{"every":1800}`・`{"daily":"07:30"}` など、[予定の形](scheduler.md#予定の形)）で、`every` は 900 秒以上です。正しくない形と枠の外の番号は、何もせず false を返します
- `count()`（枠の数）・`exists(slot)`・`rule(slot)`・`label(slot)`・`enabled(slot)`・`lastTime(slot)`（Unix epoch ミリ秒の f64、まだなら 0）・`lastResult(slot)`（`ok`・`error: …`・空）。Worker の写しから同期的に返し、予定が変わると OS が写しを送り直して画面を描き直します
- 予定の時刻が来ると `App.onSchedule(slot, api)` が呼ばれます。インスタンスが無ければ画面なしで起こされ、`onCreate` は呼ばれず、`build()` もしません（[画面なしの起動](lifecycle.md#画面なしの起動決定-2026-11-09)）。上限は 30 秒です

### PigeonApi

`PigeonApi.from(api)` で取得します。`send(to, kind, title, body, urgent = false, actions = "[]")` で送り、差出人は OS が決めます。`actions` は JSON 配列の文字列です。受信欄は `count()` と `from(i)`・`to(i)`・`kind(i)`・`title(i)`・`body(i)`・`urgent(i)`・`actions(i)` で同期的に読み、`done(i)` で削除します。動作中に届くと `onPigeon()` が呼ばれます。`opened(kind = "")` は、自分が送ったユーザー宛ての手紙を開封にします（`kind` を省くと全部）。ユーザー宛てには `notify` 権限が必要です。詳しくは [Pigeon](pigeon.md) を参照してください。

### SharesApi

`SharesApi.from(api)` で取得します。`create(name)`・`list()`・`join(id)`・`leave(id)`・`read(id, path)`・`write(id, path, value)`・`remove(id, path)`・`files(id, prefix)` は要求番号を返します。保存が終わると `onShare()` が呼ばれ、`result(番号)` で結果を一度だけ取得できます。未完了なら null、完了時は `{ "ok": true, "value": ... }` または `{ "ok": false, "error": "..." }` の JSON です。`create` は共有の行、`list` は招待中・参加済みの共有の行の配列、`files` はパスの配列、`read` は文字列または不存在を表す null を返します。変更操作の値は null です。各操作時に参加状態とアクセス権を再確認します。`read`・`write` は UTF-8 の文字列を扱い、任意のバイト列には `readBase64`・`writeBase64` を使います。

`PigeonApi.send` の第 7 引数に `[{"id":"共有 ID","access":"read"}]` の JSON を渡すと手紙に共有を添付できます。受信欄では `shares(i)` で添付の JSON を読みます。ユーザー宛ての通知には添付できません。招待されたアプリが `join` する前に共有が無くなった場合、結果はエラーです。

### StorageApi

アプリ自身の領域のデータ（`/data/…`）です。サブアプリは親の領域を共有します。名前は 1 つの部品（`/` を含めてもよいが、階層にはならない）で、1〜256 文字。中身は文字列だけです。

- 起動のときにアプリのデータを Worker に写し、`read`・`has`・`count`・`name(i)`（名前の辞書順）はその写しから返します。`write`・`remove` は写しを更新して OS に知らせ、OS が順に保存します。完了は待てません
- `read` は無ければ null です。`write` は名前が空か 256 文字を超えるとき false を返して保存しません。無い名前の `remove` は何もしません
- 容量の上限と、ほかのタブや窓との同時書き込みの扱いは未決です。アプリの ID `system` は従来の API 契約に合わせて使えません

`@external("binette:dom@0.1", "text")` と `// @ts-ignore: decorator` で import を宣言します。型検査は Deno と asc の両方で行います。AS235（クラスや名前空間自体は WASM の export にならない）は想定した警告です。

## まだしていないこと

- 最初の HTML の検査（on* 属性など。別作業）
- setAttribute・style・value・input イベント・click 以外のイベント
- `fs`（ファイルの木）の範囲の決め方と、権限を許す流れ。server の呼び出し。結果を受け取る方法は未決

## AS で書くときの制約

- async / await、Promise は無い
- クロージャ（外の変数を使う無名関数）は使えない。コールバックにはトップレベルの関数を渡す
- アプリから DOM、ネットワーク、`console` などには直接触れない。使えるのは Réplique の呼び出しだけ（Régie がほかの import を渡さないので、使うと起動できない）
- 例外（`throw`）は、その呼び出しを止め、アプリを終了する。Régie はそれを受けてインスタンスを片付け、Scene に見せ方を知らせる（[regie/run.md](regie/run.md#メッセージ実装済み)、[regie/system.md](regie/system.md#落ちたとき)）

## 配布（実装済み）

- `dist` は持たず、AS のソース `src/index.ts` をそのまま配る
- JSR（`jsr:@binette/replique`）だけに出します（決定 2026-10-26）
- エディタで `jsr:@binette/replique` の補完が効くかは未確認
