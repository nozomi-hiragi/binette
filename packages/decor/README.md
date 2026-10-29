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

`mount(element)` が返す root の `render(view)` を呼ぶと描画します。次の呼び出しでは前の木との差分を反映し、`unmount()` で描画を解除します。状態を変えたあとの描画は明示的に呼びます。

AS の View と部品は `jsr:@binette/decor/as` にあります。従来の `jsr:@binette/replique/ui` も互換の入口として使えます。関数の部品、useState、JSX は含みません。

API と分担の細部は案です。[仕様](https://github.com/nozomi-hiragi/binette/blob/main/docs/spec/decor.md) を参照してください。
