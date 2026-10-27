# @binette/replique

Binette のアプリ（AssemblyScript）が Régie を呼ぶライブラリです。document API と要素・イベントの管理を持ち、WASM の import（binette モジュール）は Régie が受け持ちます。

```ts
import { App, Last, document, launch } from "jsr:@binette/replique";

class Example extends App {
  onCreate(_last: Last): void {
    document.getElementById("details").addEventListener("click", () => example.showDetails());
  }
  showDetails(): void {
    document.getElementById("description").textContent = "説明";
  }
}
const example = new Example();
launch(example);
```

Element は textContent・className、appendChild・remove・addEventListener を持ちます。同じ id は同じ Element を返し、無い id は何もしません。getter は最後に書いた値（まだなら空文字列）です。Event.currentTarget はリスナーを付けた Element です。apps.icon(img, i) はホーム用のアイコン表示です。

アプリはパッケージを自分では持ち込まず、Scene がソースを差し込み、入口に __bina_event・__bina_lifecycle の再 export を足します。bina.ts の生成は廃止しました。

ルートの deno task check で Deno と asc の両方の型検査をします。仕様は [Réplique](https://github.com/nozomi-hiragi/binette/blob/main/docs/spec/replique.md) を見てください。

App は 6 つの状態の通知を必要な分だけ上書きします。launch は一回だけ呼びます。this.page は今のページの識別子、this.finish() は自分を閉じる呼び出しです。
