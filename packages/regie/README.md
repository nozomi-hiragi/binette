# @binette/regie

Binette のアプリの WASM を Worker で動かす Régie（カーネル）です。アプリの DOM 操作をまとめて外に知らせ、export された関数を呼びます。画面は持ちません。

```ts
import { launchApp } from "@binette/regie";

const app = await launchApp(wasm, { onDom: (ops) => console.log(ops) });
await app.call("start");
app.stop();
```

- `launchApp(wasm, options)` は WASM を Worker に送り、export された関数名の一覧を受け取ったら解決します。`start()` は呼びません
- `app.call(name)` は関数を呼び、終わったら解決します。呼び出し中の DOM 操作は、解決より先に `onDom` に届きます。無い関数は reject と onError、アプリの例外は終了して reject と onExit で知らせます
- Worker は、`serveApp` の `toString()` から作る Blob URL の Worker です。テストでは `createWorker` に同じスレッドの `MessageChannel` と `serveApp` をつないだものを渡せます

テストは、ルートの `deno task test` で行います。

仕様は [docs/spec/regie.md](https://github.com/nozomi-hiragi/binette/blob/main/docs/spec/regie.md) にあります。

`DomOp` は byId・create・text・class・append・remove・listen・icon の判別共用体です。_start と call の操作は完了通知前に一回届きます。空の操作は送らず、call の例外までの操作も送ります。apps.open は即時配送です。
