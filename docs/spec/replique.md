# @binette/replique

[仕様の目次](README.md)

Réplique（レプリク、セリフ）は、アプリが Régie を呼ぶための AssemblyScript のライブラリです。中身は WASM の import の宣言だけで、実装は Régie が持ちます。

## 使い方（実装済み）

```ts
import { ui } from "jsr:@binette/replique";

let count = 0;

export function start(): void {
  ui.text("count", "0");
}

export function increment(): void {
  count++;
  ui.text("count", count.toString());
}
```

- import の指定子は `jsr:@binette/replique` です（案。npm の `@binette/replique` では書かない）
- アプリは Réplique を自分では持ち込みません。ビルドする Scene が差し込みます（[scene.md](scene.md#ファイルの解決)）
- アプリの関数は、`export function 名前(): void` で書きます。HTML の `data-on-click="名前"` から呼ばれます
- `start()` は、Scene が HTML を描いて起動したあとに 1 回呼びます。無くてもかまいません
- トップレベルの文やグローバル変数の初期値は、`start()` より前に走ります。そこで `ui.text` を呼んでもかまいません
- `_start` という名前は、ビルドがトップレベルの初期化に使うので、アプリの関数には使えません

## 呼び出しの一覧

### 実装済み

| AS の API | WASM の import（モジュール.名前） | 権限 | 内容 |
| --- | --- | --- | --- |
| `ui.text(name: string, value: string): void` | `binette`.`ui.text` | なし | `data-text="name"` の要素の文字を `value` にする |

ソース（`packages/replique/src/index.ts`）:

```ts
export namespace ui {
  // @ts-ignore: decorator
  @external("binette", "ui.text")
  export declare function text(name: string, value: string): void;
}
```

- 呼び出しを足すときは、`@external("binette", "<名前空間>.<関数>")` の形で宣言し、Régie の import（[regie.md](regie.md#import)）に同じ名前で足します。Réplique と Régie が共有するのは、この表だけです
- `// @ts-ignore: decorator` は、AS の標準ライブラリと同じ書き方です。TypeScript として読む道具（エディタ、JSR の検査）がデコレーターの位置で誤りを出さないようにします
- 型検査は `npm run typecheck -w @binette/replique`（`asc src/index.ts --noEmit`）で AS として行います。`export namespace` が WASM の export にならないという警告（AS235）が出ますが、害はありません

### 案

| 名前空間 | 権限 | 内容 |
| --- | --- | --- |
| `ui` | なし | 画面の書き換え。`show`・`enabled`・`value`・`listClear`・`listAdd`・`itemText`（[scene.md](scene.md#html-とアプリのつなぎ方)） |
| `storage` | `storage` | アプリごとのキーと値の保存 |
| `server` | `server` | 自分のサーバーサイド（Coulisses）への要求。`available()` でつながっているかを見る |

## 結果を受け取る呼び出し（案）

AS には async が無いので、結果は「終わったら呼ぶ関数」を渡して受け取ります。渡せるのはトップレベルの関数だけです。

```ts
import { ui, storage, server } from "jsr:@binette/replique";
export * from "jsr:@binette/replique/glue";

export function start(): void {
  storage.get("memos", onLoaded);
}

function onLoaded(value: string | null): void {
  ui.text("status", value === null ? "まだありません" : value);
}
```

- Régie は結果を返すとき、`glue` の export を要求番号付きで呼ぶ。そのためアプリの入口で `glue` を export する
- `jsr:` の import は、Scene のビルダーが JSR から取って解決する。npm や Node は使わない
- この形でよいかは未決

## AS で書くときの制約

- async / await、Promise は無い
- クロージャ（外の変数を使う無名関数）は使えない。コールバックにはトップレベルの関数を渡す
- アプリから DOM、ネットワーク、`console` などには直接触れない。使えるのは Réplique の呼び出しだけ（Régie がほかの import を渡さないので、使うと起動できない）
- 例外（`throw`）は、その呼び出しを止める。Régie はそれを呼び出しの失敗として Scene に知らせる（[regie.md](regie.md#メッセージ実装済み)）

## 配布（実装済み）

- `dist` は持たず、AS のソース `src/index.ts` をそのまま配る
- npm（`@binette/replique`）と JSR（`jsr:@binette/replique`）の両方に出す設定です。JSR だけにするかは未決
- エディタで `jsr:@binette/replique` の補完が効くかは未確認
