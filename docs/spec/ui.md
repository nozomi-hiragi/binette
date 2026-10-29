# 宣言的 UI（案）

[仕様の目次](README.md)

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

`App.build(): View | null` の既定値は `null` で、HTML 方式は従来どおりです。OS がライフサイクルのメソッドやイベントを呼んだ後に `build()` を呼びます。`View` は共通の型で、`column(children)`、`row(children)`、`text(s)`、`button(label, f)`、子を含むボタンを返す `buttonOf(children, f)` を使えます。ハンドラーはトップレベルの引数なし関数か、`arg(i)` を組み合わせた `i32` 引数を一つ持つ関数です。

修飾は `padding(n)`、`gap(n)`、`grow()`、`key(s)`、読み上げ用の `label(s)`、`enabled(b)`、`arg(i)` です。key を付けた兄弟は、順序を変えても同じ DOM 要素を使い続けます。

Réplique は build ごとにハンドラー番号を振り直し、画面の木を一つの文字列として Worker に渡します。Worker が前の木との差分を作り、Scene が DOM を作って差分を反映します。Scene はクリックした要素のハンドルを渡します。Worker は現在の木からその要素とハンドラーを探し、現在の build 番号で呼びます。要素が消えたか、ハンドラーが無いか、今の木で `enabled(false)` なら、クリックを捨てます（待っているクリックも同じです）。同じ要素への続けたクリックは、描き直しを挟んでもそれぞれ届けます。クリックを届ける条件は [プロセス](regie/process.md) の既存の条件と同じです。

宣言的 UI では `document` API の DOM 操作は何もしません。HTML 方式では従来どおり使えます。

見た目は `:where(.bina-ui-…)` と `--bina-ui-…` の OS テーマ変数で決めます。入力、grid、appIcon、show はこの案の範囲に含みません。
