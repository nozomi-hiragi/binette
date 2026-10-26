# ホーム（`apps/home`）

[システムアプリの目次](README.md)

ホームは、入っているアプリを並べ、押されたアプリを開くシステムアプリです（決定）。並べ方と見た目はホームの HTML ＋ AS が持ち、アプリを開く枠と「戻る」の帯は OS（Scene の `mountShell`）が持ちます。以下は実装済み（形は案）です。

## 役割

- `app.json` に `"role": "home"` を書く（[app.md](../app.md#appjson)）
- OS は、入手元が `binette:system` で `role` が `"home"` のアプリのうち、最初のものをホームとして開く。無ければ、画面と `onError` にエラーを出す（[scene/shell.md](../scene/shell.md#保存とホームの選び方)）
- ホームだけが、入っているアプリの一覧と起動の呼び出し（`apps.*`）を使える。ほかのアプリが呼ぶと失敗する（[replique.md](../replique.md#実装済み形は案)）

```json
{
  "id": "io.github.nozomi-hiragi.binette.home",
  "version": "0.1.0",
  "binette": "0.2",
  "name": "ホーム",
  "role": "home",
  "icon": "icon.svg",
  "entry": { "html": "src/index.html", "as": "src/main.ts" }
}
```

## 画面

- アプリごとに、アイコンと名前のタイルを 1 つ並べる
- 並べるのは、OS から渡されたアプリ。ホーム自身は並べない（OS が一覧から外して渡す）
- 並び順は OS が渡した順。システムアプリはフォルダ名の順（[README.md](README.md#配り方実装済み)）
- アイコンが無いアプリは、`img` の `src` を空のままにする（名前は出る）

HTML（抜き出し）:

```html
<div class="home-grid" aria-label="アプリ">
  <template bina="tiles"><button type="button" class="home-tile" bina-on-click="openApp"><img class="home-icon" bina-icon alt=""><span bina="name"></span></button></template>
</div>
```

- `<template bina="tiles">` は一覧の 1 行の形。AS が行を足すと、OS が中身を写して並べる（[scene/bindings.md](../scene/bindings.md)、[scene/mount.md](../scene/mount.md)）
- 行の中の `bina="name"` と `img[bina-icon]` は、その行の中だけで探す

## 動き

```ts
import { apps } from "jsr:@binette/replique";
import { tiles } from "./bina";

export function start(): void {
  tiles.clear();
  for (let i: i32 = 0; i < apps.count(); i++) {
    const tile = tiles.add();
    tile.elem("name").text = apps.name(i);
    tile.icon(i);
  }
}

export function openApp(row: i32): void {
  apps.open(row);
}
```

- `start()` で一覧を作り直す。行の番号とアプリの番号は同じになる
- アイコンは `tile.icon(i)` で頼むと、OS がそのアプリの SVG を data URL にして `img` の `src` に入れる。ホームは SVG の中身も URL も扱わない
- タイルを押すと、OS が `openApp(行の番号)` を呼ぶ。ホームは `apps.open(i)` で開くよう頼む

## OS の枠との分担

| 持ち主 | すること |
| --- | --- |
| ホーム | タイルを並べる、見た目、どれを開くかを決める |
| OS（`mountShell`） | ホームを開く。`apps.open(i)` を受けてホームを止め、そのアプリを開く。上に「戻る」の帯を出す。戻るとアプリを止め、ホームを開き直す（`start()` がもう一度走る） |

一度に動くアプリは 1 つだけです。ホームは、ほかのアプリが開いている間は止まっています。

## 見た目

- 見た目は HTML の中の `<style>` で持つ。クラス名は `home-` で始め、ほかのアプリや OS とぶつからないようにする（アプリの CSS の分離は未決）
- 色や余白は CSS 変数で、フロントが上書きできる。既定値はホームが持つ

| 名前 | 既定値 | 用途 |
| --- | --- | --- |
| `--bina-home-background` | `#f3f5f8` | 背景 |
| `--bina-home-color` | `#16181d` | 文字 |
| `--bina-home-padding` | `16px` | 一覧のまわりの余白 |
| `--bina-home-tile-size` | `112px` | タイルの列の最小幅 |
| `--bina-home-gap` | `16px` | タイルの間、アイコンと名前の間 |
| `--bina-home-border` | `#d5dae1` | タイルの枠 |
| `--bina-home-surface` | `#fff` | タイルの背景 |
| `--bina-home-radius` | `12px` | タイルの角丸 |
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
