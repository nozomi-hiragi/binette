# @binette/core

Binette の型、スキーマ、形式検証（`parseBinette` / `BinetteError`）を提供します。依存は valibot だけです。

```ts
import { parseBinette, type Binette } from "@binette/core";
const binette: Binette = parseBinette({ binette: "0.1", redirect: "/home" });
```

ルートで `npm install` 後、`npm run typecheck -w @binette/core` で型検査します。
単独のデモはありません。配信と再生のデモは、それぞれ `npm run demo -w @binette/coulisses` と `npm run demo -w @binette/scene` で起動します。
