# @binette/replique

Binette のアプリ（AssemblyScript）が Régie を呼ぶためのライブラリです。中身は WASM の import（`binette` モジュール）で、実行は `@binette/regie` が受け持ちます。

```ts
import { ui } from "jsr:@binette/replique";

export function start(): void {
  ui.text("count", "0");
}
```

今ある呼び出しは `ui.text(name, value)` だけです。HTML の `data-text="name"` の要素の文字を書き換えます。

アプリはこのパッケージを自分では持ち込みません。ビルドする Scene が `jsr:@binette/replique` として差し込みます。

`npm run typecheck -w @binette/replique` で AssemblyScript として型検査します。

仕様は [docs/spec/replique.md](https://github.com/nozomi-hiragi/binette/blob/main/docs/spec/replique.md) にあります。
