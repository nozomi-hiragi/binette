# Scene: HTML の名前の木

[Scene の目次](README.md)

アプリの HTML を、ビルドの前に解析して「名前の木」（`Bindings`）にします。木から AS のソース `bina.ts` を作り、エディタの補完とビルドでの検査に使います。

コードは `packages/scene/src/bindings.ts`（木と生成）、`paths.ts`（パスの整え方）、`build.ts`（ビルドでの使い方）、`cli.ts`（書き出しコマンド）です。

## なぜ木にするのか（決定 2026-10-26、のぞみ）

HTML は、ビルドの前に解析して名前の木にします。名前と要素の種類から AS の型を作り、補完を効かせます。木は次の 4 つに使います。

| 使い道 | 内容 | 状態 |
| --- | --- | --- |
| 補完 | `bina.ts` をアプリのフォルダに書き出し、エディタで名前を候補に出す | 実装済み |
| ビルドでの検査 | HTML に無い名前の import、export に無いクリックの関数をビルドの誤りにする | 実装済み |
| インストール時の検査 | 危ない属性が無いか、使っている操作が要素の種類に合うかを確かめる | 案 |
| 描画で引く | 書くたびに DOM を探し直さず、木から要素を引く | 案 |

木が無かったころ（PR #3 の時点）は、HTML を文字列のまま描き、アプリが書くたびに `[bina]` を探していました。名前の打ち間違いは、何も起きずに無視されていました。

## 流れ（実装済み）

```
index.html ──parseBindings──▶ Bindings ──generateBindingsSource──▶ bina.ts のソース
                                 │                                      │
                                 │                                      ├─ buildApp: asc の readFile で
                                 │                                      │  「entry.as の隣の bina.ts」として渡す
                                 │                                      └─ 書き出しコマンド: entry.as の隣に書く
                                 └─ buildApp: ビルドのあと、clicks が WASM の export にあるか確かめる
```

- `buildApp`（ブラウザの中のビルド）は、毎回 HTML から木を作り直します。アプリのフォルダにある `bina.ts` は読みません
- 書き出しコマンド（手元のエディタ用）は、同じ木から同じソースを作ってファイルに書きます
- どちらも `parseBindings` と `generateBindingsSource` を使うので、ビルドに使うソースと、書き出したファイルの中身は、同じ HTML なら必ず同じになります

## HtmlParser（実装済み）

```ts
/** DOMParser の形。本番はブラウザ、テストと CLI は deno-dom を使う */
interface HtmlParser {
  parseFromString(html: string, type: "text/html"): Document;
}
```

HTML の解析は、自前では書かず DOMParser に任せます。DOMParser はブラウザにしか無い（Deno には無い）ので、外から渡せる形にしています。

| 動く場所 | 渡すもの |
| --- | --- |
| 本番（ブラウザの中の `buildApp`） | 何も渡さない。`buildApp` が `new globalThis.DOMParser()` を作る |
| テスト | deno-dom の `new DOMParser()` を `buildApp` の `parser` や `parseBindings` に渡す |
| 書き出しコマンド | deno-dom の `new DOMParser()` を使う |

- `buildApp` で `parser` を省略し、`globalThis.DOMParser` も無いときは `HTML を読む DOMParser がありません。parser を指定してください。` の `Error` です
- deno-dom（`jsr:@b-fuze/deno-dom@0.1.56`、MIT）は scene の依存ですが、読み込むのは書き出しコマンド（`./cli`）だけです。ブラウザで使う Scene 本体には入りません
- deno-dom の解析器は、ブラウザと同じ HTML の解析の決まりで作られた html5ever（Rust）です。ブラウザの中のビルドと、書き出しコマンドとで、同じ HTML が同じ木になるようにするためです
- deno-dom には WASM 版（`jsr:@b-fuze/deno-dom`）とネイティブ版（`/native`）があります。WASM 版を使います。ネイティブ版は FFI の権限（`--allow-ffi`）と、OS ごとのライブラリの取得が要るためです

## Bindings（実装済み）

```ts
/** bina の要素の種類 */
interface BindingKind {
  /** 小文字のタグ名（"p"、"span"、"input" など） */
  tag: string;
  /** input のときだけ。小文字の type 属性。無ければ "text" */
  type?: string;
}

/** HTML とアプリをつなぐ名前 */
interface Bindings {
  /** 名前ごとの要素数と、出てきた順の種類（重複なし） */
  elements: Record<string, { count: number; kinds: BindingKind[] }>;
  /** クリックで呼ぶ関数名（重複なし、出てきた順） */
  clicks: string[];
}

function parseBindings(html: string, parser: HtmlParser): Bindings
```

集め方:

1. `parser.parseFromString(html, "text/html")` で文書にする
2. `document.querySelectorAll("[bina], [bina-on-click]")` の要素を、文書の順に 1 つずつ見る
3. 要素が `bina` 属性を持てば（値が空でも「持つ」とみなす）:
   1. 名前を検査する（下の「名前の規則」。`bina` の名前として）
   2. 種類を作る。`tag` は `tagName` を小文字にしたもの。`tag` が `input` なら、`type` を `type` 属性の値を小文字にしたもの（属性が無ければ `"text"`）にする。`input` 以外は `type` を持たない
   3. `elements[名前]` が無ければ `{ count: 0, kinds: [] }` を作る。`count` を 1 増やす
   4. 同じ `tag` と `type` の種類がまだ `kinds` に無ければ、末尾に足す
4. 要素が `bina-on-click` 属性を持てば:
   1. 名前を検査する（`bina-on-click` の名前として）
   2. まだ `clicks` に無ければ、末尾に足す
5. 1 つの要素が `bina` と `bina-on-click` の両方を持ってもよい。3 と 4 の両方を行う

決まりの細かいところ:

- `elements` はプロトタイプの無いオブジェクト（`Object.create(null)`）です。`toString` や `constructor` のような名前を、ふつうのオブジェクトの持ち物と取り違えないためです（ただし `constructor` は予約語として名前の検査で弾かれます）
- 同じ名前に種類の違う要素（`<p bina="x">` と `<input bina="x">` など）があっても誤りにしません。`kinds` に両方並べるだけです。今の操作は `text` だけで、どの要素にも使えるためです（扱いは未決。下の「これから」）
- 最初に見つかった誤りで止まり、`Error` を投げます。それまでに集めたものは返しません

例:

```html
<h1 bina="count">0</h1>
<p>いま <span bina="count">0</span> 件</p>
<input bina="name">
<input bina="agree" type="CheckBox">
<button bina-on-click="increment">+1</button>
<button bina-on-click="increment" bina="plus">+1</button>
```

```ts
{
  elements: {
    count: { count: 2, kinds: [{ tag: "h1" }, { tag: "span" }] },
    name:  { count: 1, kinds: [{ tag: "input", type: "text" }] },
    agree: { count: 1, kinds: [{ tag: "input", type: "checkbox" }] },
    plus:  { count: 1, kinds: [{ tag: "button" }] },
  },
  clicks: ["increment"],
}
```

## 名前の規則（実装済み）

`bina` の名前は `bina.ts` の `export const 名前` になり、`bina-on-click` の名前はアプリの `export function 名前` を指します。どちらも AS の識別子として使える名前でなければなりません。

上から順に確かめ、最初に当たったもので誤りにします。

| 順 | 条件 | 対象 | 理由の文言 |
| --- | --- | --- | --- |
| 1 | `/^[A-Za-z_$][A-Za-z0-9_$]*$/` に合わない（空、数字始まり、`-` や日本語を含む など） | 両方 | `AS の識別子の形ではありません` |
| 2 | 予約語・文脈キーワード・型名（下） | 両方 | `予約語または型名です` |
| 3 | `__` で始まる | 両方 | `__ で始まる名前は自動生成用です` |
| 4 | `elem` | `bina` だけ | `elem は自動生成ファイルの import に使います` |
| 5 | `_start` | `bina-on-click` だけ | `_start はビルドの初期化に使います` |

誤りの文言は `<対象> の名前「<名前>」は使えません。<理由の文言>。` です。`<対象>` は `bina` か `bina-on-click` です。

例: `bina の名前「1st」は使えません。AS の識別子の形ではありません。`

予約語・型名の一覧（`packages/scene/src/bindings.ts` の `reserved`）:

- JS・TS の予約語と文脈キーワード: `break` `case` `catch` `class` `const` `continue` `debugger` `default` `delete` `do` `else` `enum` `export` `extends` `false` `finally` `for` `function` `if` `import` `in` `instanceof` `new` `null` `return` `super` `switch` `this` `throw` `true` `try` `typeof` `var` `void` `while` `with` `yield` `let` `static` `implements` `interface` `package` `private` `protected` `public` `as` `async` `await` `of` `type` `namespace` `declare` `abstract` `readonly` `get` `set` `constructor` `from` `module` `assert` `asserts` `infer` `is` `keyof` `require` `global` `unique` `override` `out` `accessor` `using` `satisfies` `intrinsic` `unknown`
- AS と TS の型名: `i8` `i16` `i32` `i64` `isize` `u8` `u16` `u32` `u64` `usize` `bool` `f32` `f64` `v128` `string` `number` `boolean` `any` `never` `object` `symbol` `bigint`

## bina.ts の生成（実装済み）

```ts
function generateBindingsSource(bindings: Bindings): string
```

1. 1 行目: `// bina.ts（HTML から自動生成。手で書き換えない）`
2. 2 行目: `import { elem } from "jsr:@binette/replique";`
3. `elements` に名前があれば、空行を 1 つ置き、名前を `Array.prototype.sort()` の順（文字コード順。大文字が小文字より先）に並べて、1 つにつき `export const <名前> = elem("<名前>");` の 1 行
4. 行を `\n` でつなぎ、最後に `\n` を 1 つ足す

- 名前が 0 個なら、1 と 2 の 2 行だけです（import は残します。AS は使っていない import を誤りにしません）
- `bina-on-click` の名前は出ません
- `count` や `kinds` は、今はソースに出ません（種類ごとの型を入れるときに使います）

例（名前 `z` と `a`）:

```ts
// bina.ts（HTML から自動生成。手で書き換えない）
import { elem } from "jsr:@binette/replique";

export const a = elem("a");
export const z = elem("z");
```

アプリからの使い方:

```ts
import { count } from "./bina";

export function start(): void {
  count.text = "0";
}
```

`elem("count")` を直接使う書き方も、今までどおり使えます。

## ビルドでの使い方（実装済み）

`buildApp` の中の流れのうち、木にかかわるところです（全体は [build.md](build.md#buildapp)）。

1. `entry.html` と `entry.as` のパスを整える（`entryPaths`）
   - `./` と途中の `../` を畳む
   - `/` で始まる、`\` を含む、`%` を含む、`https:` のようなスキームで始まる、`app.json` のフォルダの外に出る、のどれかなら `アプリの入口は app.json のフォルダ内の相対パスにしてください。`
   - `%` を拒むのは、`%2e%2e` が URL で読むと `..` になり、フォルダの外を読めてしまうためです
   - 生成する `bina.ts` のパスは「`entry.as` と同じフォルダの `bina.ts`」（`src/main.ts` なら `src/bina.ts`、`main.ts` なら `bina.ts`）
   - `entry.as` 自体がそのパスなら `entry.as に bina.ts という名前は使えません。bina.ts は HTML から自動生成するファイルです。`（生成物で入口を上書きしてしまうため）
2. HTML を `parseBindings` で木にし、`generateBindingsSource` でソースを作る
3. asc が生成した `bina.ts` のパスを読みに来たら、生成したソースを返す。アプリのフォルダに `bina.ts` があっても、`read` では読まない
4. ビルドのあと、WASM を `WebAssembly.compile` し、`WebAssembly.Module.exports` のうち関数の名前を集める。`clicks` のうち、そこに無い名前があれば `アプリをビルドできません。クリックで呼ぶ関数が export にありません: <名前>、<名前>`（`、` 区切り）
5. 結果の `BuiltApp` に `bindings` を入れて返す

ビルドの誤りになる例:

| アプリが書いたもの | 結果 |
| --- | --- |
| HTML に無い名前を `import { cuont } from "./bina"` | asc の誤り（`アプリをビルドできません。` のあとに asc の出力） |
| `<button bina-on-click="missing">` で、`missing` を export していない | `…クリックで呼ぶ関数が export にありません: missing` |
| `<p bina="1st">` | `bina の名前「1st」は使えません。AS の識別子の形ではありません。` |
| `"entry": { "as": "src/bina.ts" }` | `entry.as に bina.ts という名前は使えません。…` |

## 書き出しコマンド（実装済み）

エディタで補完を効かせるには、`bina.ts` がアプリのフォルダに実際にある必要があります。そのためのコマンドです。

```sh
deno run -A jsr:@binette/scene/cli <アプリのフォルダ>
```

1. `<アプリのフォルダ>/app.json` を読む（`parseAppManifest`）
2. 入口のパスを整える（上の 1 と同じ。`entry.as` が `bina.ts` なら誤り）
3. HTML を読み、deno-dom の DOMParser で `parseBindings` する
4. `generateBindingsSource` のソースを、`entry.as` と同じフォルダの `bina.ts` に書く（あれば上書き）
5. 書いたファイルの絶対パスを標準出力に出す

- 誤りは標準エラーに `bina.ts を書き出せません。<理由>` と出し、終了コード 1 で終わります。何も書きません
- 引数が 1 つでなければ `bina.ts を書き出せません。アプリのフォルダを 1 つ指定してください。`
- 関数としても使えます: `writeBindings(dir: string): Promise<string>`（書いたパスを返す。誤りは `Error`）。`import { writeBindings } from "jsr:@binette/scene/cli"`
- scene の `deno.json` の `exports` に `"./cli": "./src/cli.ts"` があります
- このリポジトリでは `deno task gen:bindings` で全システムアプリの `bina.ts` を書き出します

### 運用（案）

- ファイル名は `bina.ts`。`entry.as` の隣に置く
- 書き出した `bina.ts` は、アプリのリポジトリにコミットする。エディタで補完が効くように
- HTML を変えたら、書き出しコマンドを実行し直す
- ビルドはいつも HTML から作り直すので、コミットした `bina.ts` が古くても、ビルドの結果は変わらない。古いと補完がずれるだけ
- このリポジトリでは、`apps/settings/src/bina.ts` が HTML から作ったものと一致するかを、テストで確かめている

## これから（案）

### 種類ごとの型

`text` 以外の操作を足すときに、`kinds` を使って要素の種類ごとの型を作ります。

| 種類 | 生成する型（例） | 使える操作（例） |
| --- | --- | --- |
| `input`（type が `text` など） | `InputElem` | `text`、`value` |
| `input`（type が `checkbox`） | `CheckElem` | `checked` |
| そのほか | `TextElem` | `text`、`show` |

```ts
export const name = new InputElem("name");   // input[type=text]
export const agree = new CheckElem("agree"); // input[type=checkbox]
export const count = new TextElem("count");  // p、span など
```

- 合わない操作（`count.value` など）は、型が無いのでビルドの誤りになります
- 読める値（`value`、`checked`）は、Scene が入力のたびに Régie へ送り、Réplique が手元に覚えます（[mount.md](mount.md#読める値案)）

### 同じ名前に違う種類があるとき（未決）

`<p bina="x">` と `<input bina="x">` のような場合の扱いは、まだ決めていません。候補:

- 両方に使える操作だけを持つ型にする（上の例なら `text` だけ）
- ビルドの誤りにする

### 一覧の入れ子

一覧（`bina-each` にあたるもの）を入れるときに、木に入れ子を持たせます。

```html
<ul bina="memos">
  <template>
    <li><span bina="title"></span><button bina-on-click="remove">消す</button></li>
  </template>
</ul>
```

- 行の中の名前（`title`）は、一覧（`memos`）の下の木にする。行の外の名前とは別の名前空間にする
- 行の中のクリックは、その行のキーを引数で渡す
- `bina.ts` には、一覧の型と、行の型を出す

### 描画で木から引く

今の `mountApp` は、アプリが書くたびに `[bina]` を探し直しています。木を使えば、描いたときに名前 → 要素の一覧を作っておき、書くときはそこから引けます。

### インストール時の検査

[app.md のインストール](../app.md#インストール案)の 3（検証）に、同じ木を使います。

- `bina-on-*` の名前が export にあること（クリックは実装済み）
- HTML に `<script>`・`on*` 属性・外部 URL が無いこと
- 使っている操作が、要素の種類に合うこと
