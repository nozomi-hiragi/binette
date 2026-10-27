# Scene: 描画とつなぎ方

[Scene の目次](README.md)

## mountApp

```ts
interface MountOptions {
  callTimeout?: number; // ミリ秒、既定 5000
  stopDelay?: number; // ミリ秒、既定 10000
  destroyTimeout?: number; // ミリ秒、既定 5000
  page?: string;
  persistence?: { store: SystemStore; key: string; historyLimit?: number };
  onFinish?: () => void;
  /** アプリを終了しない呼び出しの失敗 */
  onError?: (error: unknown) => void;
  /** mountApp の完了後にアプリが終了したとき */
  onExit?: (error: Error) => void;
  /** Worker を作る関数。省略すると Régie の Blob URL の Worker */
  createWorker?: LaunchOptions["createWorker"];
  /** 起動中でもアプリを止める */
  signal?: AbortSignal;
  apps?: { id: string; name: string; icon?: string }[];
  onOpen?: (i: number) => void;
  os?: LaunchOptions["os"];
  onSet?: LaunchOptions["onSet"];
  onSetHome?: LaunchOptions["onSetHome"];
}
interface MountedApp {
  /** Régie で動いているアプリ */
  readonly app: RegieApp;
  readonly state: State;
  pause(): Promise<void>;
  resume(): Promise<void>;
  destroy(kind: DestroyKind, cause: DestroyCause): Promise<void>;
  setFrozen(frozen: boolean): void;
  setStopDelay(delay: number): void;
  /** アプリを止め、クリックの受け付けをやめる */
  stop(): void;
}
function mountApp(element: HTMLElement, built: BuiltApp, options?: MountOptions): Promise<MountedApp>
```

Régie で _start を走らせてから HTML を枠に描き、初期化中に溜めた `onDom` の操作を反映します。`__bina_lifecycle(Create, last.state, Number(last.done))` → Start(Create) → Resume を呼んでから解決します。HTML ＋ AS → WASM、通常の id と document API を使い、bina 属性を OS が読まない方針は **決定 2026-10-27** です（[Réplique](../replique.md#画面を操作する方針決定-2026-10-27)）。

## 要素と操作（案・実装済み）

- byId は「番号 → id」だけを持つ。使うたびに枠の querySelector で子孫を探す。`[id="…"]` の引用符・バックスラッシュ・制御文字を CSS の 16 進エスケープにする。グローバルの document.getElementById は使わない
- 無い id の操作は何もしない。null は AS に返さず、アプリを終了しない（決定 2026-10-27）
- create は「番号 → 作った要素」を持つ。タグは小文字にして、次だけ許す: div span p h1 h2 h3 h4 h5 h6 button ul ol li img section header footer nav main article label strong em small br hr
- 許可しないタグ（script・iframe・object・a・style・template など）は作らない。以後その番号の操作は何もしない。onError に知らせ、アプリは終了しない
- button は type="button"、img は装飾用に alt="" を付ける。属性 API を足すまでの小さな既定動作とする
- text は textContent を書き、子をすべて消す。class は class 属性を書く（SVG の className は読み取り専用のため。案）。見つかった対象だけを変える
- append の親と子、remove の対象は枠内か作った要素だけ。枠自体は消せず、子にもできない。自己参照や祖先を子にする操作は無視する
- 作った要素は未接続でも操作・再追加できる。byId で参照した既存要素は取り除いたら検索できなくなる
- icon は img だけ。OS の SVG を `data:image/svg+xml;charset=utf-8,` ＋ encodeURIComponent(icon) で src に入れる。アイコンが無ければ src を消す。SVG は innerHTML に入れない

## イベントと終了（案・実装済み）

listen は click だけ本物のリスナーを付ける。それ以外は onError に知らせて何もしない。byId は listen の時点で見つかった要素に付けるので、あとから同じ id の要素に交換してもリスナーは移らない。

リスナーは `app.call("__bina_event", listener)` を呼ぶ。Réplique が Event の type と currentTarget を用意する。Pause・Stop・Destroy のクリックは捨てる。起動の途中（Create・Start）のクリックは捨てずに待たせ、Resume のあとに届ける（onCreate で作ったボタンが、すぐ押されても効くように。案）。状態の通知とイベントは直列に処理する。Régie が知らせたエラーは call の reject から二重に知らせない。

`stop()` と signal の中断、アプリ終了で全リスナーを外す。stop は描いた HTML は消さない。起動中の失敗は mountApp の reject、完了後の終了は onExit で知らせる。`element.style.contain = "paint"` で描画を枠に収める。DOM は element.ownerDocument から辿る。

## 状態と時間（実装済み）

State・DestroyKind・DestroyCause は Scene からも export し、Réplique と同じ番号です。pause は Resume → Pause、resume は Pause → Resume、Stop → Start(Stop) → Resume を知らせます。同じ状態への重複通知はしません。destroy は必要なら Pause → Stop を通り、Destroy を知らせたあと Worker を止めます。

Pause から stopDelay 後に Stop にします。setFrozen(true) でタイマーを解除して残り時間を覚え、false で残りから数え直します。resume・destroy・stop ではタイマーを解除します。

setStopDelay(delay) は次の Pause から使う時間を変更します。今 Pause で進んでいる計時は変更しません。os と onSet は LaunchOptions に渡し、onSetHome は状態の通知と mountApp の完了後に通知します。渡してよいアプリの条件は shell が確認します。

onDestroy は destroyTimeout で Worker を止めます。Destroy 中は Régie の時間切れや終了も onError / onExit に流さず、エラー表示やホーム復帰を重複させません。二つの時間切れは先に来た方で終了します。Pause・Stop の失敗は通常の終了として扱います。

finish と open は現在の呼び出しが終わるまで保留し、状態の通知の途中に別の呼び出しを入れません。onCreate / onStart で finish した場合は、続く起動通知をやめ、onFinish を知らせます。Stop から戻るときの onStart(Stop) で finish した場合も、Resume に進みません。stop は状態を通知せずに Worker とリスナーを止め、HTML は残します。

## まだしていないこと

- 最初の HTML の検査（script・on* 属性・外部 URL など。別作業）。今は innerHTML に描くため on* 属性は動く
- setAttribute・style・value・input イベント・click 以外のイベント
- entry.css の読み込み、Shadow DOM などによる CSS の分離

## 最後の状態と起動の履歴（案・実装済み）

persistence を指定すると、起動前に store.getLast(key) を読みます。key は installedAppKey です。無ければ None・done=true・page=""・reason=User/Os を使います。前回の page と reason は LaunchOptions.last で Worker に渡します。

Create の直前に日時と key を履歴に足します。historyLimit は既定 100。各メソッドの前に `{ state, done: false, page, reason }` の保存を待ち、呼び出しが正常に返ったら done=true の保存を待ちます。状態の通知と保存は直列です。reason は Destroy のときだけ更新し、ほかでは前の値を保ちます。例外・時間切れ・stop で途中で切れたら done=false が残ります。保存の失敗もアプリの終了として扱い、続くメソッドを呼びません。persistence を省いた単独の mountApp は保存しません。
