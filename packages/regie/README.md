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
- Worker は独立した URL の module Worker です。ブラウザの配布ビルドでは固定名 `regie-worker.js` を使い、Blob URL を必要としません。`workerUrl` で別の module Worker の URL も指定できます。`createWorker` があればそちらが優先されます。`workerSource()` は既存のテスト用に残しています。テストでは `createWorker` に同じスレッドの `MessageChannel` と `serveApp` をつないだものを渡せます

テストは、ルートの `deno task test` で行います。

`createSystemDistribution(tree, { manifestUrl, origin, fetch? })` は配布目録と固定物を扱います。`origin` はページの `location.origin` を渡します。目録とファイルは同じオリジンから取り、リダイレクトは許しません。テストでは `fetch` を差し替えられます。

```ts
const distribution = createSystemDistribution(tree, {
  manifestUrl: new URL("manifest.json", location.href),
  origin: location.origin,
});
const update = await distribution.checkUpdate();
if (update.installedVersion === undefined) {
  await distribution.install(update.manifest); // 初回だけ自動導入
}
const wasm = await distribution.readOverlay("/apps/home/app.wasm");
// 既存の導入がある場合は、設定で更新を選んでから install(update.manifest) を呼ぶ。
```

`checkUpdate()` は目録だけを取り、`{ manifest, installedVersion, updateAvailable }` を返します。版が異なると `updateAvailable` が true になります。取得できないときは保存目録と目録に載る全固定物を検査し、問題がなければ保存版を更新なしとして返します。保存版がない場合や検査に失敗した場合はエラーになります。`install(manifest?)` は新目録にハッシュと大きさが一致する保存済みファイルを再利用し、足りない分を取得・検査してから `/system` 全体を `replaceSystem` で入れ替えます。目録も予約パス `/system/.manifest.json` に同時保存するため、取得・検査・置換が失敗した場合は以前の版を保ちます。

固定物の読み込みは `readSystem("/system/...")`、重ね合わせは `readOverlay("/apps/...")` を使います。システムのファイルは保存目録と同じ時点で読み、毎回ハッシュと大きさを検査します。目録にあるファイルの欠落・改変や、目録にない固定物は例外にします。目録にも実体にもないパスは undefined を返します。`/user` の上書きは検査対象外で、設定アプリ `/apps/settings/` には適用しません。

`recover("clear-user")` は `/user` の変更を消し、`recover("refetch-system")` は全固定物を取得し直してから置換し、`recover("clear-all")` はファイルの木をすべて消します。削除操作はファイルごとなので、途中で保存先が失敗した場合は部分削除になることがあります。復旧後の再起動や画面は呼び出し側で行います。

`checkUpdate()` で取得したネット目録が保存版と同版なら、ファイルの順序を除いた全内容の一致も検査します。確認・導入した目録はそのインスタンスでも保持し、後の読み込みで保存目録の変更も検知します。保存目録自体の署名は現在の仕様にはなく、配布元の HTTPS と同じオリジンを信頼します。更新を保留した旧版、またはネット目録による確認前の旧版では、保存目録と本体の同時改変を検知できません。

仕様は [docs/spec/regie/](https://github.com/nozomi-hiragi/binette/blob/main/docs/spec/regie/README.md) にあります。

`@binette/core` の `DomOp` は byId・create・text・class・append・remove・listen・icon の判別共用体です。_start と call の操作は完了通知前に一回届きます。空の操作は送らず、call の例外までの操作も送ります。apps.open と finish の要求は、現在の呼び出しの完了後に onOpen / onFinish へ届けます。

LaunchOptions は callTimeout（ミリ秒、既定 5000）、page（省略時は空文字列）、onFinish を持ちます。起動と呼び出しの時間切れは、Worker を終了して reject し、起動後なら onExit で知らせます。

LaunchOptions.last で前回の page と Destroy の理由を Worker に渡せます。state・done は Process が Create の引数で渡します。createMemoryAppStore()・createIndexedDbAppStore() の戻り値の system は SystemStore です。getLast / putLast、listLaunches / recordLaunch、getSettings / putSettings で最後の状態・起動の履歴・OS の設定を読み書きできます。IndexedDB は同じ DB の v2 に system 表を追加し、既存の apps 表を残します。設定の既定値は DEFAULT_SYSTEM_SETTINGS です。

`startSystem(options)` はアプリのインストール、設定とホームの選択を済ませ、`BinetteSystem` を返します。`SystemUi` に表示を依頼し、`openHome()`・`open(key)`・`close(id)`・`setPage()`・`stop()` で操作します。`SystemApp` は `{ source, prebuilt }` または `{ source, read }` です。read のビルド設定（`compiler`・`libraries`）は `SystemOptions` で渡します。必要なときだけビルドを読み込みます。

`buildApp`・`loadCompiler` とビルドの型は `@binette/regie/build` から、`writePrebuiltApp` は `@binette/regie/cli` から公開します。`.binapp` の `parsePrebuiltApp`・`stringifyPrebuiltApp`・`PrebuiltApp` は `@binette/regie` から公開します。asc はビルド時だけ読みます。
