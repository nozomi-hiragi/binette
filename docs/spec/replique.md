# @binette/replique

[仕様の目次](README.md)

Réplique（レプリク、セリフ）は、アプリが Régie を呼ぶための AssemblyScript のライブラリです。中身は WASM の import の宣言だけで、実装は Régie が持ちます。

## 使い方（実装済み）

```ts
import { count } from "./bina";

let value = 0;

export function start(): void {
  count.text = "0";
}

export function increment(): void {
  value++;
  count.text = value.toString();
}
```

`./bina` は、Scene が HTML の名前から作る `bina.ts` です（[scene.md](scene.md#binats実装済み)）。中身は `export const count = elem("count");` のような行で、`elem` を直接使って `import { elem } from "jsr:@binette/replique";`・`elem("count").text = "0";` と書いても同じです。

- HTML の `bina="count"` の要素を `elem("count")` で操作します。同じ名前の要素はまとめて変わります（決定 2026-10-26。[scene.md](scene.md#html-とアプリのつなぎ方)）
- import の指定子は `jsr:@binette/replique` です（配布は JSR だけ。決定 2026-10-26）
- アプリは Réplique を自分では持ち込みません。ビルドする Scene が差し込みます（[scene.md](scene.md#ファイルの解決)）
- アプリの関数は、`export function 名前(): void` で書きます。HTML の `bina-on-click="名前"` から呼ばれます
- `start()` は、Scene が HTML を描いて起動したあとに 1 回呼びます。無くてもかまいません
- トップレベルの文やグローバル変数の初期値は、`start()` より前に走ります。そこで `elem(…).text` に書いてもかまいません
- `_start` という名前は、ビルドがトップレベルの初期化に使うので、アプリの関数には使えません

## 呼び出しの一覧

### 実装済み

| AS の API | WASM の import（モジュール.名前） | 権限 | 内容 |
| --- | --- | --- | --- |
| `elem(name: string): Elem` | なし | なし | `bina="name"` の要素のまとまりを返す。呼ぶたびに新しい `Elem` を作る |
| `Elem.name: string`（読むだけ） | なし | なし | 名前 |
| `Elem.text = value`（`set text(value: string)`） | `binette`.`elem.text`（`name`, `value`） | なし | 要素の文字を `value` にする。値を Réplique の手元にも覚える |
| `Elem.text`（`get text(): string`） | なし | なし | このアプリがその名前に最後に書いた文字。まだ書いていなければ `""`。画面には聞かない |

ソース（`packages/replique/src/index.ts`）:

```ts
// @ts-ignore: decorator
@external("binette", "elem.text")
declare function setText(name: string, value: string): void;

/** アプリが最後に書いた文字。画面は Worker の外にあって読めないので、写しを手元に持つ */
const texts = new Map<string, string>();

export class Elem {
  constructor(readonly name: string) {}
  get text(): string { return texts.has(this.name) ? texts.get(this.name) : ""; }
  set text(value: string) { texts.set(this.name, value); setText(this.name, value); }
}

export function elem(name: string): Elem { return new Elem(name); }
```

- 覚えた値は、同じ名前ならどの `Elem` からでも読めます（`elem("a").text = "x"` のあと、別に作った `elem("a").text` も `"x"`）
- 覚えた値は、Worker が動いているあいだだけです

- 呼び出しを足すときは、`@external("binette", "<対象>.<操作>")`（例: `elem.text`）の形で宣言し、Régie の import（[regie.md](regie.md#import)）に同じ名前で足します。Réplique と Régie が共有するのは、この表だけです
- `// @ts-ignore: decorator` は、AS の標準ライブラリと同じ書き方です。TypeScript として読む道具（エディタ、JSR の検査）がデコレーターの位置で誤りを出さないようにします
- 型検査は、ルートの `deno task check` で `deno check`（TypeScript として）と `asc src/index.ts --noEmit`（AS として）の両方を行います。TypeScript としても通すため、`Map.get` の結果には `!` を付けています。`export class` が WASM の export にならないという警告（AS235）が出ますが、害はありません

### 案

| 対象 | 権限 | 内容 |
| --- | --- | --- |
| `elem` | なし | `show`・`enabled`・`value` のプロパティ。`value` は入力のたびに Scene が送る値を覚えて返す（[scene.md](scene.md#読める値案)） |
| `list` | なし | 一覧（`bina="list"` ＋ `<template>`）の行を足す・消す。行の中は `item.elem("…")` で触る |
| `storage` | `storage` | アプリごとのキーと値の保存 |
| `server` | `server` | 自分のサーバーサイド（Coulisses）への要求。`available()` でつながっているかを見る |

## 結果を受け取る呼び出し（案）

AS には async が無いので、結果は「終わったら呼ぶ関数」を渡して受け取ります。渡せるのはトップレベルの関数だけです。

```ts
import { elem, storage } from "jsr:@binette/replique";
export * from "jsr:@binette/replique/glue";

export function start(): void {
  storage.get("memos", onLoaded);
}

function onLoaded(value: string | null): void {
  elem("status").text = value === null ? "まだありません" : value;
}
```

- Régie は結果を返すとき、`glue` の export を要求番号付きで呼ぶ。そのためアプリの入口で `glue` を export する
- `jsr:` の import は、Scene のビルダーが JSR から取って解決する
- この形でよいかは未決

## AS で書くときの制約

- async / await、Promise は無い
- クロージャ（外の変数を使う無名関数）は使えない。コールバックにはトップレベルの関数を渡す
- アプリから DOM、ネットワーク、`console` などには直接触れない。使えるのは Réplique の呼び出しだけ（Régie がほかの import を渡さないので、使うと起動できない）
- 例外（`throw`）は、その呼び出しを止める。Régie はそれを呼び出しの失敗として Scene に知らせる（[regie.md](regie.md#メッセージ実装済み)）

## 配布（実装済み）

- `dist` は持たず、AS のソース `src/index.ts` をそのまま配る
- JSR（`jsr:@binette/replique`）だけに出します（決定 2026-10-26）
- エディタで `jsr:@binette/replique` の補完が効くかは未確認
