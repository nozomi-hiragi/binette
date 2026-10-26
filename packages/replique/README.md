# @binette/replique

Binette のアプリ（AssemblyScript）が Régie を呼ぶためのライブラリです。中身は WASM の import（`binette` モジュール）で、実行は `@binette/regie` が受け持ちます。

```ts
import { count } from "./bina";

export function start(): void {
  count.text = "0";
}
```

今あるのは `elem(name).text` だけです。書くと、HTML で `bina="name"` を付けた要素の文字をまとめて書き換えます。読むと、そのアプリが最後に書いた文字を返します（まだ書いていなければ空文字列）。

アプリはこのパッケージを自分では持ち込みません。ビルドする Scene が `jsr:@binette/replique` として差し込みます。

ルートの `deno task check` で、AssemblyScript としても型検査します（asc の `--noEmit`）。

仕様は [docs/spec/replique.md](https://github.com/nozomi-hiragi/binette/blob/main/docs/spec/replique.md) にあります。

HTML の `bina="count"` から `count` を export する `bina.ts` を生成できます。AS の入口と同じフォルダに置き、`import { count } from "./bina";` と `count.text` で操作します。同じ名前の要素はまとめて変わります。

```sh
deno run -A jsr:@binette/scene/cli <アプリのフォルダ>
```

HTML を変えたら再実行すると、エディタの名前補完も更新されます。ビルド時は Scene が最新の HTML から生成するので、存在しない名前の import はビルドエラーになります。
