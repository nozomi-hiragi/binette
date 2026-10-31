# Décor — 宣言 UI（案）

[仕様の目次](README.md) · [宣言的 UI の動作](ui.md)

Décor（デコール、舞台装置）は、宣言 UI を扱う `@binette/decor` です。既存の UI をパッケージに分け、ホームと設定の見た目、イベントの順序、入力中の値の扱いを保ちます。以下の API 名と分担の細部は案です。

## 担当と依存（案）

Décor は UI の木、前の木との差分を作る純粋な関数、差分を DOM に当てる関数、部品の CSS、TS と AS の View を持ちます。依存する Binette のパッケージは core だけで、Régie と Scene は使いません。DOM 操作の通信形式は core の `DomOp` と共有し、同じ形式を二重に定義しません。

Régie は Décor で差分を計算し、Scene は Décor で DOM に反映します。Worker では通常の import を参照できないため、差分を作る関数を Worker のソースにも含めます。Worker のメッセージとライフサイクルは Régie が引き続き扱います。

key を持つ兄弟の並べ替えでは同じ DOM を使います。入力欄は値が同じなら書き直さず、古い入力の版の描画で新しい文字を上書きしません。非表示の木は残し、クリックと入力を届けません。詳しい部品とイベントの条件は [ui.md](ui.md) を参照してください。

## 普通の TS ページで使う（案）

```ts
import { button, column, mount, text } from "@binette/decor";

const element = document.getElementById("app")!;
const root = mount(element);
let count = 0;
function draw(): void {
  root.render(column([
    text("押した回数: " + count),
    button("+1", () => { count++; draw(); }),
  ]).gap(8).padding(16));
}
draw();
// 使い終わったら root.unmount();
```

`mount(element)` は描画先に結び付いた root を返します。`root.render(view)` は木を描き、次の描画では前の木との差分を当てます。`root.unmount()` は描画と状態を解除します。普通の変数を変えた場合は明示的な `render` が必要です。

View は `column(children)`、`row(children)`、`text(value)`、`button(label, handler)`、`buttonOf(children, handler)`、`input(value, handler)`、`grid(children)`、`appIcon(index)`、`show(condition, view)` で作ります。よくある部品の `spacer()`、`separator()`、`stack(children)`、`checkbox(checked, onChange)`、`radio(selected, onSelect)`、`slider(value, min, max, onChange)`、`picker(options, index, onChange)`、`segmented(options, index, onChange)`、`tabs(options, index, onChange)`、`progress(value)`、`spinner()`、`image(src)`、`listTile(title, subtitle, leading, trailing)`、`chip(label)`、`badge(value)` と、修飾の `step(n)`・`align(name)` もあります（下の「よくある部品」）。AS と同じ修飾を連ねて、余白、key、読み上げ用のラベルなどを設定します。`input(value, handler).multiline()` は改行を含む値を扱う textarea を描画します。TS のイベントには普通の関数を渡します。`appIcon` はアプリ情報を渡す描画で使います。TS の `mount(element, { apps })` の `apps[i].icon`（SVG の文字列）を `appIcon(i)` が描きます（Scene のホームバーが使う）。`apps` を渡さない `mount(element)` で作る `appIcon` は画像の `src` を持ちません。

### 関数の部品とフック（案）

```ts
import { button, component, mount, useState, type View } from "@binette/decor";

function Counter({ label }: { label: string }): View {
  const [count, setCount] = useState(0);
  return button(`${label}: ${count}`, () => setCount(n => n + 1));
}
const root = mount(document.getElementById("app")!);
root.render(component(Counter, { label: "回数" }));
```

`component(fn, props)` は props を受け取り View を返す関数を木に入れます。部品は親の中の位置、関数の種類、指定した key で識別します。一覧の並べ替えで状態を保つには `component(...).key(id)` を使います。key は同じ親の子の間で一意にします。

`useState(initial)` は状態と setter を返します。初期値には初期化関数も渡せます。setter は値または前の値から次の値を作る関数を受け取り、値が `Object.is` で異なるとき、その root の再描画を次のマイクロタスクに予約します。同じタイミングの更新はまとめます。

`useEffect(effect, deps?)` は描画後に処理を実行します。依存値を省くと毎回、配列を渡すと各値が `Object.is` で変わったときに実行し、空配列では最初だけ実行します。処理が返した片付け関数は、次の実行前、部品が消えたとき、または unmount 時に呼びます。消えた部品の片付けは、新しい木を画面に反映したあと、その描画のエフェクトより前に一度だけ呼びます。部品が消えると状態も捨てます。消えた部品の setter は何もしません。

フックは部品の描画中に毎回同じ順序と数で呼びます。部品の外で呼ぶとエラーになります。関数の部品とフックは TS の `mount` 用で、AS には追加しません。JSX は含みません。

### 見た目の修飾（案）

```ts
column([
  row([text("デザイナー").bold(), text("保存しません").small().tone("muted").truncate()]).surface("surface").divider("bottom"),
  row([
    column([button("row", select).variant("ghost").selected(true).grow()]).width(240).scroll().fill().divider("right"),
    column([column([text("こんにちは")]).surface("card").width(360).minHeight(420)]).surface("sunken").center().grow().fill(),
  ]).fill().collapse(),
  column([input(code, edit).multiline().mono().height(120)]).surface("dark"),
]).fill();
```

色はアプリが値を書かず、OS の役割を選びます。役割は効く部品ごとに、ボタンの種類の `variant(name)`、文字の色の `tone(name)`、面の `surface(name)` に分けます。ほかに `divider(side)`、`mono()`、`small()`、`bold()`、`truncate()`、`width(px)`、`height(px)`、`minHeight(px)`、`center()`、`wrap()`、`selected(b)`、印の `highlight(b)`、`toggle(on)`、`scroll()`、`fill()`、`collapse()`、入力の `placeholder(s)` があります。TS と AS で共通の `parts.ts` にあり、View から UiNode、`ui-update` の操作を経て DOM のクラスと属性になります。古いアプリは送らないので、操作では既定でない値だけを載せます。名前と効果の一覧と役割の色の変数は [宣言的 UI](ui.md#見た目の修飾案) を参照してください。

### よくある部品（案）

```ts
column([
  tabs(["一般", "通知"], tab, i => { tab = i; draw(); }),
  listTile("通知", "音とバナーで知らせる", null, checkbox(notify, on => { notify = on; draw(); }).label("通知")),
  separator(),
  row([text("音量"), slider(volume, 0, 1, v => { volume = v; draw(); }).step(0.05).grow().label("音量")]).gap(12),
  row([segmented(["日", "週", "月"], period, i => { period = i; draw(); }), spacer(), spinner().label("読み込み中")]),
  progress(volume),
]).gap(16).padding(16);
```

値を返す部品（checkbox・radio・slider・picker・segmented・tabs）は、入力欄と同じく値をアプリが持ちます。DOM は操作のあとすぐ見た目を変え、アプリの描き直しで値と入力の版を受け取ってそろえます。差分エンジンは入力欄と同じく、これらの部品を描き直しのたびに更新に載せ、アプリが値を変えなかったときに DOM を戻せるようにします。Scene から Worker へは `dispatchUiValue(handle, value, version)` で数を一つ送り、Worker が部品の種類で確かめて（番号は範囲内の整数、slider は範囲に丸める）アプリの `__bina_ui_value(build, handler, value)` を呼びます。AS では checkbox・slider のハンドラーを `parts.ts` の関数の型で受け、radio・picker・segmented・tabs は button と同じ包み方（`as.ts` と `view.ts`）で番号を渡します。部品ごとの引数・role・キー操作・効く修飾は [宣言的 UI](ui.md#よくある部品案) を参照してください。

## AS の入口（案）

AS の View と部品は `jsr:@binette/decor/as` に置きます。既存の `jsr:@binette/replique/ui` はそれを再エクスポートする互換の入口で、アプリの import は変えずに使えます。`App.build()` を呼ぶタイミング、イベントのハンドラー番号、入力の版、HTML 方式との切り替えは変えません。Régie のビルドで両方の入口を解決します。

## 公開（案）

ほかの Binette パッケージと同じ版で JSR に公開し、Apache-2.0 の LICENSE とソースを含めます。バージョン検査、公開物だけで動かす検査、公開の dry-run、API ドキュメントの対象に含めます。仕様のナビゲーションはこのページも自動で一覧に含めます。

## テーマと段（案）

数は引き続き px です。`.gap(8)` と `.padding(8)` は 8px、引数なしの `.gap()` と `.padding()` は `space.md` です。`space.xs/sm/md/lg/xl` は数の番兵値 -1〜-5 で、CSS の `--bina-ui-space-*` への参照になります。既定は順に 4 / 8 / 12 / 16 / 24px です。既存の引数付き宣言の意味は変わりません。

```ts
import { button, column, fontSize, input, radius, space, theme } from "@binette/decor";

const view = theme({
  space: { md: 16 },
  button: { padding: space.md, radius: radius.sm, fontSize: fontSize.md },
  input: { padding: space.sm, radius: radius.sm },
}, column([
  button("保存", () => {}),
  input("", value => console.log(value)),
]).gap().padding());
```

`theme(設定, view)` は View を修飾して返します。ラッパー要素を増やさず、その View の根に CSS 変数を置き、子孫だけに継承します。設定は呼び出し時に取り込むため、後から設定オブジェクトだけを変更しても描き直しません。次の render で新しい theme を渡すと既存要素の変数を更新し、theme を外すと古い変数を削除します。同じ View に重ねる場合は入れ子の内側を優先して合成します。関数部品では返された根に適用し、その根自身の指定を優先します。

設定には `space`、`radius`、`fontSize` の各段と、`button`、`input` の部品既定があります。段の設定値は px（負数は 0）で、未指定の段は親から受け継ぎます。`radius` の既定は 2 / 4 / 8 / 12 / 16px、`fontSize` の既定は 12 / 14 / 16 / 20 / 24px です。部品既定の `padding` は `space`、`radius` は `radius`、`fontSize` は `fontSize` の段を参照でき、数なら px です。色名やアプリ独自の色は扱いません。

部品の段参照は使用する要素で解決します。親が `button.padding = space.md` を指定し、内側の theme が `space.md` だけを変更した場合も、内側のボタンには内側の段が効きます。このため内部では段の選択係数と px の変数を継承し、部品の CSS が `calc()` で長さを組み立てます。CSS 変数の内部名は案です。アプリに CSS の記述は不要です。

明示した `.padding(...)` は部品の既定より優先します。未指定の padding は親のレイアウトの padding を受け継ぎません。既定テーマでは padding は 0px、文字の大きさは親と同じ、button の角丸は従来どおり 8px です。input は既定の入力欄の見た目として上下 6px・左右 8px の余白と角丸 6px（`--bina-ui-control-radius`）を持ち、`surface("dark")` と `surface("field")` の中では余白と角丸が 0px です。Scene・home・settings の数値指定と既存の button の CSS 変数は保ちます。既存の `--bina-ui-button-radius` / `--bina-ui-input-radius` は部品テーマの radius が未指定の場合の既定値です（ホームの既存 12px を維持）。部品テーマを指定すれば、その値を優先します。

### AssemblyScript（案）

AS でも同じ `theme` と段を `jsr:@binette/decor/as` から使います。設定には `Theme`、`Scale`、`ComponentTheme` を使い、-100 は未指定を表す内部の予約値です。色や Binette のアプリ状態に依存しません。Décor の実行時コードに Régie・Scene・Réplique への依存はありません。

```ts
const config = new Theme();
const sizes = new Scale();
sizes.md = 16;
config.space = sizes;
const defaults = new ComponentTheme();
defaults.padding = space.md;
defaults.radius = radius.sm;
config.button = defaults;
return theme(config, column([button("保存", save)]).gap().padding());
```
