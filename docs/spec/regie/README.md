# @binette/regie

[仕様の目次](../README.md)

Régie（レジ、操作室）はカーネルです。Binette の中身を全部持ちます。アプリのビルドと検証、インストール、実行、状態の移り変わり、スタック、ホームの選び方、権限、OS の設定、保存です。画面は持たず、DOM に触りません。見せ方は Scene に知らせます（[層の分担](../README.md#層の分担決定-2026-10-28)）。

## 役割

| 役割 | 状況 | ファイル |
| --- | --- | --- |
| アプリの AS を WASM にビルドし、`.binapp` に書き出す。検証もここに足す | 実装済み・今は Scene。Régie へ移す | [build.md](build.md) |
| アプリの WASM を Worker で動かし、呼び出しを受ける | 実装済み | [run.md](run.md) |
| 1 アプリ分の状態の移り変わり、時間切れ、最後の状態、イベントを届けるか | 実装済み | [process.md](process.md) |
| インストール、ホームの選び方、スタック、閉じる、落ちたとき、権限、OS の設定、ページで起きたこと | 実装済み・今は Scene。Régie へ移す | [system.md](system.md) |
| インストール済みアプリと OS の記録の保存 | 実装済み | [store.md](store.md) |

まだないもの（案）:

- アプリごとの権限の判断。システムアプリ `apps/settings` から、アプリごとに権限を取り消せる
- アプリごとのストレージ。ほかのアプリからは読めない。容量の上限を持つ
- アプリのデータを、アプリごとにまとめて書き出せる形で持つ。バックアップのときは、それを Coulisses に送る
- ハッシュや権限の記録（[app.md](../app.md#régie-が記録するもの案)）
- HTML の検証（[build.md](build.md#検証案)）

アプリは Régie が渡した呼び出ししか使えません。ネットワークや DOM に直接は触れません。

## 公開するもの

移したあとの形（案）です。「今」は今のコードで公開している場所です。

| 名前 | 種類 | 入口 | 今 |
| --- | --- | --- | --- |
| `startSystem`・`SystemOptions`・`SystemApp`・`SystemUi`・`SystemView`・`BinetteSystem` | 関数・型 | `@binette/regie` | `@binette/regie` |
| `startProcess`・`ProcessOptions`・`Process` | 関数・型 | `@binette/regie` | `@binette/regie` |
| `launchApp`・`serveApp`・`LaunchOptions`・`RegieApp`・`RegieWorker`・`WorkerScope`・`OsSnapshot` | 関数・型 | `@binette/regie` | 同じ |
| `createMemoryAppStore`・`createIndexedDbAppStore`・`installedAppKey`・`DEFAULT_SYSTEM_SETTINGS`・`validateSystemSettings` と保存の型 | 関数・型 | `@binette/regie` | 同じ |
| `parsePrebuiltApp`・`stringifyPrebuiltApp`・`PrebuiltApp` | 関数・型 | `@binette/regie` | `@binette/scene` |
| `buildApp`・`loadCompiler`・`BuildOptions`・`BuiltApp`・`Compiler`・`CompilerStream` | 関数・型 | `@binette/regie/build` | `@binette/scene` |
| `writePrebuiltApp`（CLI） | 関数 | `@binette/regie/cli` | `@binette/scene/cli` |

- `.binapp` を読むだけの `parsePrebuiltApp` は本体に置きます。ブラウザの OS はビルドせず、`.binapp` を読むだけだからです
- `State`・`DestroyKind`・`DestroyCause`・`DomOp` は core で公開しています（実装済み。[core.md](../core.md#ライフサイクルの番号案)）

## 依存

`@binette/core`、`assemblyscript@0.28.20`（npm。`@binette/regie/build` だけ）、`@std/path`（CLI だけ）。
