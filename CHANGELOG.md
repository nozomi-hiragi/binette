# Changelog

## v0.2.0（未リリース）

- `@binette/scene` の `buildApp`・`loadCompiler`・`BuildOptions`・`BuiltApp`・`Compiler`・`CompilerStream` を `@binette/regie/build` へ、`parsePrebuiltApp`・`stringifyPrebuiltApp`・`PrebuiltApp` を `@binette/regie` へ、`@binette/scene/cli` を `@binette/regie/cli` へ移す。`SystemOptions.build` を削除し、Scene は assemblyscript に依存しなくなる

- Scene の `mountShell` が持っていたインストール・設定・ホーム選択・スタック・再起動・権限・ページ状態の判断を Régie の `startSystem` に移す。Scene に表示用の `createShellUi`・`ShellUi`・`ShellUiOptions` を追加し、`ShellApp` を Régie の `SystemApp` に変更。Régie に `SystemOptions`・`SystemUi`・`SystemView`・`BinetteSystem` を追加し、ビルドを移すまでは `SystemOptions.build` で渡す

- Scene の `mountApp(element, built, options)`・`MountOptions`・`MountedApp` の形から、Régie の `startProcess`・`Process` と Scene の `mountApp(element, html, process, options)` に移す
- Régie の `DomOp` と Scene の `State`・`DestroyKind`・`DestroyCause` を `@binette/core` へ移す。Régie・Scene からの export はやめる
- Scene に `isInstalled(window)`、ShellOptions に `installed`、MountedShell に OS 用の `requireInstall(reason)` を追加。display-mode の 3 つと iPhone の standalone で判定し、change・appinstalled に追従する。fullscreen だけではインストール済みにしない
- ライブモードではホームバーの上の右下に透かし、バーの右端に「インストール」を表示。beforeinstallprompt があれば prompt、無ければ OS の dialog に手順と閉じるボタンを出す。requireInstall は同じ枠に理由を文字として添え、ライブなら false、インストール済みなら true を返す。保存の扱いは変えない（表示と API の形は案）
- ルートの OS にマニフェストと自作の B の SVG、本番だけ登録する手書きの Service Worker を追加。版付きキャッシュに最低限のシェルを入れ、navigate はネット優先、同じオリジンのほかの GET は stale-while-revalidate。別オリジンと GET 以外には触らず、古い binette- キャッシュを消す。開発では登録しない（キャッシュの形は案）
- Vite の publicDir から sw.js・manifest.webmanifest・icon.svg を dist 直下に同梱し、SW の型検査を check に追加。URL は相対指定でサブパスに対応する

- 落ちたホームを起動し直す前に待つ。100ms から倍にして 1000ms で頭打ちにし、数え直すと 100ms に戻す。起動してすぐ落ちるホームを、待ちなしで何百回も起動し直さない
- ホームの起動失敗や動作中の落ちが homeRetryWindow を過ぎても続いたら、shell が直接 Apps を描く。ホーム候補を除くホームと同じ一覧（設定を含む）を、名前の文字コード順に縦のリンクで並べる。Apps はスタックとホームバーの一覧に数えない
- Apps から開いたアプリを閉じたら Apps に戻る。ホームバーの「ホーム」で失敗の計時を消してホームを再試行し、また落ち続ければ Apps を出す。見た目は `.bina-shell-apps`・`.bina-shell-apps-link` と既存の `--bina-shell-*` で変えられる（案）
- システムの role settings だけに Réplique の `os.get`・`set`・`home`・`homeCount`・`homeName`・`homeId`・`setHome`・`launchCount`・`launchTime`・`launchName` を渡す。渡されていないアプリからの呼び出しはアプリを終了し、set の範囲外と知らない名前は false を返して保存しない
- Régie に `OsSnapshot`、LaunchOptions と MountOptions に `os`・`onSet`・`onSetHome`、MountedApp に `setStopDelay` を追加。設定の変更を保存し、次の操作から使う。stopDelay は既存インスタンスの次の Pause からも反映する
- 設定アプリにホームの選択、6 項目のデバッグ値の − ＋、新しい順の起動の履歴（UTC）を追加。home は installedAppKey で保存し、選んだホームへ戻る。前のホームは User・Os で Destroy し、新しいホームに apps.* を渡す
- validateSystemSettings は知らない項目も拒む。時間の下限は従来どおり 0。os.set の呼び出しと onDestroy の時間切れは 1 秒以上に制限する
- AppStore に `system: SystemStore` を追加。`LifecycleRecord`・`LaunchRecord`・`SystemSettings`・`SystemStore`・`DEFAULT_SYSTEM_SETTINGS`・`validateSystemSettings` を公開。最後の状態・起動の履歴・OS の設定を、メモリまたは同じ IndexedDB の別の表に保存する（v1 のアプリは残して v2 に移行）
- SystemStore に `getLast`・`putLast`・`listLaunches`・`recordLaunch`・`getSettings`・`putSettings` を追加。状態の前後で保存を待ち、異常終了なら done=false のまま次の Create に渡す。履歴は新しいインスタンスだけを記録し、既定 100 件
- LaunchOptions に `last`、MountOptions に `persistence`、ShellOptions に `stackSize`・`historyLimit` を追加。保存した OS の設定を ShellOptions より優先する
- 画面を切り替えても DOM と Worker を残して Pause にする。ホームを含め既定 3 インスタンスまで残し、上限超過では前面以外の最も長く前面に出ていないものを Stop → Destroy（System・Stack）。背面で落ちた場合は前面を変えずにエラーを出す
- 上部の「戻る」の帯（`.bina-shell-toolbar`・`.bina-shell-back`）を下部のホームバー（`.bina-shell-homebar`・`.bina-shell-button`・`.bina-shell-entry`）に置き換える（見た目と操作は案）。ホーム・アプリの切り替え・× で終了（User・Os）を提供し、CSS 変数 `--bina-shell-gap` を追加

- アプリの入口の `export function start()` を廃止し、`App`・`launch`・`State`・`DestroyKind`・`DestroyCause`・`DestroyReason`・`Last`・`__bina_lifecycle` を追加。Create → Start → Resume と Pause・Stop・Destroy を知らせる
- `App.finish()` と `App.page` を追加。呼び出しの完了後に User・App で閉じ、ページごとの識別子を渡す
- Régie の LaunchOptions に `callTimeout`・`page`・`onFinish` を追加。起動と呼び出しは既定 5 秒で時間切れにして終了する
- Régie の `call(name, ...args)` を可変長引数にする
- Scene の MountedApp に `state`・`pause()`・`resume()`・`destroy(kind, cause)`・`setFrozen(frozen)`、State・DestroyKind・DestroyCause の export を追加
- Scene の MountOptions と ShellOptions に `stopDelay`・`destroyTimeout`・`callTimeout`、MountOptions に `page`・`onFinish` を追加。Pause から既定 10 秒で Stop、onDestroy は既定 5 秒で打ち切る
- ShellOptions に `homeRetryWindow` を追加。落ち続けるホームは、最初の落ちから既定 5 秒を過ぎたら Apps に切り替える
- hidden で Pause、visible で Resume にし、blur だけでは移さない。freeze の間は Stop の時間を数えず、戻る・別のアプリを開くときは画面を隠して Pause にし、インスタンスを残す
- ホームと設定を App の派生クラスに移し、最初の画面を onCreate で作る

- 仕様書にライフサイクルの章（`docs/spec/lifecycle.md`）を追加。ライブモード、画面を隠して残すこと（数はデバッグメニューで決める、既定 3）、起動の履歴、アプリの大本の `App` クラスと `onCreate`〜`onDestroy`、最後の状態の記録、Destroy の理由、ホームが落ち続けたときの受け皿の Apps を決める（App・6 つの状態・ページの識別子・時間切れは実装済み。スタック・最後の状態・履歴・OS の設定の保存も実装済み）
- DOM 風の document・Element・Event・apps.icon・__bina_event を追加。通常の id と明示したリスナーで画面を扱う
- Régie に onDom・DomOp を追加。_start と call の DOM 操作を完了前にまとめて送る
- v0.2 の途中で elem・Elem・list・List・Item・ItemElem、bina 属性・bina.ts の生成を削除
- Bindings・BindingKind・HtmlParser・parseBindings・generateBindingsSource・writeBindings・gen:bindings を削除
- BuiltApp.bindings・BuildOptions.parser・ShellOptions.parser と deno-dom の依存を削除
- onText・onListAdd・onListClear・onItemText・onItemIcon を削除
- ホームと設定を document API に移行。生成するタグを制限し、click リスナーは停止時に解除する
- Worker の落ち・通信失敗とアプリ内の例外でアプリを終了する。onExit を追加し、Scene の枠はホームに戻ってエラーを表示する
- システムアプリを `apps/` にまとめ、フォルダを足すだけでビルドとホームに含める
- 仕様書にシステムアプリの章（`docs/spec/apps/`）を追加。ホームと設定の仕様を書く
- システムアプリを .binapp に書き出し、初回もブラウザでビルドせずに開く
- Binette が持つ最小のホームを追加。アイコンと名前からアプリを開き、戻れる
- Régie にメモリと IndexedDB の AppStore を追加。同じ版のビルド結果を使い回す
- app.json の icon の型を検査し、SVG を画像として表示する
- 設定をシステムアプリ `apps/settings` に置き、Binette の版と説明を表示する
- ホームを HTML ＋ AS のシステムアプリ `apps/home` にする。Scene は `mountShell` で枠とホームバーを持つ
- app.json の role、ホーム用の apps.count・name・id・open を追加
- Régie から AS へ文字列を返し、call に i32 の引数を渡せるようにする
- 単独起動の入口をリポジトリ直下に追加

## v0.1.0 (2026-10-21)

- 仕様書 v0.1 の下書きと、それを実装した `@binette/core`・`@binette/scene`・`@binette/coulisses` を npm と JSR に初めて公開する
