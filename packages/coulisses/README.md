# @binette/coulisses

ビネットとファイルの一式（パノプリ）を配る、標準の Fetch API の形のハンドラーです。依存は `@binette/core` だけです。決まりは [仕様のパノプリの節](../../docs/spec.md#パノプリ) にあります。

```ts
import { createCoulisses, createPanoplie } from "@binette/coulisses";

const panoplie = createPanoplie({
  index: { binette: "0.1", redirect: "/home" },
  home: { binette: "0.1", entry: "main", assets: { main: { type: "html", content: "<p>こんにちは</p>" } } },
});
const handler = createCoulisses({ panoplie });
const response = await handler(new Request("http://localhost/index.bina"));
```

パノプリの作り方は 3 つあります。

- `createPanoplie(binettes, files?)`: ビネットの辞書（とファイル）のオブジェクトから
- `parsePanoplie(text)`: ビネットの辞書を書いた JSON 文字列から
- `importPanoplie(root)`: フォルダから。`@binette/coulisses/node` から取り込みます（Node 専用）

```ts
import { importPanoplie } from "@binette/coulisses/node";
const panoplie = await importPanoplie("/srv/site");
```

パノプリを作るときにビネットを全部検査します。`createCoulisses` 自体はファイルシステムを使わないので、Node 以外（Cloudflare Workers など）でも動きます。`cors` に許可する origin を渡すと、CORS ヘッダーと OPTIONS の応答が有効になります。

ルートで `npm install` 後、`npm run demo -w @binette/coulisses` で http://localhost:8790 に起動します（`PORT` で変更可能）。デモは起動時に `demo/site/` を読むので、中身を変えたら再起動してください。別の端末で `npm run demo -w @binette/scene` を起動すると再生を試せます。デモは http://localhost:5175 からのアクセスを許可します。

`npm run typecheck -w @binette/coulisses` でデモを含めて型検査します。Node.js 22.18 以上が必要です。
