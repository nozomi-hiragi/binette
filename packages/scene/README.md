# @binette/scene

Binette のアプリの HTML を描き、アプリとシステム UI をつなぎます。依存は `@binette/core`、`@binette/regie` です。

```ts
import { mountApp } from "@binette/scene";
import { buildApp } from "@binette/regie/build";
import { startProcess } from "@binette/regie";

// app.json からの相対パスを受けて、ファイルの中身を返す関数
const read = async (path: string) => (await fetch(new URL(path, "https://example.com/settings/"))).text();
const built = await buildApp(read, {
  // Réplique は未公開なので、今は呼ぶ側がソースを渡す
  libraries: { "jsr:@binette/replique": repliqueSource },
});
const process = await startProcess(built.wasm, { onError: console.error });
const mounted = mountApp(document.querySelector("#app")!, built.html, process, { onError: console.error });
await process.begin();
// 使い終わったら mounted.stop() と process.stop() を呼ぶ。
```

- `loadCompiler()` は asc を読み込みます。初回だけ dynamic import し、結果を使い回します。`buildApp` が必要なときに呼ぶので、先に呼んで読み込み時間を測ることもできます
- `buildApp(read, options)` は `app.json`・HTML・AS を読み、AS を WASM にビルドします。ビルドに失敗すると、asc の出力を含む `Error` になります
- `mountApp(element, html, process, options)` は HTML を描き、document API の DOM 操作を枠内に反映します。通常の id を参照し、click はプロセスに渡します。プロセスの起動は `startProcess` と `process.begin()` で行います
- 許可したタグだけを作り、未対応タグやイベントは onError に知らせます。無い id は何もしません。最初の HTML は描画前に許可リストで検査し、許可しないものを取り除きます

ホームはシステムアプリ `apps/home` が持ちます。`mountShell(element, options)` は Régie のシステムを起動し、保存された設定に従ってホームを開きます。ホームが別のアプリを開くとホームを隠して Pause にし、OS のホームバーで切り替え・終了できます。インスタンスはホームも含め既定 3 つ残し、上限を超えたら最も長く前面に出ていないものを破棄します。`ShellOptions` は `apps`・`store` とビルド・起動の設定、戻り値 `MountedShell` は `stop()` を持ちます。タイルの見た目はホームの HTML にあります。

動き方の決まりは [仕様](https://github.com/nozomi-hiragi/binette/blob/main/docs/spec/scene/README.md) にあります。

## 公開するもの

| 名前 | 用途 |
| --- | --- |
| `mountApp` / `createShellUi` / `mountShell` | アプリの描画とシステム UI、起動の枠 |

Régie の `SystemApp` は `{ source, prebuilt }` か開発用の `{ source, read }` です。prebuilt は毎回その内容で保存し直し（入れた日時は保つ）、コンパイラは呼びません。read は同じ入手元・ID・版の保存結果があれば使い回します。`source` は配信の URL ではなく、変わらない入手元の名前にします（システムアプリは `binette:system` など）。

## 単独フロント

ルートで次を起動して http://localhost:5175/ を開きます。先にホームと設定アプリをビルドし、ホームから開きます。ブラウザは `.binapp` を読み、初回も asc を読みません。

```sh
deno task start
```

`deno task build:system` は `apps/` の直下で `app.json` を持つフォルダを見つけ、`.binapp/<フォルダ名>.binapp` を生成します。フォルダを足すだけでシステムアプリが増えます。生成物はコミットしません。任意のアプリは次で書き出せます。

```sh
deno run -A packages/regie/src/cli.ts build <アプリのフォルダ> --out <ファイル> --replique <Réplique の AS のパス>
```

Binette の入口はリポジトリ直下の `index.html` と `src/main.ts` です。`deno task build` は `dist/` に、サブパスでも動く静的ファイルを書き出します。保存は IndexedDB を使います。

テストと型検査は、ルートの `deno task test` と `deno task check` で行います。

v0.2 の途中で bina 属性と bina.ts の生成、Bindings・BindingKind・HtmlParser・parseBindings・generateBindingsSource・writeBindings を廃止しました。BuiltApp.bindings と parser オプション、deno-dom も不要です。AS の入口末尾には __bina_event・__bina_lifecycle の再 export を差し込みます。AS の相対 import はアプリのフォルダ内で解決します。

`Process` は state・pause()・resume()・destroy(kind, cause)・setFrozen(frozen)・setStopDelay(delay)・stop() を持ちます。State・DestroyKind・DestroyCause は `@binette/core` から import します。ProcessOptions の stopDelay は Pause から Stop までの時間（ミリ秒、既定 10000）、destroyTimeout は onDestroy の時間切れ（既定 5000）、callTimeout は起動と呼び出しの時間切れ（既定 5000）です。非表示で Pause、表示で Resume にし、凍結中は Stop の時間を数えません。ホームに戻るときはインスタンスを残し、finish は User・App で捨ててホームへ戻ります。`process.stop()` は何も知らせずに止めます。

AppStore.system に最後の状態・起動の履歴・OS の設定を保存します。ShellOptions の stackSize・historyLimit は既定の上限です。保存した設定を優先し、home の選択への反映は後続の作業です。単独の `startProcess` では ProcessOptions.persistence に保存先とキーを渡せます。
