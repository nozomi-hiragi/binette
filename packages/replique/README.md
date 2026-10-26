# @binette/replique

Binette のアプリ（AssemblyScript）が Régie を呼ぶためのライブラリです。中身は WASM の import（`binette` モジュール）で、実行は `@binette/regie` が受け持ちます。

```ts
import { elem } from "jsr:@binette/replique";

export function start(): void {
  elem("count").text = "0";
}
```

今あるのは `elem(name).text` だけです。書くと、HTML で `bina="name"` を付けた要素の文字をまとめて書き換えます。読むと、そのアプリが最後に書いた文字を返します（まだ書いていなければ空文字列）。

アプリはこのパッケージを自分では持ち込みません。ビルドする Scene が `jsr:@binette/replique` として差し込みます。

ルートの `deno task check` で、AssemblyScript としても型検査します（asc の `--noEmit`）。

仕様は [docs/spec/replique.md](https://github.com/nozomi-hiragi/binette/blob/main/docs/spec/replique.md) にあります。
