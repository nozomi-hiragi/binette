# @binette/scene

Binette のアプリを読み、AssemblyScript をブラウザの中で WASM にビルドし、HTML を描いてアプリとつなぎます。依存は `@binette/core`、`@binette/regie`、`assemblyscript` です。

```ts
import { buildApp, mountApp } from "@binette/scene";

// app.json からの相対パスを受けて、ファイルの中身を返す関数
const read = async (path: string) => (await fetch(new URL(path, "https://example.com/settings/"))).text();
const built = await buildApp(read, {
  // Réplique は未公開なので、今は呼ぶ側がソースを渡す
  libraries: { "jsr:@binette/replique": repliqueSource },
});
const mounted = await mountApp(document.querySelector("#app")!, built, { onError: console.error });
// 使い終わったら mounted.stop() を呼ぶ。
```

- `loadCompiler()` は asc を読み込みます。初回だけ dynamic import し、結果を使い回します。`buildApp` が必要なときに呼ぶので、先に呼んで読み込み時間を測ることもできます
- `buildApp(read, options)` は `app.json`・HTML・AS を読み、AS を WASM にビルドします。ビルドに失敗すると、asc の出力を含む `Error` になります
- `mountApp(element, built, options)` は HTML を描き Régie を起動し、document API の DOM 操作を枠内に反映します。通常の id を参照し、click は登録したリスナーに届きます。export に start があれば呼びます
- 許可したタグだけを作り、未対応タグやイベントは onError に知らせます。無い id は何もしません。最初の HTML の検査はまだありません

ホームはシステムアプリ `apps/home` が持ちます。`mountShell(element, options)` は `binette:system` かつ `role: "home"` の最初のアプリを開き、ホームだけに `apps` の一覧を渡します。ホームが別のアプリを開くとホームを止め、OS の「戻る」の帯を出します。戻るとホームを起動し直します。`ShellOptions` は `apps`・`store` とビルド・起動の設定、戻り値 `MountedShell` は `stop()` を持ちます。タイルの見た目はホームの HTML にあります。

動き方の決まりは [仕様](https://github.com/nozomi-hiragi/binette/blob/main/docs/spec/scene/README.md) にあります。

## 公開するもの

| 名前 | 用途 |
| --- | --- |
| `buildApp` / `loadCompiler` | 開発用のブラウザ内ビルド |
| `mountApp` / `mountShell` | アプリの描画と起動の枠 |
| `PrebuiltApp` | manifest・HTML・任意の SVG・WASM |
| `stringifyPrebuiltApp` / `parsePrebuiltApp` | `.binapp` の書き出しと読み込み |

`ShellApp` は `{ source, prebuilt }` か開発用の `{ source, read }` です。prebuilt は毎回その内容で保存し直し（入れた日時は保つ）、コンパイラは呼びません。read は同じ入手元・ID・版の保存結果があれば使い回します。`source` は配信の URL ではなく、変わらない入手元の名前にします（システムアプリは `binette:system` など）。

## 単独フロント

ルートで次を起動して http://localhost:5175/ を開きます。先にホームと設定アプリをビルドし、ホームから開きます。ブラウザは `.binapp` を読み、初回も asc を読みません。

```sh
deno task start
```

`deno task build:system` は `apps/` の直下で `app.json` を持つフォルダを見つけ、`.binapp/<フォルダ名>.binapp` を生成します。フォルダを足すだけでシステムアプリが増えます。生成物はコミットしません。任意のアプリは次で書き出せます。

```sh
deno run -A packages/scene/src/cli.ts build <アプリのフォルダ> --out <ファイル> --replique <Réplique の AS のパス>
```

Binette の入口はリポジトリ直下の `index.html` と `src/main.ts` です。`deno task build` は `dist/` に、サブパスでも動く静的ファイルを書き出します。保存は IndexedDB を使います。

テストと型検査は、ルートの `deno task test` と `deno task check` で行います。

v0.2 の途中で bina 属性と bina.ts の生成、Bindings・BindingKind・HtmlParser・parseBindings・generateBindingsSource・writeBindings を廃止しました。BuiltApp.bindings と parser オプション、deno-dom も不要です。AS の入口末尾には __bina_event の再 export を差し込みます。AS の相対 import はアプリのフォルダ内で解決します。
