# @binette/scene

Binette のアプリを読み、AssemblyScript をブラウザの中で WASM にビルドし、HTML を描いてアプリとつなぎます。依存は `@binette/core`、`@binette/regie`、`assemblyscript` です。

```ts
import { buildApp, mountApp } from "@binette/scene";

// app.json からの相対パスを受けて、ファイルの中身を返す関数
const read = async (path: string) => (await fetch(new URL(path, "https://example.com/settings/"))).text();
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

`<template bina="tiles">` は `list("tiles")` に対応します。`add()` で行を足し、行の `elem("name").text` と `icon(i)` を書けます。行の中のクリックには行番号（i32）を渡します。行の名前は `Bindings.lists` に集め、外側の要素と分けます。

ホームはシステムアプリ `apps/home` が持ちます。`mountShell(element, options)` は `binette:system` かつ `role: "home"` の最初のアプリを開き、ホームだけに `apps` の一覧を渡します。ホームが別のアプリを開くとホームを止め、OS の「戻る」の帯を出します。戻るとホームを起動し直します。`ShellOptions` は `apps`・`store` とビルド・起動の設定、戻り値 `MountedShell` は `stop()` を持ちます。タイルの見た目はホームの HTML にあります。

動き方の決まりは [仕様](https://github.com/nozomi-hiragi/binette/blob/main/docs/spec/scene/README.md) にあります。

## 公開するもの

| 名前 | 用途 |
| --- | --- |
| `buildApp` / `loadCompiler` | 開発用のブラウザ内ビルド |
| `mountApp` / `mountShell` | アプリの描画と起動の枠 |
| `PrebuiltApp` | manifest・HTML・任意の SVG・WASM |
| `stringifyPrebuiltApp` / `parsePrebuiltApp` | `.binapp` の書き出しと読み込み |
| `parseBindings` / `generateBindingsSource` | HTML の名前の収集と AS の生成 |

`ShellApp` は `{ source, prebuilt }` か開発用の `{ source, read }` です。prebuilt は毎回その内容で保存し直し（入れた日時は保つ）、コンパイラは呼びません。read は同じ入手元・ID・版の保存結果があれば使い回します。`source` は配信の URL ではなく、変わらない入手元の名前にします（システムアプリは `binette:system` など）。

## 単独フロント

ルートで次を起動して http://localhost:5175/ を開きます。先にホームと設定アプリをビルドし、ホームから開きます。ブラウザは `.binapp` を読み、初回も asc を読みません。

```sh
deno task start
```

`deno task build:system` は `apps/` の直下で `app.json` を持つフォルダを見つけ、`.binapp/<フォルダ名>.binapp` を生成します。フォルダを足すだけでシステムアプリが増えます。生成物はコミットしません。任意のアプリは次で書き出せます。

```sh
deno run -A packages/scene/src/cli.ts build <アプリのフォルダ> --out <ファイル> --replique <Réplique の AS のパス>
```

Binette の入口はリポジトリ直下の `index.html` と `src/main.ts` です。`deno task build` は `dist/` に、サブパスでも動く静的ファイルを書き出します。保存は IndexedDB を使います。

テストと型検査は、ルートの `deno task test` と `deno task check` で行います。

HTML の `bina="count"` から `count` を export する `bina.ts` を生成できます。AS の入口と同じフォルダに置き、`import { count } from "./bina";` と `count.text` で操作します。同じ名前の要素はまとめて変わります。

```sh
deno run -A jsr:@binette/scene/cli <アプリのフォルダ>
```

HTML を変えたら再実行すると、エディタの名前補完も更新されます。ビルド時は Scene が最新の HTML から生成するので、存在しない名前の import はビルドエラーになります。

`parseBindings(html, parser)` は要素の数・種類とクリック関数を集め、`generateBindingsSource(bindings)` は AS のソースを返します。`buildApp` は HTML の名前を検査し、`bina-on-click` の関数が export に無ければビルドの誤りにします。結果にも `bindings` が含まれます。ブラウザ以外では、deno-dom（`jsr:@b-fuze/deno-dom`）の DOMParser を `buildApp` の `parser` に渡してください。AS の相対 import もアプリのフォルダ内で解決します。
