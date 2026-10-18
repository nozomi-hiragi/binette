# Binette 仕様（v0.1 下書き）

Binette（ビネット）は、サーバーがクライアントに渡す画面の定義と、それを再生する部品とシェルの約束事です。ファイルの拡張子は `.bina` です。

> [!WARNING]
> 下書きです。「未決のこと」に挙げた点は、まだ決まっていません。

## 呼び名

| 名前 | 役割 | パッケージ |
| --- | --- | --- |
| Binette | `.bina` の形式。Scene と Coulisses が共有する | `@binette/core` |
| Scene（シーン、舞台） | `.bina` を受け取り、ブラウザで再生するクライアント側の部品 | `@binette/scene` |
| Coulisses（クーリス、舞台裏） | `.bina` と asset を用意して返すサーバー側 | `@binette/coulisses` |
| Panoplie（パノプリ、一式） | Coulisses が配るビネットとファイルの一式 | `@binette/coulisses` |

## 責任範囲

Binette が扱うのは、クライアントが Scene を始めてからの画面だけです。

| 層 | 担当 |
| --- | --- |
| 形式（`.bina` に何を書くか） | Binette |
| 再生（html を置く、js を動かす、転送、後始末） | Scene |
| シェル（`sh` の API、設定画面） | Scene |
| URL の更新、戻る・進む、パスからの画面取得、起動時の行き先 | Scene |
| ビネットや asset の取得 | 標準の `fetch`、またはクライアントが渡す `fetch` |
| ログイン、セッション、通信の仕組み、テーマの保存 | クライアント |

Scene が始まる前（たとえば未ログインのとき）は、Binette は動きません。ログイン画面や、Scene を始めるかどうかの判断はクライアントの実装次第で、この仕様の範囲外です。

## クライアントからの使い方

Scene はクライアントの通信の仕組みに依存しません。必要なものは、Scene を作るときにクライアントから受け取ります。

```ts
const scene = new Scene({
  serverURL: "https://example.com/",            // ビネットや asset の取得元（必須）
  base: "/",                                    // 画面の URL の範囲。省略時は /
  fetch: (url, init) => clientFetch(url, init), // ビネットと asset を取る関数。省略時は標準の fetch
  components: { logout: (element, sh) => { /* … */ } }, // 設定画面に出す部品
});
document.querySelector("#app")!.append(scene.element);
await scene.start();
```

Scene は自分で描く要素 `scene.element` を作ります。クライアントはそれを好きな場所に置くだけです。操作は `start()`・`show(path)`・`dispose()` で行います。

## 形式

中身は JSON です。

### 欄

| 欄 | 型 | 説明 |
| --- | --- | --- |
| `binette` | 文字列 | 形式のバージョン（今は `"0.1"`） |
| `title` | 文字列（任意） | 画面のタイトル。`document.title` などに使う |
| `entry` | 文字列 | 最初に再生する asset の名前（`assets` のキー）。`redirect` と排他 |
| `redirect` | 文字列 | 転送先のパス。`entry` と排他 |
| `assets` | オブジェクト（任意） | 画面で使う asset |
| `settings` | 配列（任意） | 設定画面に差し込むセクション。入口 `/index.bina` だけが持てる |

- `entry` と `redirect` のどちらか一方を必ず書きます。
- 再生のしかたは、`entry` が指す asset の `type`（`html` か `js`）で決まります。ビネット自体に `type` は書きません。

### asset

- `assets` のキーは拡張子の無いただの名前です。種類は各 asset の `type` だけで判断します。
- asset は `type` と、`content`（文字列）か `src`（URL）のどちらか一方を持ちます。

### html の画面

```json
{
  "binette": "0.1",
  "title": "ホーム",
  "entry": "main",
  "assets": {
    "main": { "type": "html", "content": "<p>こんにちは</p><a href=\"/notes\">ノート</a>" }
  }
}
```

### js の画面

```json
{
  "binette": "0.1",
  "title": "ノート",
  "entry": "main",
  "assets": {
    "main":  { "type": "js",  "src": "/files/notes/main.js" },
    "style": { "type": "css", "content": ".note { color: var(--color-primary); }" },
    "logo":  { "type": "svg", "src": "https://cdn.example.com/notes/logo.svg" }
  }
}
```

### 転送

```json
{
  "binette": "0.1",
  "redirect": "/home"
}
```

転送先は `/` 始まりの Scene 内のパスです。外部 URL や `//` 始まりは指定しません。

## パノプリ

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
- パノプリを作るときに、ビネットを全部検査します。形式が正しくないビネットや、`index` 以外にある `settings` があると、パノプリは作れません。

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

## 取得

Scene は、ビネットも asset も、クライアントが渡した `fetch`（無ければ標準の `fetch`）で取ります。入口 `/index.bina`、画面パスから決めたビネット、asset の `src`、`sh.fetch` の URL は、`new URL(url, serverURL).href` で解決してから `fetch` に渡します。絶対 URL はそのまま、`/` 始まりは取得元のオリジン、相対 URL は取得元のディレクトリを基準にします。スキームごとの通信方法は `fetch` の実装が決めます。`content` を持つ asset は、その文字列をそのまま使います。

制約:

- `css` の asset は文字列として `<style>` に入れるため、CSS の中の相対 `url(...)` はページを基準に解決されます。画像やフォントは絶対 URL で書くか、`sh.asset(name)` で取ります。
- `js` は Blob URL から読み込むため、相対 `import` は使えません。エントリーの JavaScript は 1 つのファイルにまとめ、ほかのファイルは `sh.asset(name)` で取ります。

## 再生

- `entry` が `html` の asset: 中身を Shadow DOM の中に置きます。中の `<script>` は実行しません。
- `entry` が `js` の asset: ES モジュールとして読み込み、`mount(el, sh)` を呼びます。`el` は Shadow DOM の中の本文の要素です。`mount` は後始末の関数を返してよく、Scene は画面を離れるときにそれを呼びます。
- `redirect`: 転送先へ `base` を付けた画面 URL で、履歴を置き換えて移ります。転送先で指定されていないクエリとハッシュは引き継ぎます。転送が循環するとエラーを表示します。asset は再生しません。
- `css` の asset は、自動でその画面の Shadow DOM に適用します。
- 入口 `/index.bina` の `css` の asset は全体の CSS です。Scene はどの画面にも設定画面にも差し込みます。各画面の `css` は全体の CSS のあとに適用するので、画面ごとに上書きできます。
- Shadow DOM の中の、同じオリジンかつ `base` 配下へのリンクを押すと、Scene がページを読み直さずに画面を移します。リンクの URL はページを基準に解決し、`base` の外や別オリジンへのリンクは通常のページ移動になります。

アプリはクライアントと同じページで動きます。信頼できる Coulisses のアプリだけを動かす前提です。

## ルーティング

### URL の管理

Scene は `start()` で入口を取り、初期画面まで表示します。以後の画面遷移ではブラウザの URL を更新し、戻る・進むにも追従します。クライアントが遷移を処理したり、URL を監視して表示を指示したりする必要はありません。`dispose()` で URL の監視も終えます。

`base` は Scene が管理する画面 URL の範囲で、省略時は `/` です。たとえば `base: "/app/"` なら、Scene 内の `/notes` はブラウザでは `/app/notes` になります。`sh.navigate` と `redirect` のパスは Scene 内のパスです。`base` は取得先の URL には付けません。

### パスとビネットの対応

画面パスから取るビネットは、次の規則だけで決まります。対応表は書きません。

| 画面パス | 取得するビネット |
| --- | --- |
| `/` | `/index.bina` |
| `/notes` | `/notes.bina` |
| `/notes/123` | `/notes/123.bina` |

クエリとハッシュは画面 URL には残し、取得先には含めません。取得先が 404 なら「見つかりません」を表示します（`/index.bina` だけは例外で、下の「入口」を参照）。

### 入口

Scene を始めると、まず `/index.bina` を入口として取り、Scene が動いているあいだ覚えておきます。入口の `settings` と全体の CSS はここから使います。

入口は `/` の画面そのものでもあります。直接開いたパスはそのまま維持し、そのパスの画面を出します。`/` の扱いは、始めたときも、あとで移ったときも同じです。

- `/` は入口の中身を表示します。入口が `redirect` なら、その転送先へ移ります。
- `/index.bina` が無い（404）場合、`/` は `/settings` へ転送します。このとき設定画面は General だけになります。

### 固定の URL

`/settings` だけです。ビネットでは上書きできません。`/settings` はビネットを取りません。

## 設定画面（`/settings`）

スマホの設定アプリのような画面です。タグの構成とレイアウトは Binette が決め打ちで用意し、見た目は全体の CSS でカスタマイズします。Scene は入口の `settings` を、Scene 自身の General セクションと一緒に並べます。

```json
{
  "binette": "0.1",
  "redirect": "/home",
  "settings": [
    { "order": 10, "label": "アカウント", "type": "element", "component": "logout" },
    { "order": -1, "label": "アプリ", "type": "list", "contents": [
      { "id": "notes", "start": "📝", "label": "ノート", "sections": [
        { "type": "element", "entry": "notes" }
      ] }
    ] }
  ],
  "assets": { "notes": { "type": "js", "src": "/files/notes/settings.js" } }
}
```

- `order`: 並び順です。General は `0` で、`-1` は General の上、`1` は General の下に並びます。省略すると `0` です。同じ値なら General が先、続いて書いた順です。`order` が効くのは一番上の階層だけです。
- `type: "list"`: 行（`contents`）の一覧です。行に `sections` を書くと、押したときにその中身を `/settings/<id>` で開きます。入れ子にできます。行の欄は検討中で、今の案は `id`・`label` と、任意の `start`・`end`（文字列）です。
- `type: "element"`: 任意の表示です。`entry`（入口の `assets` の js）か `component`（クライアントが登録した部品の名前）のどちらか一方を書きます。どちらも `mount(element, sh)` の形で呼ばれ、後始末の関数を返せます。`entry` の `sh` には `asset(name)` も付きます。
- 部品はクライアントが `components` で登録します。テーマやログアウトなど、クライアントにしかできない操作をここで出します。登録されていない名前を指定すると、そのセクションは空のままエラーとして知らせます。
- 入口に `settings` が無ければ General だけを表示します。

`/settings.bina` は、のちに設定画面の見た目を変えられるようにするための場所として入れる予定です。中身はまだ決めません。

## シェル（`sh`）

`mount` の第 2 引数で、アプリが Scene（とクライアント）に頼むための API です。

- `version`: シェルの API のバージョン（`"0.1"`）
- `asset(name)`: そのビネットの asset を `Promise<Response>` で取る
- `navigate(path)`: Scene の中のパスへ移る
- `fetch(url, init?)`: Scene と同じ `fetch` で取る
- `storage`（予定）: アプリごとに区切ったクライアント側の保存場所

## ストレージ

- クライアント側: シェルはアプリに `sh.storage` を渡し、保存場所をアプリごとに分けます。設定画面はアプリごとの使用量を出し、削除できます。アプリはクライアントと同じページで動くので、`sh.storage` を使わずに直接保存することもできてしまいます。その分は設定画面から見えません。
- サーバー側: 仕様では決めません。Coulisses がアプリの設定項目として用意します。

## 未決のこと

- ビネットがどのアプリのものかをどう決めるか（パス `/notes/…` で決めるなど）
- `sh.storage` の API
- 設定画面で CSS から触れるタグやクラスの名前
- `/settings.bina` の中身
- `type: "list"` の行（`contents`）の欄
