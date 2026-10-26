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

ルートで `npm install` 後、`npm run typecheck -w @binette/core` で型検査します。
アプリのビルドと再生のデモは `npm run demo -w @binette/scene`、v0.1 の配信のデモは `npm run demo -w @binette/coulisses` で起動します。
