# ネット通信（net）

[仕様の目次](README.md)

> [!NOTE]
> 2026-11-12 にのぞみが決めた構成です。見出しに **案** と付いた所のほかは、すべて決定です。まだ実装していません。
>
> 上の「まだ実装していません」は決定時点の記録です。第 1 段では、manifest の検査、要求 URL とリストによる判定、GET 通信と制限、Réplique の `NetApi`、OS の ref・commit の取得を実装しました。リストの操作・通知・設定画面と更新時の確認待ちは今後の実装です。
>
> 第 2 段では、アプリとユーザーによる allow の追加・削除、deny の設定、追加を知らせる手紙と通知の表示設定、全アプリ共通のリストを実装しました。この仕様の「アプリの詳細」は、設定に新設した「アプリ」項目の詳細に当てています。更新で増えた要求 URL の確認待ちは第 3 段で実装しました。
>
> 第 3 段では、要求 URL の初期承認と更新時の追加・削除、確認待ちの通信に対する許可・拒否・あとでのダイアログ、画面なし起動の手紙、設定からのまとめて許可・拒否を実装しました。確認を待つ時間は通信の制限時間に含めず、同じ起動の同時要求は確認を共有します。

アプリが外の HTTP のサーバーと通信するための機能です。アプリは `app.json` の `permissions` に `net` を書き、通信したい先（要求 URL）を並べます。OS（カーネル）が通信の前に毎回 URL を確かめ、許していない先には要求を出しません。

## 方針

- アプリは Worker の中の WASM で動き、`fetch` に直接は触れない。通信は Réplique の `NetApi` を通して OS に頼む
- 通信してよい先は、要求 URL・allow list・deny list の 3 つのリストで決める。deny list がいちばん強い
- アプリから見た形は、できるだけ標準の `fetch` と `Response` にそろえる（互換性のため）
- インストールのときは、ふつうに権限の確認だけをする（URL の一覧は出さない）
- CORS はブラウザが強制する。OS は回避しない。CORS を許していないサーバーは読めない

## app.json

```json
"permissions": {
  "net": {
    "reason": "仕様書を GitHub から読むため",
    "request": [
      "https://raw.githubusercontent.com/nozomi-hiragi/binette/",
      "https://api.github.com/repos/nozomi-hiragi/binette/"
    ],
    "tools": ["addAllow"]
  }
}
```

| 欄 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `reason` | 文字列 | 必須 | 用途の説明。インストールの確認に出す（ほかの権限と同じ） |
| `request` | 文字列の配列 | 任意 | 要求 URL。アプリが通信したい先 |
| `tools` | 文字列の配列 | 任意 | アプリが使えるリストの操作。値は `addAllow` だけ。省くか空なら、リストを変えられない基本の `net` |

- `tools` の知らない値と、URL の形の誤りは、`app.json` の誤りにする（案）
- インストールの確認では、`tools` があれば「ネット（通信先を自分で足せる）」のように分けて出す（案）

## URL の形

要求 URL・allow list・deny list の 1 つずつは、URL の**前方一致**です。

- origin（`https://host[:port]`）までで切ってもよい。その host の全部に合う
  - 例: `https://raw.githubusercontent.com/nozomi-hiragi/binette/` はそのリポの下だけ。`https://example.com` はその host の全部
- path で切るときは `/` で終える。`/binette` が `/binette-apps` まで含まないようにするため。終えていなければ誤り（案）
- `*.example.com` のような名前の広げ方は、今は入れない
- `https:` だけ。`http:` は、デバッグのメニューで http を許したときだけ（案。提供リストと同じ）
- ユーザー名・パスワード（`https://a:b@host/`）と `#` 以降を含む URL は誤り（案）
- 比べる前に、OS が `new URL()` で読み直す（大文字の host や既定のポートをそろえる）

## 3 つのリスト

| リスト | 誰が書く | 中身 |
| --- | --- | --- |
| **要求 URL** | アプリの作者（`app.json` の `request`） | アプリが通信したい先 |
| **allow list** | ユーザー（設定から）と、`tools` に `addAllow` を書いたアプリ（自分の分だけ） | あとから足す、通してよい先 |
| **deny list** | ユーザー（設定から）だけ。全アプリ共通とアプリごと | 通さない先 |

判定の順:

1. deny list（全アプリ共通か、そのアプリの分）に合えば止める
2. 要求 URL か allow list（そのアプリの分か、全アプリ共通）に合えば通す
3. どれにも無ければ止める

- 基本の `net` のアプリにも、3 つのリストはどれも効く。ユーザーが足した allow list も効く
- 全アプリ共通の allow list を置く。足せるのはユーザーだけで、`net` の権限を持つアプリにだけ効く。`net` の無いアプリは通信できない。設定の画面には「すべてのネットのアプリに許します」とはっきり書く
- アプリが足すときは、アプリが `NetApi.addAllow(url)` で OS に伝え、OS がリストを変えて、その変更をユーザーに手紙（[Pigeon](pigeon.md)）で知らせる。ユーザーの確認は待たない
- アプリが消せるのは、自分が足したものだけ（`removeAllow`）。deny list に足す・消す API はアプリに無い
- ユーザーは設定から、誰が足したものでも消せる
- アプリが足せるのは、1 つのアプリで 100 件まで

### 知らせる手紙

- 差出人は OS（設定）。表に出す（Cadre に通知として出す）かは、設定でアプリごとに選べる。既定は「出す」
- 出さない設定でも、届いた通知の履歴には残す

### 設定

- アプリの詳細に、要求 URL と、そのアプリの allow list（アプリが足したものも）、deny list、確認待ちの要求 URL を出す。allow list と deny list はそこで足したり消したりできる
- 全アプリ共通の allow list と deny list は、設定の「ネット」の項目に置く（案）

## 更新で要求 URL が増えたとき

更新そのものは、ほかの更新と同じく自動で入ります（`net` や `tools` が新しく増えた更新だけ、権限が増える更新として確認する）。増えた要求 URL は、すぐには通さず「確認待ち」にし、アプリが使おうとしたときに OS のダイアログで聞きます。

1. アプリが確認待ちの URL に `fetch` したら、OS がダイアログを出す。「〇〇が、更新で追加された通信先につなごうとしています」と、増えた URL の一覧（まとめて）。一覧が長ければダイアログの中でスクロールする
2. ボタンは「許可」「拒否」「あとで」
   - 許可: 増えた URL を確認待ちから外し、ふつうの要求 URL にする。待っていた `fetch` はそのまま続く
   - 拒否: 増えた URL を確認待ちから外し、まとめてそのアプリの deny list に足す。待っていた `fetch` は `blocked`
   - あとで（閉じる）: 確認待ちのまま。待っていた `fetch` は `pending`

- ダイアログはカーネルが出す（インストールの確認と同じ）。アプリが描くものではない
- 待っている間は、制限時間に数えない（ダイアログが閉じてから数える）
- 許可・拒否は、増えた URL をまとめて扱う
- 同じ起動の中で「あとで」を選んだら、その起動ではもう出さず、すぐ `pending` を返す
- 画面なしの起動（`onSchedule`）ではダイアログを出さない。`pending` を返し、手紙で「確認待ちの通信先があります」と知らせる。手紙を押すと同じダイアログを出す
- 設定のアプリの詳細からも、確認待ちの URL を許可・拒否できる
- インストールのときの要求 URL は、権限を許したことで許可したものとする。更新で減った要求 URL は、そのまま消す

## OS が送る要求

- 最初は `GET` だけ。ほかのメソッドはのちに足す
- アプリが送れるヘッダーは `Accept`・`If-None-Match`・`If-Modified-Since` だけ
- 転送（リダイレクト）はたどらない。最初の URL には要求が出るが、サーバーが 301・302 などを返したらそこで止め、転送先には要求を出さない。同じ host の中の転送も止まる。ブラウザの `fetch` は、別の origin の転送先を読ませないので、転送先を確かめてから進むことができないため
- `credentials: "omit"`（Cookie を送らない。すべてのアプリが同じ origin で動くため）、`referrerPolicy: "no-referrer"`、`cache: "no-store"`（キャッシュはアプリが storage でする）
- 上限: 1 回の応答は 4 MiB まで、制限時間は 30 秒、1 つのアプリで同時に 4 本まで。超えたら打ち切って `too_large`・`timeout` を返す。5 本目からは、前のものが終わるまで OS が待たせる（案）
- すべてのアプリは同じ origin の上で動くので、外のサーバーからは、どのアプリの要求も同じ origin（`Origin` ヘッダー）から来たように見える

## Réplique の API

`NetApi.from(api)` で取ります。`net` の権限を書いていなければ null（`api.why("net")` は `NotGranted`）。

AS には Promise・async・クロージャが無いので、`await fetch()` の形そのものはできません。「呼ぶ所」（`fetch` が番号を返す）と「受け取る所」（`onNet`）を分け、受け取る `Response` を標準と同じ名前と意味にそろえます。

```ts
class Docs extends App {
  net: NetApi | null = null;
  req: i32 = 0;
  override onCreate(_last: Last, api: Api): void {
    this.net = NetApi.from(api);
    if (this.net != null) {
      this.req = this.net!.fetch(
        "https://raw.githubusercontent.com/nozomi-hiragi/binette/v0.2.1/docs/spec/README.md",
        new RequestInit().header("If-None-Match", etag),
      );
    }
  }
  override onNet(id: i32, res: Response): void {
    if (id != this.req) return;
    if (res.type == "error") return;          // 標準なら fetch が reject する所。理由は res.reason
    if (res.type == "opaqueredirect") return; // 転送が返った
    if (res.ok) {                             // 200〜299
      const text = res.text();
      const tag = res.headers.get("etag");    // 無ければ null
    } else if (res.status == 304) {
      // 変わっていない
    }
  }
}
```

| 標準 | net | 違い |
| --- | --- | --- |
| `fetch(url, init)` | `NetApi.fetch(url, init = new RequestInit())` | Promise の代わりに要求の番号（i32）を返す |
| `init.method` | `RequestInit.method(name)` | 今は `"GET"` だけ。ほかは `type == "error"` |
| `init.headers` | `RequestInit.header(name, value)` | 送れるのは 3 つだけ。ほかは `type == "error"` |
| `init.redirect` | `RequestInit.redirect(mode)` | `"manual"`（既定）と `"error"`。`"follow"` は使えない（標準の既定は `"follow"`） |
| Promise の解決 | `App.onNet(id, res)` | 1 回だけ呼ぶ。そのあと結果は捨てる |
| `Response.ok`・`status`・`statusText`・`url`・`type`・`redirected` | 同じ | `redirected` はいつも false |
| `Response.headers.get(name)` | 同じ | 読めるのは `content-type`・`etag`・`last-modified` だけ（案） |
| `Response.text()`・`arrayBuffer()` | 同じ名前で、すぐ値を返す | 本文が届いてから `onNet` を呼ぶので待たない |
| `Response.json()` | 無い | AS に JSON を読む部品が無いため |
| fetch の reject（`TypeError`） | `type == "error"` の `Response`（標準の `Response.error()` と同じ形） | `status` は 0。標準に無い `reason` で理由を読む |
| `AbortController` | `NetApi.abort(id)`（案） | 止めた要求の `onNet` は `reason == "aborted"` |

- 転送は、標準の `redirect: "manual"` と同じく `type == "opaqueredirect"`・`status == 0` の `Response` で返す。`redirect("error")` なら `type == "error"`・`reason == "redirect"`（案）
- `status` が 404 や 500 でも、`type` は `"cors"` で `ok` は false。通信できなかったときだけ `type == "error"`
- 画面なしの起動（`onSchedule`、30 秒まで）からも使える。画面なしの起動が終わった後に届いた結果は捨てる（案）
- `tools` に `addAllow` を書いたアプリは、`addAllow(url)` と `removeAllow(url)` を使える。形が正しく、100 件を超えなければ、`addAllow` はすぐ足して true を返す。書いていなければ false。`removeAllow` は自分が足したものだけを消し、消せたら true

### reason

| 値 | いつ |
| --- | --- |
| `blocked` | 3 つのリストで止めた。deny list で止めたときも同じ（アプリには区別させない） |
| `pending` | 確認待ちの要求 URL で、ユーザーがまだ答えていない |
| `timeout` | 30 秒を超えた |
| `too_large` | 応答が 4 MiB を超えた |
| `offline` | 端末がオフライン（`navigator.onLine` が false） |
| `network` | そのほかの通信の失敗（CORS で読めないときも含む。ブラウザが区別させないため） |
| `invalid` | URL の形や `RequestInit` が正しくない（案） |
| `aborted` | `abort(id)` で止めた（案） |
| `redirect` | `redirect("error")` で転送が返った（案） |

## OS のビルドの版

アプリが、開いている OS と同じ版のデータを取れるように、OS のビルドの ref と commit を読めるようにします。権限は要りません。

- `App.osRef()`: ビルドしたブランチかタグ（例 `v0.2.1`）
- `App.osCommit()`: ビルドした commit（40 桁の SHA）
- 値は Pages を作るときに書き込み、カーネルが Worker に渡す。開発の起動（`deno task start`）では ref を `dev`、commit を空にする（案）

## のちに足すもの

- `GET` 以外のメソッド、`Authorization` とトークンの置き場所
- WebSocket・Server-Sent Events
- CORS の無い先への、Station（Coulisses）経由の通信
- 通信の記録の一覧と、アプリごとに `net` を止めるスイッチ
- ユーザーがその場で入力した URL を開く（ブラウザのようなアプリ）
