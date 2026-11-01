# シェル（`apps/shell`）

[システムアプリの目次](README.md)

役割 `shell` に割り当てられた、最初に起動する常駐アプリです。ほかのアプリと同じ Worker の WASM で動き、AS の Décor で OS の大枠を描きます（実装済み、形と名前は案）。

`onCreate(last, api)` で `ShellApi` を取り、`ShellApi.openHome()` を呼びます。`build()` は上に `appArea().grow()`、下にホームバーを置きます。Scene がその領域へホームとアプリを配置します。シェル自身はスタック・ホームの一覧・起動中アプリの一覧に数えません。

バーにはホーム、起動中のアプリ、戻る、前面を閉じる、設定、ライブモードのインストールのボタンを並べます。ホームが前面なら戻る・閉じるは出しません。起動中の一覧と前面の変化は Régie が Worker に知らせ、再描画します。切り替え・終了の判断は Régie が行います。

`ShellApi` は `count()`（別名 `running()`）、`name(i)`、`isFront(i)`、`isHome()`、`hasIcon(i)`、`appIndex(i)`（`appIcon` に渡す番号）、`isInstalled()`、`installBusy()`、`install()`、`open(i)`、`close(i)`、`openHome()`（別名 `home()`）、`back()`、`openSettings()`（設定の役割に割り当てたアプリを開く）を持ちます。番号は起動中の一覧の番号で、`AppsApi` のインストール済み一覧とは別です。`notify(text)` は入口だけで、通知表示は未実装です。

吹き出し・右クリックや長押しのメニューは未移植です。ライブモードではインストールボタンを表示し、確認を待つ間は押せなくします。重ね表示の部品、通知の表示、見た目の細部は案です。シェルの差し替えはブートと保存設定で選べますが、設定画面からも変更できます。

落ちたときは Régie が待ちを入れて再起動し、`homeRetryWindow` を過ぎても落ち続ければ、Scene がアプリの表示領域とホームボタンだけを出します（[lifecycle.md](../lifecycle.md#落ちたとき決定)）。
