# @binette/coulisses

ビネットとファイルの一式（パノプリ）を、標準の Fetch API の形で配ります。依存は `@binette/core` だけです。決まりは [仕様のパノプリの節](https://github.com/nozomi-hiragi/binette/blob/main/docs/spec/coulisses.md#パノプリv01) にあります。

```ts
import { createCoulisses, createPanoplie } from "@binette/coulisses";

const panoplie = createPanoplie({
  index: { binette: "0.1", redirect: "/home" },
  home: { binette: "0.1", entry: "main", assets: { main: { type: "html", content: "<p>こんにちは</p>" } } },
});
const coulisses = createCoulisses({ panoplie });
const response = await coulisses.fetch(new Request("http://localhost/index.bina"));
```

パノプリの作り方は 3 つあります。

- `createPanoplie(binettes, files?)`: ビネットの辞書（とファイル）のオブジェクトから
- `parsePanoplie(text)`: ビネットの辞書を書いた JSON 文字列から
- `importPanoplie(root)`: フォルダから。`node:fs` を使うので、使えない環境（Cloudflare Workers など）ではエラーになります

```ts
import { importPanoplie } from "@binette/coulisses";
const panoplie = await importPanoplie("/srv/site");
```

作ったあとでも、ビネットとファイルを足せます。同じ名前やパスがあれば置き換えます。

```ts
coulisses.addBinette("notes/1", { binette: "0.1", entry: "main", assets: { main: { type: "html", content: "<p>メモ</p>" } } });
coulisses.addFile("files/logo.svg", { body: svgText });
```

ビネットは足すたびに検査します。`createCoulisses` と `fetch` 自体はファイルシステムを使わないので、Node 以外でも動きます。`cors` に許可する origin を渡すと、CORS ヘッダーと OPTIONS の応答が有効になります。

ルートで `deno task demo:coulisses` を実行すると http://localhost:8790 に起動します（`PORT` で変更可能）。デモは起動時に `demo/site/` を読むので、中身を変えたら再起動してください。別の端末で `npm run demo -w @binette/scene` を起動すると再生を試せます。デモは http://localhost:5175 からのアクセスを許可します。

型検査とテストは、ルートの `deno task check` と `deno task test` で行います。Deno 2.9 以上が必要です。
