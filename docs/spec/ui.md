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

`App.build(): View | null` の既定値は `null` で、HTML 方式は従来どおりです。OS がライフサイクルのメソッドやイベントを呼んだ後に `build()` を呼びます。`View` は共通の型で、`column(children)`、`row(children)`、`text(s)`、`button(label, f)`、子を含むボタンを返す `buttonOf(children, f)`、入力欄 `input(value, onText)`、グリッド `grid(children)`、アイコン `appIcon(i)` を使えます。ボタンのハンドラーはトップレベルの引数なし関数か、`arg(i)` を組み合わせた `i32` 引数を一つ持つ関数です。入力の `onText` は `(s: string) => void` で、入力のたびに現在の文字列を受け取ります。

修飾は `padding(n)`、`gap(n)`、`grow()`、`key(s)`、読み上げ用の `label(s)`、`enabled(b)`、`arg(i)`、グリッドの列の最小幅をピクセルで指定する `minWidth(px)` です。key を付けた兄弟は、順序を変えても同じ DOM 要素を使い続けます。

Réplique は build ごとにハンドラー番号を振り直し、画面の木を一つの文字列として Worker に渡します。Worker が Décor で前の木との差分を作り、Scene が Décor で DOM を作って差分を反映します（分担は案）。Scene はクリックした要素のハンドルを渡します。Worker は現在の木からその要素とハンドラーを探し、現在の build 番号で呼びます。要素が消えたか、ハンドラーが無いか、今の木で `enabled(false)` なら、クリックを捨てます（待っているクリックも同じです）。同じ要素への続けたクリックは、描き直しを挟んでもそれぞれ届けます。クリックを届ける条件は [プロセス](regie/process.md) の既存の条件と同じです。

宣言的 UI では `document` API の DOM 操作は何もしません。HTML 方式では従来どおり使えます。

`input` の `label` は読み上げ用の名前、`enabled(false)` は入力の無効化に使います。描き直しの値が DOM の値と同じなら value を書き直さず、入力中のカーソルと IME の変換を保ちます。`grid` は CSS grid の auto-fill と minmax で子を並べます。`appIcon(i)` は OS が持つアプリのアイコンを表示し、ホーム以外が使うとアプリを終了します。`show(cond, view)` は条件が false のとき非表示にし、DOM は保持します。入力中の古い描画結果は、後から打った文字を上書きしません。

見た目は `:where(.bina-ui-…)` と `--bina-ui-…` の OS テーマ変数で決めます。

## 見出し・一覧と OS の CSS（案）

- `.heading(level)` は見出しにする（level は 1〜3）。DOM には `role="heading"` と `aria-level` を付け、読み上げでも見出しになる
- `.list()` を付けた column は `role="list"`、その子は `role="listitem"` になる
- `.minWidth(px)` は、grid では列の最小幅、text・button・input では自分の最小幅
- OS の部品の CSS は、どのアプリにも同じに効く汎用のものだけにする。アプリの key（`data-bina-key`）を CSS の手がかりにしない。ボタンは最小 44px 角。row は縦の中央にそろえる
- テーマの変数は `--bina-ui-*`（例 `--bina-ui-grid-background`、`--bina-ui-button-background`、`--bina-ui-button-border`、`--bina-ui-button-radius`、`--bina-ui-focus`、`--bina-ui-icon-size`）
- `show(false, view)` は DOM を残して隠す。隠れている間は押せない・打てない（入力の中身などを保つため）
