# @binette/regie

Binette のアプリの WASM を Worker で動かす Régie（カーネル）です。アプリの DOM 操作をまとめて外に知らせ、export された関数を呼びます。画面は持ちません。

```ts
import { startProcess } from "@binette/regie";

const process = await startProcess(wasm);
process.attach((ops) => console.log(ops));
await process.begin(); // Create → Start(Create) → Resume
process.stop();
```

- `startProcess(wasm, options)` は WASM を Worker に送り、最後の状態を読み、`_start` を実行してから解決します。状態の通知は `begin()` まで行いません
- `attach(sink)` は DOM 操作の受け先をつなぎ、接続前に溜まった操作を先に渡します。`begin()` は Create → Start(Create) → Resume を知らせます
- `dispatch(listener)` はイベントを届けるか判断してアプリに渡します
- `process.app.call(name, ...args)` は関数を呼び、終わったら解決します。呼び出し中の DOM 操作は、解決より先に `attach` でつないだ受け先に届きます。無い関数は reject と onError、アプリの例外は終了して reject と onExit で知らせます
- Worker は、`serveApp` の `toString()` から作る Blob URL の Worker です。テストでは `createWorker` に同じスレッドの `MessageChannel` と `serveApp` をつないだものを渡せます

テストは、ルートの `deno task test` で行います。

仕様は [docs/spec/regie/](https://github.com/nozomi-hiragi/binette/blob/main/docs/spec/regie/README.md) にあります。

`@binette/core` の `DomOp` は byId・create・text・class・append・remove・listen・icon の判別共用体です。_start と call の操作は完了通知前に一回届きます。空の操作は送らず、call の例外までの操作も送ります。apps.open と finish の要求は、現在の呼び出しの完了後に onOpen / onFinish へ届けます。

LaunchOptions は callTimeout（ミリ秒、既定 5000）、page（省略時は空文字列）、onFinish を持ちます。起動と呼び出しの時間切れは、Worker を終了して reject し、起動後なら onExit で知らせます。

LaunchOptions.last で前回の page と Destroy の理由を Worker に渡せます。state・done は Process が Create の引数で渡します。createMemoryAppStore()・createIndexedDbAppStore() の戻り値の system は SystemStore です。getLast / putLast、listLaunches / recordLaunch、getSettings / putSettings で最後の状態・起動の履歴・OS の設定を読み書きできます。IndexedDB は同じ DB の v2 に system 表を追加し、既存の apps 表を残します。設定の既定値は DEFAULT_SYSTEM_SETTINGS です。

`startSystem(options)` はアプリのインストール、設定とホームの選択を済ませ、`BinetteSystem` を返します。`SystemUi` に表示を依頼し、`openHome()`・`open(key)`・`close(id)`・`setPage()`・`stop()` で操作します。`SystemApp` は `{ source, prebuilt }` または `{ source, read }` です。read のビルド設定（`compiler`・`libraries`）は `SystemOptions` で渡します。必要なときだけビルドを読み込みます。

`buildApp`・`loadCompiler` とビルドの型は `@binette/regie/build` から、`writePrebuiltApp` は `@binette/regie/cli` から公開します。`.binapp` の `parsePrebuiltApp`・`stringifyPrebuiltApp`・`PrebuiltApp` は `@binette/regie` から公開します。asc はビルド時だけ読みます。
