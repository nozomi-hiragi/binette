# @binette/regie

Binette のアプリの WASM を Worker で動かす Régie（カーネル）です。アプリの DOM 操作をまとめて外に知らせ、export された関数を呼びます。画面は持ちません。

```ts
import { launchApp } from "@binette/regie";

const app = await launchApp(wasm, { onDom: (ops) => console.log(ops) });
await app.call("__bina_lifecycle", 1, 0, 1); // Create、前の記録なし
app.stop();
```

- `launchApp(wasm, options)` は WASM を Worker に送り、export された関数名の一覧を受け取ったら解決します。状態の通知は Scene が行います
- `app.call(name, ...args)` は関数を呼び、終わったら解決します。呼び出し中の DOM 操作は、解決より先に `onDom` に届きます。無い関数は reject と onError、アプリの例外は終了して reject と onExit で知らせます
- Worker は、`serveApp` の `toString()` から作る Blob URL の Worker です。テストでは `createWorker` に同じスレッドの `MessageChannel` と `serveApp` をつないだものを渡せます

テストは、ルートの `deno task test` で行います。

仕様は [docs/spec/regie.md](https://github.com/nozomi-hiragi/binette/blob/main/docs/spec/regie.md) にあります。

`DomOp` は byId・create・text・class・append・remove・listen・icon の判別共用体です。_start と call の操作は完了通知前に一回届きます。空の操作は送らず、call の例外までの操作も送ります。apps.open と finish の要求は、現在の呼び出しの完了後に onOpen / onFinish へ届けます。

LaunchOptions は callTimeout（ミリ秒、既定 5000）、page（省略時は空文字列）、onFinish を持ちます。起動と呼び出しの時間切れは、Worker を終了して reject し、起動後なら onExit で知らせます。

LaunchOptions.last で前回の page と Destroy の理由を Worker に渡せます。state・done は Scene が Create の引数で渡します。createMemoryAppStore()・createIndexedDbAppStore() の戻り値の system は SystemStore です。getLast / putLast、listLaunches / recordLaunch、getSettings / putSettings で最後の状態・起動の履歴・OS の設定を読み書きできます。IndexedDB は同じ DB の v2 に system 表を追加し、既存の apps 表を残します。設定の既定値は DEFAULT_SYSTEM_SETTINGS です。
