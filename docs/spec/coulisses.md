# @binette/coulisses

[仕様の目次](README.md)

Coulisses（クーリス、舞台裏）はサーバー側です。依存は `@binette/core` です。

## これからの役割（案）

- アプリのサーバーサイド処理を受け持つ。アプリごとに分けた入口を持ち、アプリの要求は、そのアプリのサーバーサイドにだけ届く
- アプリのサーバーサイドのコードをどこに置き、どう動かすかは未決
- バックアップを受け取り、戻せるようにする。Régie がアプリごとに書き出したデータを受け取る
- Régie と Coulisses の間の通信路は、フロントの実装が渡す。Binette は WAKE に依存しない。EbinaStation では、Coulisses を WAKE と合わせて実装したものが ebina-station（Station）になる（決定）

v0.2 の最小限の土台では、Coulisses は変えていません。

## 今のコード（v0.1 のまま）

今の Coulisses は、v0.1 の `.bina` とファイルの一式（パノプリ）を、標準の Fetch API の形で配るだけです。v0.2 の Scene は `.bina` を使わないので、今の Scene とはつながりません。残すか、作り直すかは未決です。

公開するもの: `createCoulisses`・`defineBinette`・`createPanoplie`・`parsePanoplie`・`importPanoplie`・`addBinette`・`addFile`・`contentTypeOf` と、型 `Coulisses`・`CoulissesOptions`・`BinettePanoplie`・`PanoplieFile`・`PanoplieFileInput`。使い方は [packages/coulisses/README.md](../../packages/coulisses/README.md) にあります。

`.bina` の形式は [core.md](core.md#v01-の-binav01-のまま残しているもの) にあります。以下は、タグ `v0.1.0` の仕様書のパノプリの節を、今のコードに合わせて写したものです。

## パノプリ（v0.1）

パノプリは、Coulisses が配るものの一式です。ビネットの辞書と、ビネット以外のファイル（`src` で取る js や画像など）の辞書を持ちます。Coulisses は、パノプリの中身だけを返します。

### ビネットの辞書

キーは画面パスに対応する名前で、先頭の `/` と `.bina` を付けません。値はビネットです。JSON で書くとこうなります。

```json
{
  "index": { "binette": "0.1", "redirect": "/home" },
  "home": { "binette": "0.1", "entry": "main", "assets": { "main": { "type": "html", "content": "<p>こんにちは</p>" } } },
  "notes/123": { "binette": "0.1", "redirect": "/notes" }
}
```

- `index` は入口 `/index.bina` です。
- 名前は `/` で区切れます。空の区切り、`.`、`..`、`\` は使えません。
- パノプリを作るときに、ビネットを全部検査します。形式が正しくないビネットがあると、パノプリは作れません。

### ファイル

ビネット以外のファイルは、先頭の `/` を付けないパス（`files/notes/main.js` など）をキーにして入れます。各ファイルは中身と Content-Type を持ちます。Content-Type を指定しないときは拡張子から決めます。`.bina` はファイルとしては入れず、ビネットとして入れます。

### 作り方

パノプリは次のどれからでも作れます。

- ビネットの辞書（と、ファイルの辞書）のオブジェクト
- ビネットの辞書を書いた JSON の文字列
- フォルダ。ファイルシステムを読むので、`node:fs` が使える環境（Node など）でだけ動きます。`.bina` はその名前でビネットに、ほかはファイルになります。`a/b.bina` は `a/b` です。シンボリックリンクと、`.` で始まるファイルやフォルダは入れません。読むのは作るときの 1 回だけです。

### 配り方

Coulisses は GET と HEAD に応え、パスで返すものを決めます。

| リクエストのパス | 返すもの |
| --- | --- |
| `/<名前>.bina` | ビネットの辞書の `<名前>`（JSON） |
| それ以外 | ファイルの辞書の、先頭の `/` を除いたパス |

どちらにも無ければ 404 です。配るときにファイルシステムは使わないので、Coulisses は Node 以外でも動きます。

### あとから足す

Coulisses を作ったあとでも、ビネットとファイルを足せます。検査はパノプリを作るときと同じです。同じ名前やパスがすでにあれば置き換えます。足したものは次のリクエストから返します。

### CORS

`createCoulisses({ cors })` に origin を渡すと、どの応答にも `Access-Control-Allow-Origin: <origin>` を付け、OPTIONS には `Access-Control-Allow-Methods: GET, HEAD, OPTIONS` を付けて 204 で応えます。省略すると CORS のヘッダーは付けず、OPTIONS は GET・HEAD 以外のメソッドと同じく 405（`Allow: GET, HEAD`）です。

GET・HEAD 以外のメソッドは 405 で、本文は `許可されていないメソッドです。` です。`.bina` は `application/json; charset=utf-8` で返します。
