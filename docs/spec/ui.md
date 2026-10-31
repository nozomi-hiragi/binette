# 宣言的 UI（案）

[仕様の目次](README.md) · [Décor のパッケージと API](decor.md)

HTML 方式に加え、`app.json` の `entry.html` を省略すると宣言的 UI を使います。`entry.as` は必須です。アプリは HTML や CSS を書かず、OS が用意した部品と修飾で画面を表します。名前や動作はすべて案です。

```ts
import { App, launch } from "jsr:@binette/replique";
import { View, column, row, text, button } from "jsr:@binette/replique/ui";
let count = 0;
function increment(): void { count++; }
class Counter extends App {
  build(): View {
    return column([text("押した回数: " + count.toString()), row([button("+1", increment)])]).gap(8).padding(16);
  }
}
launch(new Counter());
```

`App.build(): View | null` の既定値は `null` で、HTML 方式は従来どおりです。OS がライフサイクルのメソッドやイベントを呼んだ後に `build()` を呼びます。`View` は共通の型で、`column(children)`、`row(children)`、`text(s)`、`button(label, f)`、子を含むボタンを返す `buttonOf(children, f)`、入力欄 `input(value, onText)`、グリッド `grid(children)`、アイコン `appIcon(i)` を使えます。ボタンのハンドラーはトップレベルの引数なし関数か、`arg(i)` を組み合わせた `i32` 引数を一つ持つ関数です。入力の `onText` は `(s: string) => void` で、入力のたびに現在の文字列を受け取ります。`input(value, onText).multiline()` は textarea を描画し、改行を含む値を扱います。

修飾は `padding(n)`、`gap(n)`、`grow()`、`key(s)`、読み上げ用の `label(s)`、`enabled(b)`、`arg(i)`、グリッドの列の最小幅をピクセルで指定する `minWidth(px)` です。key を付けた兄弟は、順序を変えても同じ DOM 要素を使い続けます。

Réplique は build ごとにハンドラー番号を振り直し、画面の木を一つの文字列として Worker に渡します。Worker が Décor で前の木との差分を作り、Scene が Décor で DOM を作って差分を反映します（分担は案）。Scene はクリックした要素のハンドルを渡します。Worker は現在の木からその要素とハンドラーを探し、現在の build 番号で呼びます。要素が消えたか、ハンドラーが無いか、今の木で `enabled(false)` なら、クリックを捨てます（待っているクリックも同じです）。同じ要素への続けたクリックは、描き直しを挟んでもそれぞれ届けます。クリックを届ける条件は [プロセス](regie/process.md) の既存の条件と同じです。

宣言的 UI では `document` API の DOM 操作は何もしません。HTML 方式では従来どおり使えます。

`input`（複数行を含む）の `label` は読み上げ用の名前、`enabled(false)` は入力の無効化に使います。描き直しの値が DOM の値と同じなら value を書き直さず、入力中のカーソルと IME の変換を保ちます。`grid` は CSS grid の auto-fill と minmax で子を並べます。`appIcon(i)` は OS が持つアプリのアイコンを表示し、ホーム以外が使うとアプリを終了します。`show(cond, view)` は条件が false のとき非表示にし、DOM は保持します。入力中の古い描画結果は、後から打った文字を上書きしません。

見た目は `:where(.bina-ui-…)` と `--bina-ui-…` の OS テーマ変数で決めます。

## 見出し・一覧と OS の CSS（案）

- `.heading(level)` は見出しにする（level は 1〜3）。DOM には `role="heading"` と `aria-level` を付け、読み上げでも見出しになる
- `.list()` を付けた column は `role="list"`、その子は `role="listitem"` になる
- `.minWidth(px)` は、grid では列の最小幅、text・button・input では自分の最小幅
- OS の部品の CSS は、どのアプリにも同じに効く汎用のものだけにする。アプリの key（`data-bina-key`）を CSS の手がかりにしない。ボタンは最小 44px 角（見た目の修飾で詰めるものを除く）。row は縦の中央にそろえる
- テーマの変数は `--bina-ui-*`（例 `--bina-ui-grid-background`、`--bina-ui-button-background`、`--bina-ui-button-border`、`--bina-ui-button-radius`、`--bina-ui-focus`、`--bina-ui-icon-size`）
- `show(false, view)` は DOM を残して隠す。隠れている間は押せない・打てない（入力の中身などを保つため）

## 見た目の修飾（案）

色はアプリが値を指定せず、OS が持つ役割を選びます。修飾は TS と AS で共通です。DOM ではクラス `bina-ui-…` と属性になり、CSS は `:where()` で詳細度 0 です。描き直しで外した修飾はクラスと属性から外れます。

- 役割の色は、ボタンの種類・文字の色・面の 3 つの修飾に分ける。どれも効く部品と名前の組が違い、同じ部品に別々に付けられる（例: 面の中の文字の色）。知らない名前は無視して既定に戻す。合わない部品に付けても効かない
  - `variant(name)` はボタンの種類を選ぶ（button・buttonOf）。クラスは `bina-ui-variant-<name>`。`"primary"`（アクセントの塗り）、`"ghost"`（背景も枠も無く、文字は薄い色。hover で薄い面）、`"subtle"`（薄い面、枠なし）、`"danger"`（ghost の形で赤い文字）、`"dashed"`（破線の枠の小さなチップ）。variant 無しは従来の既定。variant 付きのボタンは未指定の padding を上下 4px・左右 10px（dashed は 2px・8px）にし、theme の button の padding があればそちらを使う
  - `tone(name)` は文字の色を選ぶ（text）。クラスは `bina-ui-tone-<name>`。`"muted"`（薄い文字）、`"accent"`、`"danger"`、`"success"`
  - `surface(name)` は面を選ぶ（column・row・grid）。クラスは `bina-ui-surface-<name>`。`"surface"`（白い面）、`"sunken"`（灰色のキャンバス）、`"card"`（白い面・角丸・影）、`"dark"`（暗い面。中の文字・薄い文字・ghost のボタン・入力も暗い面に合わせ、入力は背景が透明で枠なし）、`"field"`（入力欄のような 1px の枠と角丸で中の部品をつなげる。中の input は枠と背景なし、中の button は枠なしで線で区切る。button の後の input は中央ぞろえ）
- `divider(side)` は `"top"`・`"right"`・`"bottom"`・`"left"` の辺に 1px の区切り線を引く。複数の辺は複数回呼ぶ。ほかの名前は無視する
- `mono()` は等幅の字体、`small()` は小さめの文字（12.5px）、`bold()` は太字、`truncate()` は text を 1 行に収めて「…」で切る
- `width(px)`・`height(px)` は固定の幅・高さ（border-box）。flex で縮めない。幅は親の幅を越えない。`height` は textarea の既定の最小の高さより優先する。`minHeight(px)` は最小の高さ。0 以下と有限でない値は指定なし
- `center()` は子を縦横の中央に置く（はみ出すときは先頭をそろえる）。`wrap()` は row の子を折り返す
- `selected(b)` は選ばれている状態。button は `aria-pressed` を付け（false も付ける）、淡いアクセントの背景と既定の文字色になる。ほかの部品は `selected(true)` で `highlight(true)` と同じアクセントの細い枠を付ける
- `highlight(b)` は部品の種類によらず、アクセントの細い枠（outline 1.5px、2px 外側）だけで印を付ける。クラスは `bina-ui-highlight`。状態は表さず、aria の属性も変えない（読み上げには出ない）。button に付けても押された状態の見た目や `aria-pressed` にはならない。プレビューで選んでいる部品を示すような用途に使う。角丸を持たない部品は角丸 4px にし、button・input・card など自分の角丸を持つ部品はその角丸のまま枠が沿う。フォーカスの枠が出ている間はフォーカスの枠を優先する
- `toggle(on)` は button を入・切のスイッチにする。`role="switch"` と `aria-checked` を付け、32×18px の丸いスイッチを描く（押せる範囲はもっと広い）。ボタンの文字は見せず、`label(s)` が無ければ読み上げの名前に使う
- `scroll()` はその部品の中だけをスクロールする（overflow:auto、最小の幅と高さは 0）
- `fill()` は flex の親の高さいっぱいに広げる。row の子では横には伸ばさず縦に引き伸ばす。アプリの一番外の部品に付けると、Scene のアプリの領域の高さいっぱいになり、領域の余白も 0 になる。中の `grow()` と `scroll()` で区画ごとにスクロールする
- `collapse()` は row に付ける。アプリの描画先の幅が 720px 未満のとき（コンテナークエリ）、子を縦に積んで全幅にし、子の `width()` を無視する。積んだ子の左右の `divider` は消し、子どうしの間の上下の線にする（`"right"` は下の線、`"left"` は上の線。前の子の下の線と重なる上の線は引かない）。外側の `fill()`、その row、row の中の `fill()` と `scroll()` による高さの固定もゆるめ、アプリの領域全体を縦にスクロールする
- column の中の button に `grow()` を付けると、横幅いっぱいに広がり、縦には伸びない。ghost と subtle の `buttonOf` は中身を左寄せにする
- 既定の入力欄（`input` と `multiline()` の textarea。`surface("dark")` と `surface("field")` の中のものを除く）は、線の色（`--bina-ui-line`）の 1px の枠、角丸 6px（`--bina-ui-input-radius`、無ければ `--bina-ui-control-radius`。theme の input の radius があればそちら）、内側の余白は上下 6px・左右 8px（`padding()` の修飾や theme の input の padding があればそちら）、背景は `--bina-ui-surface` にする。フォーカス中は（focus-visible に限らず）アクセントの 2px の枠になり、無効のときは薄くする
- ghost・subtle・dashed のボタン、`surface("field")` の中のボタン、`small()` のボタンは最小 44px をゆるめて詰められる。variant 無し・primary・danger のボタンは最小 44px のまま
- 役割の色の変数: `--bina-ui-accent`、`--bina-ui-accent-content`、`--bina-ui-accent-soft`、`--bina-ui-accent-text`、`--bina-ui-surface`、`--bina-ui-sunken`、`--bina-ui-subtle`、`--bina-ui-line`、`--bina-ui-muted`、`--bina-ui-danger`、`--bina-ui-success`、`--bina-ui-shadow`、`--bina-ui-dark`、`--bina-ui-dark-content`、`--bina-ui-dark-muted`、`--bina-ui-dark-line`、`--bina-ui-dark-subtle`、`--bina-ui-dark-accent`、`--bina-ui-dark-danger`、`--bina-ui-dark-success`、`--bina-ui-mono`、`--bina-ui-small`、`--bina-ui-control-radius`、`--bina-ui-card-radius`。どれも省略でき、省略すると白地のライトテーマの値になる。OS の index.html は `#app` で `--color-*` から割り当てる
- OS の index.html の document 方式のボタンの規則（アクセントの塗り）は、variant 無しの Décor のボタンにだけ効き、variant・スイッチ・選択・`surface("field")` の中のボタンには効かない
