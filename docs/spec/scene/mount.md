# Scene: 描画とつなぎ方

[Scene の目次](README.md)

## mountApp

```ts
interface MountOptions {
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
}
interface MountedApp {
  /** Régie で動いているアプリ */
  readonly app: RegieApp;
  /** アプリを止め、クリックの受け付けをやめる */
  stop(): void;
}
function mountApp(element: HTMLElement, built: BuiltApp, options?: MountOptions): Promise<MountedApp>
```

HTML を枠に描き、Régie を起動して `onDom` の操作を反映します。export に start があれば call してから解決します。HTML ＋ AS → WASM、通常の id と document API を使い、bina 属性を OS が読まない方針は **決定 2026-10-27** です（[Réplique](../replique.md#画面を操作する方針決定-2026-10-27)）。

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

リスナーは `app.call("__bina_event", listener)` を呼ぶ。Réplique が Event の type と currentTarget を用意する。起動の ready 待ちのクリックは捨てる。Régie が知らせたエラーは call の reject から二重に知らせない。

`stop()` と signal の中断、アプリ終了で全リスナーを外す。stop は描いた HTML は消さない。起動中の失敗は mountApp の reject、完了後の終了は onExit で知らせる。`element.style.contain = "paint"` で描画を枠に収める。DOM は element.ownerDocument から辿る。

## まだしていないこと

- 最初の HTML の検査（script・on* 属性・外部 URL など。別作業）。今は innerHTML に描くため on* 属性は動く
- setAttribute・style・value・input イベント・click 以外のイベント
- entry.css の読み込み、Shadow DOM などによる CSS の分離
