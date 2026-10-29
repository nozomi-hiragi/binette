# @binette/decor

Décor（デコール）は宣言 UI の木、差分の計算、DOM への反映を扱います。依存は `@binette/core` だけです。

```ts
import { button, column, mount, text } from "@binette/decor";

const root = mount(document.getElementById("app")!);
let count = 0;
function draw(): void {
  root.render(column([
    text("押した回数: " + count),
    button("+1", () => { count++; draw(); }),
  ]).gap(8));
}
draw();
// 使い終わったら root.unmount();
```

`mount(element)` が返す root の `render(view)` を呼ぶと描画します。次の呼び出しでは前の木との差分を反映し、`unmount()` で描画を解除します。普通の変数を変えたあとの描画は明示的に呼びます。`component` と `useState` を使うと、状態の更新後に自動で描き直せます。`useEffect` では描画後の処理と片付けを登録できます。

AS の View と部品は `jsr:@binette/decor/as` にあります。従来の `jsr:@binette/replique/ui` も互換の入口として使えます。関数の部品とフックは TS の `mount` 向けです。JSX は含みません。

API と分担の細部は案です。[仕様](https://github.com/nozomi-hiragi/binette/blob/main/docs/spec/decor.md) を参照してください。
