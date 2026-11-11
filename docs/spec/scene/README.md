# @binette/scene

[仕様の目次](../README.md)

Scene（シーン、舞台）はシステム UI です。Binette の画面の大枠を描き、その中にアプリを置く DOM（置き場）を持ちます（のぞみ 2026-10-28）。何を見せるかは Régie が決め、Scene はそれを見せるだけです。判断は持ちません。

```
Scene（システム UI）
├── アプリの置き場（インスタンスごとに 1 つの DOM。前面以外は隠す）
│     └── アプリの HTML を描き、アプリからの DOM 操作を反映する
├── Apps の一覧（ホームが落ち続けたとき）
├── エラー表示
├── ライブモードの透かしとインストールの案内
└── ホームバー（ホーム、開いているアプリのドック、インストール。吹き出しとメニュー）
```

ホームの画面もアプリの 1 つで、置き場に入ります。Scene の一部ではありません。

## 役割

| 役割 | 状況 | ファイル |
| --- | --- | --- |
| アプリの置き場。HTML を描き、DOM 操作を反映し、クリックを Régie に渡す | 実装済み | [mount.md](mount.md) |
| 大枠。ホームバー、Apps の一覧、エラー表示、ライブモード、CSS 変数。ページの知らせを Régie に渡す | 実装済み | [shell.md](shell.md) |

ビルド、スタック、ホームの選び方と状態の移り変わりは Régie にあります（[regie/build.md](../regie/build.md)）。

## 公開するもの

移したあとの形（案）です。

| 名前 | 種類 | 内容 | 今 |
| --- | --- | --- | --- |
| `mountShell` | 関数 | 大枠を描き、Régie のシステムを起動してつなぐ | 同じ |
| `createShellUi` | 関数 | 大枠を描き、Régie に渡す `SystemUi` を作る | 同じ |
| `mountApp` | 関数 | 置き場に HTML を描き、プロセスとつなぐ | 同じ名前（HTML を描き、DOM 操作とクリックを受け持つ） |
| `isInstalled` | 関数 | ページがインストール済みか | 同じ |
| `ShellOptions`・`ShellUiOptions`・`MountedShell`・`ShellUi`・`MountedApp` | 型 | 上の設定と結果 | 同じ |

ビルドと `.binapp` の関数は Régie で公開しています。`State`・`DestroyKind`・`DestroyCause` はもう Scene から外し、`@binette/core` で公開しています。

## 依存

`@binette/core`、`@binette/regie`。asc には依存しません。

## 単独フロント（実装済み）

Scene を載せる Binette の入口はリポジトリ直下にあります（[全体の方針](../README.md#単独で起動できるフロント決定)）。`deno task start` で http://localhost:5175/ に起動し、`deno task build` で静的ファイルを書き出します。

- ワークスペースのパッケージは Vite の `resolve.alias` でソースを読みます
- `apps/` のシステムアプリを `.binapp/system/`、`bundled/` の通常の同梱アプリを `.binapp/bundled/` に書き出し、`src/main.ts` の `import.meta.glob` で別々に同梱し、`mountShell` に `prebuilt` として渡します
- 保存は IndexedDB を使い、ブラウザでは asc を読みません
- Vite の `base: "./"` でサブパス配信に対応します

v0.2 の途中で bina 属性と bina.ts の生成、bindings の API と仕様書を無くしました（決定 2026-10-27）。通常の id と document API に置き換えています。parser と deno-dom も不要になったため取り除きました（案・実装済み）。
