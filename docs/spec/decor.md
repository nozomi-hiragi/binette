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

`mount(element)` は描画先に結び付いた root を返します。`root.render(view)` を明示的に呼んだときだけ描画し、次の呼び出しでは前の木との差分を当てます。`root.unmount()` は描画を解除します。イベントで値を変えただけでは自動で描き直しません。

View は `column(children)`、`row(children)`、`text(value)`、`button(label, handler)`、`buttonOf(children, handler)`、`input(value, handler)`、`grid(children)`、`appIcon(index)`、`show(condition, view)` で作ります。AS と同じ修飾を連ねて、余白、key、読み上げ用のラベルなどを設定します。TS のイベントには普通の関数を渡します。`appIcon` はアプリ情報を渡す Scene の描画で使います。TS の `mount(element)` にはアプリ情報を渡す入口がないため、そこで作る `appIcon` は画像の `src` を持ちません。

関数の部品、useState、JSX、自動の再描画は今回の対象に含めず、後で考えます。

## AS の入口（案）

AS の View と部品は `jsr:@binette/decor/as` に置きます。既存の `jsr:@binette/replique/ui` はそれを再エクスポートする互換の入口で、アプリの import は変えずに使えます。`App.build()` を呼ぶタイミング、イベントのハンドラー番号、入力の版、HTML 方式との切り替えは変えません。Régie のビルドで両方の入口を解決します。

## 公開（案）

ほかの Binette パッケージと同じ版で JSR に公開し、Apache-2.0 の LICENSE とソースを含めます。バージョン検査、公開物だけで動かす検査、公開の dry-run、API ドキュメントの対象に含めます。仕様のナビゲーションはこのページも自動で一覧に含めます。
