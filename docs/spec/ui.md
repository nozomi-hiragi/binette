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

`App.build(): View | null` の既定値は `null` で、HTML 方式は従来どおりです。OS がライフサイクルのメソッドやイベントを呼んだ後に `build()` を呼びます。`View` は共通の型で、`column(children)`、`row(children)`、`text(s)`、`button(label, f)`、子を含むボタンを返す `buttonOf(children, f)`、入力欄 `input(value, onText)`、グリッド `grid(children)`、アイコン `appIcon(i)` を使えます。ボタンのハンドラーはトップレベルの引数なし関数か、`arg(i)` を組み合わせた `i32` 引数を一つ持つ関数です。入力の `onText` は `(s: string) => void` で、入力のたびに現在の文字列を受け取ります。`input(value, onText).multiline()` は textarea を描画し、改行を含む値を扱います。ほかに Flutter・Jetpack Compose・SwiftUI によくある部品（`spacer`・`separator`・`stack`・`checkbox`・`radio`・`slider`・`picker`・`segmented`・`tabs`・`progress`・`spinner`・`image`・`listTile`・`chip`・`badge`）があります。[よくある部品](#よくある部品案) を参照してください。

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

## よくある部品（案）

Flutter・Jetpack Compose・SwiftUI に共通する考え方の部品を、Décor の書き方（部品関数＋修飾の連鎖、色は OS の役割）で足します。名前と形はすべて案です。どれも TS（`@binette/decor`）と AS（`jsr:@binette/replique/ui`・`jsr:@binette/decor/as`）で同じ名前と引数です。AS のハンドラーはトップレベルの関数で、外の変数をつかむクロージャは使えません。

| 部品 | 引数 | DOM と role | キー操作 | 主に効く修飾 |
| --- | --- | --- | --- | --- |
| `spacer()` | なし | `div` | なし | なし（row・column の余りを埋める） |
| `separator()` | なし | `hr`（`separator`。row の中では `aria-orientation="vertical"`） | なし | なし |
| `stack(children)` | 子の配列 | `div`（grid で子を重ねる） | なし | `center()`、子の `align(name)`、子の `fill()`、`padding` |
| `checkbox(checked, onChange)` | 状態、`(checked: bool) => void` | `input type=checkbox`（`checkbox`） | Space で切り替え | `label`（読み上げの名前）、`enabled` |
| `radio(selected, onSelect)` | 状態、button と同じハンドラー | `input type=radio`（`radio`） | Space で選ぶ。Tab で 1 つずつ移る | `arg(i)`（どの値か）、`label`、`enabled` |
| `slider(value, min, max, onChange)` | 値・最小・最大、`(value: f64) => void` | `input type=range`（`slider`） | 矢印・Home・End・PageUp・PageDown（ブラウザーの既定） | `step(n)`、`label`、`enabled`、`grow`・`width` |
| `picker(options, index, onChange)` | 選択肢・選択中の番号、`(index: i32) => void` | `select`（`combobox`） | ブラウザーの既定 | `label`、`enabled`、`width`・`grow` |
| `segmented(options, index, onChange)` | 同上 | `div role=radiogroup` と `button role=radio`（`aria-checked`） | 矢印で隣へ移って選ぶ（端で折り返す）、Home・End、Tab で入るのは選択中の 1 つ | `label`、`enabled`、`grow`・`width` |
| `tabs(options, index, onChange)` | 同上 | `div role=tablist` と `button role=tab`（`aria-selected`） | segmented と同じ（自動で切り替える tablist） | `label`、`enabled` |
| `progress(value)` | 割合 0〜1。負なら不定 | `div role=progressbar`（`aria-valuemin=0`・`aria-valuemax=100`・`aria-valuenow`。不定では valuenow なし） | なし | `label`、`width`・`grow` |
| `spinner()` | なし | `div role=progressbar`（valuenow なし） | なし | `label`、`width`（直径） |
| `image(src)` | data URL | `img`（`alt` は `label`、無ければ空で飾り） | なし | `label`、`width`・`height` |
| `listTile(title, subtitle?, leading?, trailing?)` | 題・副題（省略は ""）・先頭と末尾の View（省略は null） | `div`。中は先頭・題と副題の column・末尾 | 中の部品による | `gap`（既定 `space.md`）、`padding`（既定 上下 `space.sm`・左右 `space.md`） |
| `chip(label)` | 文字 | `span` | なし | `tone(name)`、`label`、`padding` |
| `badge(value)` | 文字（数など） | `span` | なし | `tone(name)`、`label`（例「未読 3 件」） |

- 値を返す部品のハンドラーは、checkbox が押したあとの真偽、slider が数（範囲に丸める）、picker・segmented・tabs が選んだ番号を受け取る。radio は button と同じ `() => void` か `(i: i32) => void` で、`arg(i)` の値で呼ぶ
- 値はアプリが持つ。部品は入力欄と同じく「制御された部品」で、DOM は操作のすぐあとに見た目を変え、アプリの描き直しで値と入力の版を受け取ってアプリの値にそろえる。アプリが値を変えなければ（受け付けなければ）元の値に戻る。古い版の描き直しは新しい操作を戻さない
- `enabled(false)` の部品と、隠れた部品への操作はアプリに届かず、表示はアプリの値に戻る。選択肢の番号が範囲外・整数でないとき、数が有限でないときも捨てる
- 選択肢の番号が整数でないか範囲外なら、選択なし（-1）にする。slider の min・max・値が有限でないときは 0・min+1・min にする。`step(n)` が 0 以下なら刻みなし（連続）
- `separator` は修飾の `divider(side)` と名前を分けた。同じ名前で部品と修飾の意味が違うと、文書・デザイナーのコード・誤りの表示で区別しにくいため。HTML の `hr` と ARIA の `separator` に合わせる。row が `collapse()` で縦に積まれたときは横の線になる
- `listTile` は先頭・末尾に任意の View を置く（画像・checkbox・chip など）。押せる行は `buttonOf([listTile(...)], f).variant("ghost")` で作る。listTile の中の checkbox などには `label` で名前を付ける
- `stack` の子の既定の位置は左上（`topStart`）。`stack(...).center()` は全体を中央に、子の `align(name)` はその子だけを置く。`align(name)` の名前は `"topStart"`・`"top"`・`"topEnd"`・`"start"`・`"center"`・`"end"`・`"bottomStart"`・`"bottom"`・`"bottomEnd"`。column の子では横、row の子では縦の成分だけが効く。知らない名前は既定に戻す。クラスは `bina-ui-align-<name>`
- `image` は PNG・JPEG・GIF・WebP の base64 の data URL だけを描く。外部 URL・SVG・ほかの形式は `src` を付けない。Scene が document 方式の HTML を描く前の検査（sanitize）と同じ許可にした。アプリのパッケージ（`.binapp`）は manifest・HTML・アイコン・WASM だけを持ち、画像などのファイルを持たないので、アプリ内のファイルを指す形は今の仕組みでは成り立たない。ファイルを同梱する仕組みができたら足す
- `card` は作らない。`column(...).surface("card")` で足りる
- 見た目はどれも OS の役割の変数（`--bina-ui-accent`・`--bina-ui-accent-soft`・`--bina-ui-line`・`--bina-ui-surface`・`--bina-ui-subtle`・`--bina-ui-muted` など）で描き、ライト・ダーク・`surface("dark")` の中で同じ規則になる。`surface` は column・row・grid の面の修飾なので、新しい部品は自分の CSS で面を描く。checkbox・radio・slider はネイティブの要素の見た目を消して OS の色で描く。progress の不定の動きと spinner の回転は、`prefers-reduced-motion` で遅くする
- column の中の chip・badge・segmented・image は左に寄せ、横に伸ばさない（`grow()` を付けたものを除く）。row の中の progress は残りの幅に伸びる
- `chip` と `badge` の `tone`: chip は `"accent"`・`"success"`・`"danger"` で淡い面と色付きの文字、`"muted"` で薄い面。badge は既定がアクセントの塗り、`"danger"`・`"success"` はその色の塗り、`"muted"` は薄い面
- segmented と tabs の中のボタンはクラス `bina-ui-option` を持つ。OS の index.html の document 方式のボタンの規則はこのボタンに効かない
- Régie には `__bina_ui_value_handle`・`__bina_ui_value_ack`、アプリには `__bina_ui_value(build, handler, value: f64)` を足した。DomOp の `ui-update` には、その部品のときだけ `checked`・`value`・`min`・`max`・`step`・`options`・`index` を、指定したときだけ `align` を載せる

## 未決

- ダイアログ・ボトムシート・スナックバー（トースト）は今回は足さない。アプリの領域の外に重ねて出す表示と、フォーカスの閉じ込め・戻し、背景の操作の止め方、OS の通知や別のアプリの重ね表示との順番を、OS（Scene）の側で決める必要があるため
- メニュー（ポップアップ）・日付と時刻の選択・アイコンの部品も同じ理由と、アイコンの持ち方が決まっていないため見送る
- radio の矢印キーでの移動。今はネイティブの name の組を使わず、Tab で 1 つずつ移って Space で選ぶ。組を表す修飾（例 `radioGroup()`）を足すかは未決
- 部品の名前（`picker` か `select` か、`listTile` か `listItem` か）。`select` はアプリのハンドラーの名前によく使われ（例 `button("row", select)`）、import とぶつかるので `picker` にした。`listItem` は `list()` の子に付くクラス `bina-ui-listitem` と大文字小文字だけ違うので `listTile` にした
