# @binette/scene

ブラウザ上の Scene、アセット解決、Shadow DOM での HTML / JavaScript 再生、設定画面を提供します。依存は `@binette/core` だけです。Scene が URL と戻る・進むを管理し、通信は必要に応じて差し替えられます。

```ts
import { Scene } from "@binette/scene";
const scene = new Scene({
  serverURL: "https://example.com/", // ビネットや asset の取得元
  base: "/", // 省略時も /
});
document.querySelector("#app")!.append(scene.element); // Scene が作った要素を好きな場所に置く
await scene.start();
// 使い終わったら scene.dispose() を呼ぶ。
```

動き方の決まりは [仕様](https://github.com/nozomi-hiragi/binette/blob/main/docs/spec.md) にあります。要点は次のとおりです。

- 起動時に入口 `/index.bina` を取り、Scene が動いているあいだ覚えておきます。`/` では入口を表示し、入口が `redirect` ならその転送先へ移ります。入口が無い（404）ときは `/settings` へ移ります。
- ほかの画面パスは `.bina` を付けて取得し、404 なら「見つかりません」を表示します。
- 入口の `css` の asset は全体の CSS として、どの画面と設定画面にも入れます。
- `/settings` は Scene の固定画面です。General と、これまでに読んだビネットの `settings` を `order` 順に並べます。テーマやログアウトなどクライアントの操作は、`components` で登録した部品を element セクションから指定して出します。
- `serverURL` は必須の取得元 URL です。ビネット・asset の `src`・`sh.fetch` の URL は `new URL(url, serverURL)` で解決してから `fetch` に渡します。`fetch` を省略するとブラウザ標準の `fetch` を使います。`base` は画面の URL にだけ適用します。

ルートで `npm install` 後、別々の端末で次を起動します。

```sh
npm run demo -w @binette/coulisses
npm run demo -w @binette/scene
```

http://localhost:5175/ を開くと、ホーム、`/hello` の JavaScript、`/redirect` からの転送、無いページ、設定画面を試せます。上部の「標準 fetch」「カスタム fetch」で通信を切り替えられます。切替時は現在の画面を再読み込みし、選択は同じタブの画面遷移・再読み込み後も保持します。初回は標準 fetch です。

- `http://localhost:5175/?fetch=default`: `Scene` の `fetch` オプションを省略し、ブラウザ標準の fetch で指定した `serverURL` の Coulisses から直接取得します。
- `http://localhost:5175/?fetch=custom`: カスタム fetch が解決済みの URL を開発者コンソールへ「カスタム fetch:」として記録し、同じ Coulisses から直接取得します。

どちらのモードでも Coulisses が必要で、配信側は `http://localhost:5175` からの CORS を許可する必要があります。配信先は既定で `http://localhost:8790`。変更する場合は `VITE_COULISSES=http://localhost:8791 npm run demo -w @binette/scene` のように起動するか、`packages/scene/demo/.env.local` に `VITE_COULISSES=http://localhost:8791` を設定して Vite を再起動します。両モードの `serverURL` に反映します。別ポートのデモ配信は `PORT=8791 npm run demo -w @binette/coulisses` で起動できます。

`npm run typecheck -w @binette/scene` でデモを含めて型検査します。
