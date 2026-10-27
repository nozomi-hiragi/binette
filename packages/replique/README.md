# @binette/replique

Binette のアプリ（AssemblyScript）が Régie を呼ぶライブラリです。document API と要素・イベントの管理を持ち、WASM の import（binette モジュール）は Régie が受け持ちます。

```ts
import { document } from "jsr:@binette/replique";

export function start(): void {
  document.getElementById("details").addEventListener("click", () => {
    document.getElementById("description").textContent = "説明";
  });
}
```

Element は textContent・className、appendChild・remove・addEventListener を持ちます。同じ id は同じ Element を返し、無い id は何もしません。getter は最後に書いた値（まだなら空文字列）です。Event.currentTarget はリスナーを付けた Element です。apps.icon(img, i) はホーム用のアイコン表示です。

アプリはパッケージを自分では持ち込まず、Scene がソースを差し込み、入口に __bina_event の再 export を足します。bina.ts の生成は廃止しました。

ルートの deno task check で Deno と asc の両方の型検査をします。仕様は [Réplique](https://github.com/nozomi-hiragi/binette/blob/main/docs/spec/replique.md) を見てください。
