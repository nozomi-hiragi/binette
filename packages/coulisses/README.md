# @binette/coulisses

Node と標準 Fetch API を使う、フレームワークに依存しないファイル配信ハンドラーです。依存は `@binette/core` だけです。

```ts
import { createCoulisses, defineBinette } from "@binette/coulisses";
const binette = defineBinette({ binette: "0.1", redirect: "/home" });
const handler = createCoulisses({ root: "/absolute/path/to/site" });
const response = await handler(new Request("http://localhost/index.bina"));
```

GET / HEAD でファイルを配信し、`.bina` は形式を検証します（`settings` は `/index.bina` にだけ書けます）。公開ディレクトリ外（シンボリックリンクを含む）は配信しません。`cors` に許可する origin を渡すと CORS ヘッダーと OPTIONS 応答が有効になります。

ルートで `npm install` 後、`npm run demo -w @binette/coulisses` で http://localhost:8790 に起動します（`PORT` で変更可能）。別の端末で `npm run demo -w @binette/scene` を起動すると再生を試せます。デモは http://localhost:5175 からのアクセスを許可します。

`npm run typecheck -w @binette/coulisses` でデモを含めて型検査します。Node.js 22.18 以上が必要です。
