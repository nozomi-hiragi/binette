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

## テーマ（案）

`.gap(8)` / `.padding(8)` の数は px のままです。`space.xs`〜`space.xl` は既定 4 / 8 / 12 / 16 / 24px の名前付きの段で、引数なしなら md を使います。

```ts
import { button, column, radius, space, theme } from "@binette/decor";
const view = theme({
  space: { md: 16 },
  button: { padding: space.md, radius: radius.sm },
}, column([button("保存", () => {})]).gap().padding());
```

`theme(設定, view)` は要素を増やさず、その部分木の段と button / input の padding・radius・fontSize の既定を変えます。入れ子の theme は指定した項目だけを上書きし、明示した `.padding(...)` を優先します。色の名前は扱いません。`radius` の段は 2 / 4 / 8 / 12 / 16px、`fontSize` は 12 / 14 / 16 / 20 / 24px です。AS 版は `jsr:@binette/decor/as` の `Theme` / `Scale` / `ComponentTheme` で設定します。詳しくは [仕様](../../docs/spec/decor.md) を参照してください。
