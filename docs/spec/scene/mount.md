# Scene: アプリの置き場

[Scene の目次](README.md)

インスタンス 1 つ分の DOM です。アプリの HTML を描き、アプリからの DOM 操作を反映し、クリックを Régie のプロセスに渡します。状態の移り変わりと「届けてよいか」の判断は Régie のプロセスが持ちます（[regie/process.md](../regie/process.md)）。

## mountApp（案）

```ts
interface MountOptions {
  /** ホームに渡したアプリの一覧。icon の操作で使う */
  apps?: { id: string; name: string; icon?: string }[];
  /** アプリを終了しない誤り（作れないタグなど） */
  onError?: (error: unknown) => void;
}
interface MountedApp {
  /** リスナーを外す。描いた HTML は消さない */
  stop(): void;
}
function mountApp(element: HTMLElement, html: string, process: Process, options?: MountOptions): MountedApp
```

1. `element.style.contain = "paint"` で描画を枠に収める
2. `element.innerHTML = html` で描く
3. `process.attach(ops => …)` で DOM 操作を受け始める。`_start` の間に溜まった操作が先に届く
4. クリックを受けたら `process.dispatch(listener)` を呼ぶ

`begin`（Create → Start → Resume）を呼ぶのは呼ぶ側（Régie のシステム）です。現在の `mountApp(element, html, process, options)` は、HTML を描いて DOM 操作を反映し、クリックをプロセスに渡します。プロセスの起動と状態の移り変わりは Régie の `startProcess` が受け持ちます。

HTML ＋ AS → WASM、通常の id と document API を使い、bina 属性を OS が読まない方針は **決定 2026-10-27** です（[Réplique](../replique.md#画面を操作する方針決定-2026-10-27)）。

## 要素と操作（案・実装済み）

- byId は「番号 → id」だけを持つ。使うたびに枠の querySelector で子孫を探す。`[id="…"]` の引用符・バックスラッシュ・制御文字を CSS の 16 進エスケープにする。グローバルの document.getElementById は使わない
- 無い id の操作は何もしない。null は AS に返さず、アプリを終了しない（決定 2026-10-27）
- create は「番号 → 作った要素」を持つ。タグは小文字にして、次だけ許す: div span p h1 h2 h3 h4 h5 h6 button ul ol li img section header footer nav main article label strong em small br hr
- 許可しないタグ（script・iframe・object・a・style・template など）は作らない。以後その番号の操作は何もしない。onError に知らせ、アプリは終了しない
- button は type="button"、img は装飾用に alt="" を付ける。属性 API を足すまでの小さな既定動作とする
- text は textContent を書き、子をすべて消す。class は class 属性を書く（SVG の className は読み取り専用のため。案）。見つかった対象だけを変える
- append の親と子、remove の対象は枠内か作った要素だけ。枠自体は消せず、子にもできない。自己参照や祖先を子にする操作は無視する
- 作った要素は未接続でも操作できる。remove または text により取り除いた部分木のハンドルは解放し、以後そのハンドルへの操作は無視する（案）
- icon は img だけ。OS の SVG を `data:image/svg+xml;charset=utf-8,` ＋ encodeURIComponent(icon) で src に入れる。アイコンが無ければ src を消す。SVG は innerHTML に入れない

## イベント（案・実装済み）

listen は click だけ本物のリスナーを付ける。それ以外は onError に知らせて何もしない。byId は listen の時点で見つかった要素に付けるので、あとから同じ id の要素に交換してもリスナーは移らない。

unlisten は対応する DOM リスナーを外して登録を消します。remove と text は、取り除く DOM の部分木にある `created`・`ids` のハンドルとリスナーを忘れます。text の対象自身は残します（案）。

リスナーは `process.dispatch(listener)` を呼ぶだけです。Pause・Stop・Destroy のクリックを捨てる、起動の途中のクリックを Resume まで待たせる、といった判断はプロセスがします（[regie/process.md](../regie/process.md#イベントを届けるか)）。

`stop()` で全リスナーを外す。mountApp はプロセスの終わりを見ないので、プロセスが終わる経路ではどれも、呼ぶ側が MountedApp の `stop()` も呼ぶ: `onExit` を受けたとき、`begin()` が reject したとき、`process.destroy()` が終わったとき、`process.stop()` を呼ぶとき。Binette のシステム UI は、置き場を消すときにプロセスと MountedApp の両方を止める。stop は描いた HTML は消さない。DOM は element.ownerDocument から辿る。

## まだしていないこと

- 最初の HTML の検査（script・on* 属性・外部 URL など）。検査は Régie のビルドに足す（[regie/build.md](../regie/build.md#検証案)）。今は innerHTML に描くため on* 属性は動く
- setAttribute・style・value・input イベント・click 以外のイベント
- entry.css の読み込み、Shadow DOM などによる CSS の分離
