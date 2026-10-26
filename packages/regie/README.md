# @binette/regie

Binette のアプリの WASM を Worker で動かす Régie（カーネル）です。アプリが要素の文字を書き換えたこと（`elem(name).text = value`）を受けて外に知らせ、export された関数を呼びます。画面は持ちません。

```ts
import { launchApp } from "@binette/regie";

const app = await launchApp(wasm, { onText: (name, value) => console.log(name, value) });
await app.call("start");
app.stop();
```

- `launchApp(wasm, options)` は WASM を Worker に送り、export された関数名の一覧を受け取ったら解決します。`start()` は呼びません
- `app.call(name)` は関数を呼び、終わったら解決します。呼び出し中の文字の書き換えは、解決より先に `onText` に届きます。無い関数やアプリの中の例外は reject し、`onError` にも渡します
- Worker は、`serveApp` の `toString()` から作る Blob URL の Worker です。テストでは `createWorker` に同じスレッドの `MessageChannel` と `serveApp` をつないだものを渡せます

テストは、ルートの `deno task test` で行います。

仕様は [docs/spec/regie.md](https://github.com/nozomi-hiragi/binette/blob/main/docs/spec/regie.md) にあります。
