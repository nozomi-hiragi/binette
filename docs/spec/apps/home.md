# ホーム（`apps/home`）

[システムアプリの目次](README.md)

ホームは、入っているアプリを並べ、押されたアプリを開くシステムアプリです（決定）。並べ方はホームの宣言的 UI が持ち、見た目は Scene の部品が持ち、どれをホームにするか・アプリを開く流れは Régie（[regie/system.md](../regie/system.md)）、アプリを置く枠とホームバーは Scene（[scene/shell.md](../scene/shell.md)）が持ちます。以下は実装済み（形は案）です。

## 役割

- `app.json` に `"role": "home"` を書く（[app.md](../app.md#appjson)）
- OS は、入手元が `binette:system` で `role` が `"home"` のアプリのうち、最初のものをホームとして開く。無ければ、画面と `onError` にエラーを出す（[regie/system.md](../regie/system.md#ホームの選び方)）
- ホームだけが、入っているアプリの一覧と起動の呼び出し（`apps.*`）を使える。ほかのアプリが呼ぶと失敗する（[replique.md](../replique.md#api案実装済み)）

```json
{
  "id": "io.github.nozomi-hiragi.binette.home",
  "version": "0.1.0",
  "binette": "0.2",
  "name": "ホーム",
  "role": "home",
  "icon": "icon.svg",
  "entry": { "as": "src/main.ts" }
}
```

## 画面

- アプリごとに、アイコンと名前のタイルを 1 つ並べる
- 並べるのは、OS から渡されたアプリ。ホーム自身は並べない（OS が一覧から外して渡す）
- 並び順は OS が渡した順。システムアプリはフォルダ名の順（[README.md](README.md#配り方実装済み)）
- アイコンが無いアプリは、`img` の `src` を空のままにする（名前は出る）

## 動き（案・実装済み）

`Home extends App` の `build()` で、OS が渡したアプリごとにアイコンと名前を含むボタンを作り、grid に並べます。ボタンは `arg(i)` でアプリの番号を渡し、`apps.open(i)` を呼びます。アイコンはホーム専用の `appIcon(i)` で表示します。実際のソースは [main.ts](../../../apps/home/src/main.ts) にあります。

## OS の枠との分担

| 持ち主 | すること |
| --- | --- |
| ホーム | タイルを並べる、見た目、どれを開くかを決める |
| OS（Régie と Scene） | ホームを開く。`apps.open(i)` を受けてホームを隠して Pause にし、そのアプリを開く。下にホームバーを出す。ホームへ戻ると残したインスタンスを再開し、Destroy 済みなら起動する。スタックの上限はホームを含む既定 3 |

一度に動くアプリは 1 つだけです。ホームは、ほかのアプリが開いている間は止まっています。

## 見た目

- 見た目は Scene の宣言的 UI の部品とテーマ変数で決める（案）
- 色や余白は CSS 変数で、フロントが上書きできる

| 名前 | 既定値 | 用途 |
| --- | --- | --- |
| `--bina-ui-grid-background` | `#f3f5f8` | 背景 |
| `--bina-home-color` | `#16181d` | 文字 |
| `--bina-home-padding` | `16px` | 一覧のまわりの余白 |
| `--bina-home-tile-size` | `112px` | タイルの列の最小幅 |
| `--bina-home-gap` | `16px` | タイルの間、アイコンと名前の間 |
| `--bina-ui-button-border` | `#d5dae1` | タイルの枠 |
| `--bina-ui-button-background` | `#fff` | タイルの背景 |
| `--bina-ui-button-radius` | `12px` | タイルの角丸 |
| `--bina-home-button-padding` | `12px` | タイルの内側の余白 |
| `--bina-home-icon-size` | `56px` | アイコンの幅と高さ |
| `--bina-home-focus` | `#3273b9` | フォーカスの枠 |

帯の変数（`--bina-shell-*`）は OS 側です（[scene/shell.md](../scene/shell.md#css-変数)）。

## 未決のこと

- ホームをほかのアプリに差し替えられるか。差し替えるなら、どのアプリがホームを名乗れるか
- `role` の示し方（今は `app.json` の `role` の文字列）
- `apps.*` の権限の仕組み（今は入手元と `role` だけで判断する）
- 並べ替え、フォルダ分け、アプリの追加・削除の操作
- アプリの CSS の分離
