# Régie: プロセス

[Régie の目次](README.md)

起動したアプリ 1 つ分（インスタンスのうち、動いている側）の状態を進める部分です。[実行](run.md)の上に載り、状態の移り変わり、時間切れ、最後の状態と起動の履歴の保存、イベントを届けてよいかの判断を持ちます。DOM には触りません。画面は Scene が [アプリの置き場](../scene/mount.md) で受け持ちます。

状態の移り変わり、時間切れ、保存、イベントの判断は Régie の `startProcess` が受け持ちます。Scene の `mountApp` は DOM とクリックを受け持ちます。「API」の節は案です。ほかの節は実装済みの動きを記し、移してもその動きは変えません。

## API（案）

```ts
interface ProcessOptions {
  callTimeout?: number; // ミリ秒、既定 5000
  stopDelay?: number; // ミリ秒、既定 10000
  destroyTimeout?: number; // ミリ秒、既定 5000
  page?: string;
  persistence?: { store: SystemStore; key: string; historyLimit?: number };
  /** アプリに渡す API の辞書。載せたキーだけが届く。省いたキーの理由は denied に書く。辞書を通さない呼び出しは、アプリを終了する例外になる（[権限](system.md#権限)） */
  grants?: {
    apps?: { id: string; name: string; icon?: string }[];
    os?: OsSnapshot;
    storage?: Map<string, string>;
    denied?: Record<string, "NotGranted" | "NotAssigned">;
  };
  onOpen?: (i: number) => void;
  onSet?: (name: string, value: number) => void;
  onAssign?: (role: string, i: number) => void;
  onUpdate?: () => void;
  onStorage?: (name: string, value: string | null) => void;
  /** 今の呼び出しが終わってから、自分を閉じる */
  onFinish?: () => void;
  /** アプリを終了しない呼び出しの失敗 */
  onError?: (error: unknown) => void;
  /** startProcess の完了後にアプリが終了したとき */
  onExit?: (error: Error) => void;
  createWorker?: LaunchOptions["createWorker"];
  signal?: AbortSignal;
}
interface Process {
  readonly app: RegieApp;
  readonly state: State;
  /** DOM 操作の受け先をつなぐ。つなぐ前に溜まった操作（_start の分）を先に渡す */
  attach(sink: (ops: DomOp[]) => void): void;
  /** Create → Start(Create) → Resume を知らせる。attach のあとに呼ぶ */
  begin(): Promise<void>;
  /** リスナーの番号でイベントを届ける。届けるかどうかはプロセスが決める */
  dispatch(listener: number): void;
  /** 宣言的 UI の要素ハンドルでクリックを届ける */
  dispatchUi(handle: number): void;
  /** 宣言的 UI の入力欄の文字を、入力の版と一緒に届ける */
  dispatchUiText(handle: number, value: string, version?: number): void;
  /** 宣言的 UI の値を返す部品（checkbox・radio・slider・picker・segmented・tabs）の値を、入力の版と一緒に届ける（案） */
  dispatchUiValue(handle: number, value: number, version?: number): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  destroy(kind: DestroyKind, cause: DestroyCause): Promise<void>;
  setFrozen(frozen: boolean): void;
  setStopDelay(delay: number): void;
  /** 状態を知らせずに Worker を止める */
  stop(): void;
}
function startProcess(wasm: Uint8Array | ArrayBuffer, options?: ProcessOptions): Promise<Process>
```

- `startProcess` は最後の状態を読み、`launchApp`（[run.md](run.md#launchapp)）で `_start` まで走らせてから解決します。この時点ではまだ状態を知らせません
- 呼ぶ側（システム、または単独で使うなら利用者）は、画面を用意して `attach` し、`begin` を呼びます。HTML を描く前に `onCreate` が走らないようにするためです
- 名前と形は案です。`MountOptions` と `MountedApp` から DOM の部分を除いたものです

## 状態と時間

State・DestroyKind・DestroyCause の番号は core が持ちます（[core.md](../core.md#ライフサイクルの番号案)）。pause は Resume → Pause、resume は Pause → Resume、Stop → Start(Stop) → Resume を知らせます。同じ状態への重複通知はしません。destroy は必要なら Pause → Stop を通り、Destroy を知らせたあと Worker を止めます。

Pause から stopDelay 後に Stop にします。setFrozen(true) でタイマーを解除して残り時間を覚え、false で残りから数え直します。resume・destroy・stop ではタイマーを解除します。

setStopDelay(delay) は次の Pause から使う時間を変更します。今 Pause で進んでいる計時は変更しません。grants の `os`・`storage` と onSet・onUpdate・onStorage は LaunchOptions に渡し、onAssign は状態の通知と起動の完了後に通知します。渡してよいアプリの条件はシステムが確かめます（[system.md](system.md#権限)）。

onDestroy は destroyTimeout で Worker を止めます。Destroy 中は Régie の時間切れや終了も onError / onExit に流さず、エラー表示やホーム復帰を重複させません。二つの時間切れは先に来た方で終了します。Pause・Stop の失敗は通常の終了として扱います。

finish と open は現在の呼び出しが終わるまで保留し、状態の通知の途中に別の呼び出しを入れません。onCreate / onStart で finish した場合は、続く起動通知をやめ、onFinish を知らせます。Stop から戻るときの onStart(Stop) で finish した場合も、Resume に進みません。stop は状態を通知せずに Worker を止めます。

状態の通知、イベント、要求の知らせは 1 本の列で順に処理します。Régie が知らせたエラーは call の reject から二重に知らせません。起動中の失敗は startProcess または begin の reject、完了後の終了は onExit で知らせます。

## イベントを届けるか

Scene はクリックを受けたら、リスナーの番号を `dispatch` に渡すだけです。届けるかどうかはプロセスが決めます。

- Pause・Stop・Destroy のときと、閉じている途中は捨てる
- 起動の途中（Create・Start）は捨てずに待たせ、Resume のあとに届ける（onCreate で作ったボタンが、すぐ押されても効くように。案）
- 届けるときは `app.call("__bina_event", listener)` を呼ぶ。Réplique が Event の type と currentTarget を用意する
- finish や open を受けて、まだ知らせていない間は届けない

## 最後の状態と起動の履歴（案）

persistence を指定すると、起動前に store.getLast(key) を読みます。key は installedAppKey です。無ければ None・done=true・page=""・reason=User/Os を使います。前回の page と reason は LaunchOptions.last で Worker に渡します。

Create の直前に日時と key を履歴に足します。historyLimit は既定 100。各メソッドの前に `{ state, done: false, page, reason }` の保存を待ち、呼び出しが正常に返ったら done=true の保存を待ちます。状態の通知と保存は直列です。reason は Destroy のときだけ更新し、ほかでは前の値を保ちます。例外・時間切れ・stop で途中で切れたら done=false が残ります。保存の失敗もアプリの終了として扱い、続くメソッドを呼びません。persistence を省いたプロセスは保存しません。

## 宣言的 UI（案）

Worker は画面の木を前回と比較して差分を Scene に渡します。Scene はクリックした要素のハンドルを `dispatchUi(handle)` に渡し、Worker は現在の木にある要素の現在のハンドラーと build 番号で WASM を呼びます。要素が消えたかハンドラーが無い場合は捨てます。イベントを届ける状態の判断は HTML 方式と共通です。値を返す部品の操作（`dispatchUiValue`）は入力欄の文字と同じく、捨てるときも版を Worker に知らせ、表示をアプリの値に戻します。詳しくは [宣言的 UI](../ui.md) を参照してください。
