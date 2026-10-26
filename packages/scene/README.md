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
- `mountApp(element, built, options)` は `element` に HTML を描き、Régie でアプリを起動します。`bina-text="name"` は `ui.text` で、`bina-on-click="fn"` はクリックでアプリの `fn()` につながります。export に `start` があれば呼びます。HTML の検証、CSS、保存、権限はまだありません

動き方の決まりは [仕様](https://github.com/nozomi-hiragi/binette/blob/main/docs/spec/scene.md) にあります。

## デモ

ルートで `npm install` 後、次を起動して http://localhost:5175/ を開きます。`examples/counter` を取ってきて、ビルドして動かします。asc の読み込みとビルドにかかった時間も出ます。

```sh
npm run demo:scene
```

`npm test -w @binette/scene` でテストし、`npm run typecheck -w @binette/scene` でデモを含めて型検査します。
