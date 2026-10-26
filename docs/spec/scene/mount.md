# Scene: 描画とつなぎ方

[Scene の目次](README.md)

## mountApp

```ts
interface MountOptions {
  /** アプリの中で起きたエラーや、呼び出しの失敗 */
  onError?: (error: unknown) => void;
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

1. `element.style.contain = "paint"` にする（アプリの描画が `element` の外に出ないように）
2. `element.innerHTML = built.html` で HTML を描く
3. Régie の `launchApp(built.wasm, …)` でアプリを起動する。`onText` を下の `bina` につなぐ
4. `element` に `click` のリスナーを 1 つ付ける（下の `bina-on-click`）
5. `app.exports` に `start` があれば `app.call("start")` を待つ。失敗したら `stop()` してから同じエラーで reject する
6. `{ app, stop }` で解決する

- 起動（3）に失敗したら、そのエラーで reject します。描いた HTML はそのまま残ります
- `signal` の中断でもアプリとリスナーを止める。起動中なら reject する
- クリックのリスナーは起動（3）が済んでから付けます。HTML を描いてから起動が済むまでのクリックは捨てます
- `stop()` はリスナーを外し、`app.stop()` を呼びます。描いた HTML は消しません
- DOM はグローバルの `document` を使わず、`element` から辿ります（テストで happy-dom の要素を渡すため）。描画とクリックのテストは happy-dom（MIT、テストだけの依存）で行います。deno-dom には `style` が無く、`click` のイベントも届かないためです

### HTML とアプリのつなぎ方

次のことを決めました（決定 2026-10-26）。

- HTML では、要素に `bina="名前"` で名前を付ける。アプリ（AS）は `elem("名前")` でその要素を操作する
- 同じ名前の要素はまとめて変わる（見出しと本文に同じ件数を出す、など）
- 名前を探すのは、そのアプリの領域（`mountApp` の `element`）の中だけ。フロントやほかのアプリの要素には届かない
- Binette の属性の接頭辞は `bina`。`data-*`・`id`・`class` はアプリが自由に使える

```html
<h1 bina="count">0</h1>
<p>いま <span bina="count">0</span> 件</p>
<button bina-on-click="increment">+1</button>
```

| HTML | アプリ側（Réplique） | 意味 | 状態 |
| --- | --- | --- | --- |
| `bina="name"` | `elem("name").text = "…"` | 文字を書き換える | 実装済み |
| `bina="name"` | `elem("name").text` | アプリが最後に書いた文字を読む | 実装済み |
| `bina-on-click="fn"` | `export function fn(): void` | クリックで `fn()` | 実装済み |
| `bina="name"` | `elem("name").show = true` | 表示・非表示 | 案 |
| `bina="name"` | `elem("name").enabled = false` | 有効・無効 | 案 |
| `bina="name"` | `elem("name").value` | 入力欄の値の読み書き | 案 |
| `<template bina="list">` | `list("list").add()`・`clear()`、`item.elem("…").text` | 一覧の繰り返し | 実装済み（形は案） |
| 行の `img[bina-icon]` | `item.icon(i)` | OS がアイコンを画像に入れる | 実装済み（形は案） |
| `bina-on-input="fn"` | `export function fn(value: string): void` | 入力で `fn(値)` | 案 |
| `bina-on-submit="fn"` | `export function fn(): void` | 送信で `fn()`（ページ移動はしない） | 案 |

一覧の行（実装済み、形は案）:

- `list.add` は `template.content` を写し、template の兄弟として最後の行の後ろに足す。行番号は Worker が 0 から数える。`list.clear` で全行を消す
- `item.text` は指定した一覧・行の中だけで `bina` の名前を探し、`textContent` を変える。行の外や別の行には届かない
- 行の `bina-on-click` は `app.call(fn, row)` で i32 の行番号を渡す。行の外は引数なし
- `item.icon(i)` は行の `img[bina-icon]` の src に OS の SVG を `data:image/svg+xml;charset=utf-8,` ＋ `encodeURIComponent` で入れる。SVG を innerHTML に入れず、任意の URL を渡す道も作らない
- `apps` はホーム用の一覧。Régie へは id と name だけを渡し、icon は Scene に置く。`apps.open(i)` は `onOpen(i)` に知らせる

`bina="name"`（実装済み）:

- アプリが `elem(name).text = value` と書くと、Régie から Scene に届き、`element` の中の、一覧の行と template を除く `bina` を持つ要素のうち、属性の値が `name` と完全に一致するものすべての `textContent` を `value` にします
- 一致する要素が無ければ何もしません。HTML に最初から書いた文字（`0` など）は、アプリが書くまでそのまま出ます
- `element` の外にある、同じ名前の要素は変えません

`bina-on-click`（実装済み）:

- `element` で受けたクリックの `event.target` から `closest("[bina-on-click]")` で要素を探します。要素が `element` の中にあり、属性の値が空でなければ、その値の名前で `app.call(name)` を呼びます
- 既定の動作（リンクの移動、フォームの送信など）は止めません
- 呼び出しが失敗したら `onError` に渡します。Régie が `onError` で知らせたエラーと同じものは、二度は渡しません

### 読める値（案）

アプリは Worker の中にいて、画面（DOM）にその場で聞くことはできません。読めるのは「アプリの手元に写しがある値」だけです。

- アプリが自分で書いた値（`text` など）: Réplique が書くときに覚えておく（`text` は実装済み）
- 入力欄の値（`value`）: 入力のたびに Scene が Régie を通して値を送り、Réplique が覚えておく。Worker はメッセージを順に処理するので、ボタンを押したときには、それより前の入力はもう届いている
- 要素の大きさや位置など、写しの無い値: 「終わったら呼ぶ関数」を渡して受け取る。AS には Promise・async・クロージャが無いため（[replique.md](../replique.md#結果を受け取る呼び出し案)）

### 止める操作（案）

`elem()` からできる操作は、Binette が決めた一覧だけにします。次のような危ない操作は用意しません。

- HTML の差し込み（`innerHTML` にあたるもの）。文字は `textContent` で入れる
- `on*` 属性（`onclick` など）を付けること
- 外の URL を `src`・`href`・CSS の `url()` に入れること

### まだしていないこと

- HTML の検証（`<script>`・`on*` 属性・外部 URL が無いこと）。今は `innerHTML` にそのまま入れます。`<script>` は `innerHTML` では実行されませんが、`on*` 属性は動きます
- `entry.css` の読み込みと、テーマの CSS 変数
- Shadow DOM などでの、フロントの CSS とアプリの CSS の分離

