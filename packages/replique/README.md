# @binette/replique

Binette のアプリ（AssemblyScript）が Régie を呼ぶライブラリです。document API と要素・イベントの管理を持ち、WASM の import（binette モジュール）は Régie が受け持ちます。

```ts
import { Api, App, Last, document, launch } from "jsr:@binette/replique";

class Example extends App {
  onCreate(_last: Last, _api: Api): void {
    document.getElementById("details").addEventListener("click", () => example.showDetails());
  }
  showDetails(): void {
    document.getElementById("description").textContent = "説明";
  }
}
const example = new Example();
launch(example);
```

Element は textContent・className、appendChild・remove・addEventListener を持ちます。同じ id は同じ Element を返し、無い id は何もしません。getter は最後に書いた値（まだなら空文字列）です。Event.currentTarget はリスナーを付けた Element です。`onCreate` の第 2 引数 `api` は、そのアプリに届く API の辞書です。`AppsApi.from(api)`（ホーム）、`OsApi.from(api)`（設定アプリ）、`StorageApi.from(api)`（すべてのアプリ）のように各クラスの `from(api)` で取り出し、届いていなければ null です。`api.why(key)` は理由（NotGranted か NotAssigned）を返します。

`api.sub()` は起動したサブアプリの識別子（例 `home`）を返し、親として開いたときは空文字列を返します。`new Api().sub()` としてトップレベルの初期化からも使えます。

アプリはパッケージを自分では持ち込まず、Scene がソースを差し込み、入口に __bina_event・__bina_lifecycle の再 export を足します。bina.ts の生成は廃止しました。

ルートの deno task check で Deno と asc の両方の型検査をします。仕様は [Réplique](https://github.com/nozomi-hiragi/binette/blob/main/docs/spec/replique.md) を見てください。

App は 6 つの状態の通知を必要な分だけ上書きします。launch は一回だけ呼びます。this.page は今のページの識別子、this.finish() は自分を閉じる呼び出しです。

機能ごとのソースは `packages/replique/<機能>` にあり、OS のビルドでは `jsr:@binette/replique-<機能>@^0.1` で参照できます。JSR には 14 機能を含む単一の `@binette/replique` を公開します。CLI の `--replique` には `packages/replique` を渡します。

`jsr:@binette/replique/<機能>` は全 14 機能の入口として維持し、各機能を再 export します。Régie は旧入口を提供中の同じ実体へ解決するため、新入口と混在しても状態は共有します。

`jsr:@binette/replique-ui` など、機能指定子の版を省略することもできます。Régie は提供中の版へ解決し、版付きの指定子や旧入口と同じクラス・状態を使います。
