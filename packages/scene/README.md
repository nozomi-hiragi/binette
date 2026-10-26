# @binette/scene

Binette のアプリを読み、AssemblyScript をブラウザの中で WASM にビルドし、HTML を描いてアプリとつなぎます。依存は `@binette/core`、`@binette/regie`、`assemblyscript` です。

```ts
import { buildApp, mountApp } from "@binette/scene";

// app.json からの相対パスを受けて、ファイルの中身を返す関数
const read = async (path: string) => (await fetch(new URL(path, "https://example.com/counter/"))).text();
const built = await buildApp(read, {
  // Réplique は未公開なので、今は呼ぶ側がソースを渡す
  libraries: { "jsr:@binette/replique": repliqueSource },
});
const mounted = await mountApp(document.querySelector("#app")!, built, { onError: console.error });
// 使い終わったら mounted.stop() を呼ぶ。
```

- `loadCompiler()` は asc を読み込みます。初回だけ dynamic import し、結果を使い回します。`buildApp` が必要なときに呼ぶので、先に呼んで読み込み時間を測ることもできます
- `buildApp(read, options)` は `app.json`・HTML・AS を読み、AS を WASM にビルドします。ビルドに失敗すると、asc の出力を含む `Error` になります
- `mountApp(element, built, options)` は `element` に HTML を描き、Régie でアプリを起動します。`bina="name"` の要素はアプリの `elem("name")` で、`bina-on-click="fn"` はクリックでアプリの `fn()` につながります。export に `start` があれば呼びます。HTML の安全性の検証、CSS、保存、権限はまだありません

動き方の決まりは [仕様](https://github.com/nozomi-hiragi/binette/blob/main/docs/spec/scene/README.md) にあります。

## デモ

ルートで次を起動して http://localhost:5175/ を開きます。`examples/counter` を取ってきて、ビルドして動かします。asc の読み込みとビルドにかかった時間も出ます。

```sh
deno task demo:scene
```

テストと型検査は、ルートの `deno task test` と `deno task check` で行います。

HTML の `bina="count"` から `count` を export する `bina.ts` を生成できます。AS の入口と同じフォルダに置き、`import { count } from "./bina";` と `count.text` で操作します。同じ名前の要素はまとめて変わります。

```sh
deno run -A jsr:@binette/scene/cli <アプリのフォルダ>
```

HTML を変えたら再実行すると、エディタの名前補完も更新されます。ビルド時は Scene が最新の HTML から生成するので、存在しない名前の import はビルドエラーになります。

`parseBindings(html, parser)` は要素の数・種類とクリック関数を集め、`generateBindingsSource(bindings)` は AS のソースを返します。`buildApp` は HTML の名前を検査し、`bina-on-click` の関数が export に無ければビルドの誤りにします。結果にも `bindings` が含まれます。ブラウザ以外では、happy-dom の DOMParser を `buildApp` の `parser` に渡してください。AS の相対 import もアプリのフォルダ内で解決します。
