# @binette/core

Binette の型、スキーマ、形式検証を提供します。アプリの説明ファイル `app.json` は `parseAppManifest`、v0.1 の `.bina` は `parseBinette` で読みます（どちらも失敗すると `BinetteError`）。依存は valibot だけです。

```ts
import { parseBinette, type Binette } from "@binette/core";
const binette: Binette = parseBinette('{"binette": "0.1", "redirect": "/home"}');
```

```ts
import { parseAppManifest } from "@binette/core";
const app = parseAppManifest(await readFile("app.json", "utf8")); // id・name・entry だけを検査する
```

テストと型検査は、ルートの `deno task test` と `deno task check` で行います。
アプリのビルドと再生のデモは `deno task demo:scene`、v0.1 の配信のデモは `deno task demo:coulisses` で起動します。

仕様は [docs/spec/core.md](https://github.com/nozomi-hiragi/binette/blob/main/docs/spec/core.md) にあります。
