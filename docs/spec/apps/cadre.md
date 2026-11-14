# Cadre（`apps/cadre`）

[システムアプリの目次](README.md)

役割 `cadre` に割り当てられた、最初に起動する常駐アプリです。ほかのアプリと同じ Worker の WASM で動き、AS の Décor で OS の大枠を描きます（実装済み、形は案。名前は決定）。

ID は `cadre` です。`apps/cadre/app.json` の `sub` にホーム（`cadre.home`）と設定（`cadre.settings`）を持ち、AS の入口と CSS は 1 つです。`api.sub()` が空文字列なら Cadre、`home`・`settings` なら各サブアプリとして起動します。保存領域と権限は親と共有し、それぞれ別の Worker で動きます。

`onCreate(last, api)` で `CadreApi` を取り、`CadreApi.openHome()` を呼びます。`build()` は上に `appArea().grow()`、下にホームバーを置きます。Scene がその領域へホームとアプリを配置します。Cadre 自身はスタック・ホームの一覧・起動中アプリの一覧に数えません。

バーの左にホーム、中央の台に起動中アプリ、右端に OS のタイムゾーンの時計を並べます。時計を押すと通知センターが下からすべり出ます。時計の位置と動き、インストールをホーム画面のタイルに移すこと、v0.2.1 に入れることは決定です。以下の細部は案です。

時計は 24 時間の「時:分」で、未開封があると合計のバッジを出します。0 は出さず、100 以上は `99+` です。ドックにも差出人アプリごとの未開封数を出します。Régie は分の頭で写しを送り、時計と通知時刻を描き直します。前面のアプリには点を付け、名前は吹き出しに出し、メニューから開くか閉じます。

通知センターは広い画面ではバーの右上、狭い画面では幅いっぱいのシートです。再読み込み前を含む全未開封を新しい順に並べ、差出人、アイコン、題、本文、相対時刻、操作と「閉じる」を出します。「すべて閉じる」は全件を開封し、「履歴」は設定を開きます。空なら「新しい通知はありません」と表示します。時計の再押下または外側を押すと閉じます。動きを減らす設定ではアニメーションを止めます。

起動中に届いた最新の 1 通だけを 5 秒ポップアップにします。返信入力中は待ち、閉じてから 5 秒で消します。urgent は自動で消しません。通知センター表示中はポップアップを隠します。開封した通知は設定の履歴に残ります。

`CadreApi` は `clock()`、`notificationCount()`・`notificationId(i)`・`notificationFrom(i)`・`notificationName(i)`・`notificationAppIndex(i)`・`notificationTitle(i)`・`notificationBody(i)`・`notificationTime(i)`・`notificationPopup(i)`、通知の action 取得、`notificationOpen(id)`・`notificationDismiss(id)`・`notificationReply(id, action, body)`・`notificationKeep(id, keep)`、`unread(i)`・`unreadTotal()` を持ちます。起動中アプリ向けに `count()`（別名 `running()`）、`name(i)`、`isFront(i)`、`isHome()`、`hasIcon(i)`、`appIndex(i)`、`open(i)`、`close(i)`、`openHome()`（別名 `home()`）、`back()`、`openSettings()` を持ちます。`isInstalled()`・`installBusy()`・`install()` も互換のため残します。起動中の番号は `AppsApi` のインストール済み一覧とは別です。

落ちたときは Régie が待ちを入れて再起動し、`homeRetryWindow` を過ぎても落ち続ければ、Scene がアプリの表示領域とホームボタンだけを出します（[lifecycle.md](../lifecycle.md#落ちたとき決定)）。
