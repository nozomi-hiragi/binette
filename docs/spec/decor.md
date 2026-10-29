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

View は `column(children)`、`row(children)`、`text(value)`、`button(label, handler)`、`buttonOf(children, handler)`、`input(value, handler)`、`grid(children)`、`appIcon(index)`、`show(condition, view)` で作ります。AS と同じ修飾を連ねて、余白、key、読み上げ用のラベルなどを設定します。TS のイベントには普通の関数を渡します。`appIcon` はアプリ情報を渡す Scene の描画で使います。TS の `mount(element)` にはアプリ情報を渡す入口がないため、そこで作る `appIcon` は画像の `src` を持ちません。

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

## AS の入口（案）

AS の View と部品は `jsr:@binette/decor/as` に置きます。既存の `jsr:@binette/replique/ui` はそれを再エクスポートする互換の入口で、アプリの import は変えずに使えます。`App.build()` を呼ぶタイミング、イベントのハンドラー番号、入力の版、HTML 方式との切り替えは変えません。Régie のビルドで両方の入口を解決します。

## 公開（案）

ほかの Binette パッケージと同じ版で JSR に公開し、Apache-2.0 の LICENSE とソースを含めます。バージョン検査、公開物だけで動かす検査、公開の dry-run、API ドキュメントの対象に含めます。仕様のナビゲーションはこのページも自動で一覧に含めます。
