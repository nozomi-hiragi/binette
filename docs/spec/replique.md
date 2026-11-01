# @binette/replique

[仕様の目次](README.md)

Réplique（レプリク、セリフ）はアプリが Régie を呼ぶ AssemblyScript のライブラリです。WASM の import と、要素・リスナー・最後に書いた値の管理を持ちます。

## 画面を操作する方針（決定 2026-10-27）

- HTML（スクリプトは書かない）＋ AS → WASM、Worker で動かす形を保つ
- OS は HTML の `bina-*` 属性を読まない。アプリが AS の `document` API で変更とクリックを扱う
- 要素は普通の `id` で探す
- 無い id は何も起きないだけで、アプリを終了しない。AS で null に触ると終了するため、null は返さない
- `bina.ts` の生成を無くす
- DOM の動きは段階的に足す。今回は小さくし、危ない機能は用意しない
- 宣言的 UI を併用する案は [宣言的 UI](ui.md) に記載する

## 宣言的 UI（案）

`App.build(): View | null` と `jsr:@binette/replique/ui` の部品で画面を作れます。詳しくは [宣言的 UI](ui.md) を参照してください。既定の `build()` は `null` です。

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
| `Api.get<T>(key: string): T \| null` / `Api.why(key: string): Why` | API の辞書。[下](#api-の辞書実装済み形は案)に書く |
| `__bina_event(listener: i32): void` | リスナー番号で Event を作って呼ぶ。Régie のビルドが入口からの再 export を差し込む |
| `__bina_listener_count(): i32` / `__bina_element_count(): i32` | テスト用に保持中のリスナー数・id の要素数を返す |

Element の中身は i32 の handle です。id とリスナーは Map で保持し、登録中は GC から守ります。`Map<Element, i32>` のキーに使えます。getter は画面に聞かず、HTML の初期値や子の変更から値を計算しません。

### リスナーと要素の解放（案）

リスナー番号は単調に増やして再利用せず、解除後の番号で届いたイベントは無視します。i32 の番号を使い切る前に追加を例外で止めます。`removeEventListener` は関数の同一性と種類を比べ、同じ登録が複数ある場合は一つ解除します。渡す関数は登録時と同じものを保持してください。

`appendChild` で把握した親子関係を記録し、別の親へ移すと記録も移します。`remove` は要素自身と既知の子孫を、`textContent` の代入は既知の子孫だけを解放します。解放時にリスナーと id の登録を消し、解放済み要素への変更は無視します。同じ id を再取得すると新しいハンドルになります。自己参照や既知の祖先を子にする操作は無視します。

最初の HTML の親子関係は Réplique には分かりません。その子孫を `getElementById` で取得してリスナーを付け、親を `remove` しても、Réplique 側にはそのクロージャが残ります。Scene 側は実際の DOM の部分木を解放します。

`() => {}` もリスナー引数に書けます。asc 0.28.20 では引数なしの名前付き関数を直接渡すと型エラーになるため、`() => showDetails()` と包みます。無名関数から this やローカル変数は参照できず、グローバルのインスタンスを通します。

### WASM import（案・実装済み）

モジュールは `binette` です。文字列は AS のポインタ、番号は i32 です。

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

アプリは `apps.*`・`os.*`・`storage.*`・`shell.*` の import を直接は使わず、辞書から取ったクラスを通します。辞書に載っていないキーの import を直接呼ぶと（辞書を通さない呼び出し）、権限のない呼び出しとして例外でアプリを終了します（[regie/run.md](regie/run.md#メッセージ実装済み)）。番号の範囲外も例外です。任意の URL や SVG をアプリから渡す API はありません。

## API の辞書（実装済み、形は案）

[役割と API](roles.md) の辞書です。OS が `onCreate(last, api)` の第 2 引数で渡します。AS には動的な型がないので、`api.get<T>(key)` の型引数 `T` とキーが合う既知のクラスを返します。届いていない、キーを知らない、型引数が合わないときは null です。

```ts
export enum Why { Granted, NotGranted, NotAssigned }
export class Api {
  get<T>(key: string): T | null;
  why(key: string): Why;
}
```

- `why` は取れない理由を返します。`NotGranted` は権限がない、`NotAssigned` はそのキーを持つ役割に割り当てられていません。取れるなら `Granted` です。知らないキーはどの役割にも属さないので `NotAssigned` です（案）
- 辞書の中身は起動のときに決まり、その場では変わりません。ホームの割り当てを設定アプリで変えると、前のホームは Destroy され、新しいホームが次の起動から `apps` を受け取ります（ほかの役割の変え方は未決）
- `Api` はコンストラクタを持つので `new Api()` でも作れますが、辞書の中身は `onCreate` で渡すものと同じです。トップレベルの初期化（`_start`）から使ってもかまいません

| キー | クラス | 届く相手 | 内容 |
| --- | --- | --- | --- |
| `shell` | `ShellApi` | シェル | 起動中の一覧、切り替え、閉じる、ホーム、戻る、インストール案内。通知は入口だけ（[apps/shell.md](apps/shell.md)） |
| `apps` | `AppsApi` | ホーム（とシェル） | `count()`・`name(i)`・`id(i)`・`open(i)`・`icon(img, i)`。ホームに渡すアプリの一覧と起動 |
| `os` | `OsApi` | 設定アプリ | `get(name)`・`set(name, value)`、`role(role)`・`candidateCount(role)`・`candidateName(role, i)`・`candidateId(role, i)`・`assign(role, i)`、`launchCount()`・`launchTime(i)`・`launchName(i)`、`updateAvailable()`・`update()` |
| `storage` | `StorageApi` | すべてのアプリ | `has(name)`・`read(name)`・`write(name, value)`・`remove(name)`・`count()`・`name(i)`。アプリごとのデータ（`/data/<id>/`） |
| `fs` | `FsApi` | 誰にも届かない（案） | 空のクラス。範囲の決め方が未決なので、キーだけ用意している |

```ts
class Home extends App {
  onCreate(_last: Last, api: Api): void {
    const apps = api.get<AppsApi>("apps");
    if (apps == null) { /* api.why("apps") で NotAssigned などを見る */ }
  }
}
```

### OsApi

設定アプリ（役割 settings に割り当てられたアプリ）だけに届きます。`binette` モジュールの同名の WASM import に対応します。

- get/set の name は `stackSize`・`stopDelay`・`callTimeout`・`destroyTimeout`・`historyLimit`・`homeRetryWindow`。時間はミリ秒。stackSize は 1 以上、historyLimit は 0 以上、stopDelay/homeRetryWindow は 0 以上、callTimeout/destroyTimeout は 1000 以上。set は範囲外や知らない名前なら false を返して変更せず、OS にも送りません。get の知らない名前は例外です
- set は Worker の写しも更新し、続く get に反映します。OS は範囲を再確認して SystemStore に保存し、[変更が効く時点](lifecycle.md#値を変えたときに効く所案実装済み)から使います。bool は範囲の検査の結果で、保存の完了通知ではありません。保存の失敗は OS のエラー表示に出ます
- `role(role)` は役割に割り当てたアプリの installedAppKey（`JSON.stringify([source, manifest.id])`）です。割り当てが無ければ空文字列です。`candidateCount`・`candidateName`・`candidateId` は、その役割に選べるアプリの数・名前・installedAppKey です。割り当てを変えられるのは `home` と `shell`（今）で、ほかの役割は 0 です。候補は保存済みの、その役割を名乗るアプリで、入手元を問いません。`assign(role, i)` はその番号のアプリを割り当てて保存し、Worker の `role` も更新します。番号の範囲外は例外です。割り当てを変えられない役割（設定など）は候補が 0 なので、assign は必ず例外になります
- launchCount/launchTime/launchName は設定アプリのインスタンスを作る直前の起動の履歴の写しです。新しい順、日時は Unix epoch ミリ秒の f64、名前が無ければ installedAppKey。番号の範囲外は例外です。閉じて開き直すと更新し、前面へ戻すだけでは更新しません
- `updateAvailable()` は設定アプリの起動時に、新しい版の `/system` があったかです。`update()` は OS に更新を頼みます。OS は `/system` を入れ替えて再読み込みします。完了や失敗は戻りません（失敗は OS のエラー表示に出ます）。更新を渡されていないときの `update()` は何もしません
- role/candidateName/candidateId/launchName は文字列ポインタ、launchTime は f64、それ以外の番号・数値・bool は i32 を使います

### StorageApi

アプリごとのデータ（`/data/<アプリの ID>/`）です。名前は 1 つの部品（`/` を含めてもよいが、階層にはならない）で、1〜256 文字。中身は文字列だけです。

- 起動のときにアプリのデータを Worker に写し、`read`・`has`・`count`・`name(i)`（名前の辞書順）はその写しから返します。`write`・`remove` は写しを更新して OS に知らせ、OS が順に保存します。完了は待てません
- `read` は無ければ null です。`write` は名前が空か 256 文字を超えるとき false を返して保存しません。無い名前の `remove` は何もしません
- 容量の上限と、ほかのタブや窓との同時書き込みの扱いは未決です。アプリの ID `system` は使えません（OS の記録と同じ場所のため）

`@external("binette", "dom.text")` と `// @ts-ignore: decorator` で import を宣言します。型検査は Deno と asc の両方で行います。AS235（クラスや名前空間自体は WASM の export にならない）は想定した警告です。

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
