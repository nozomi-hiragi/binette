# Changelog

## v0.2.0（未リリース）

- アプリの入口の `export function start()` を廃止し、`App`・`launch`・`State`・`DestroyKind`・`DestroyCause`・`DestroyReason`・`Last`・`__bina_lifecycle` を追加。Create → Start → Resume と Pause・Stop・Destroy を知らせる
- `App.finish()` と `App.page` を追加。呼び出しの完了後に User・App で閉じ、ページごとの識別子を渡す
- Régie の LaunchOptions に `callTimeout`・`page`・`onFinish` を追加。起動と呼び出しは既定 5 秒で時間切れにして終了する
- Régie の `call(name, ...args)` を可変長引数にする
- Scene の MountedApp に `state`・`pause()`・`resume()`・`destroy(kind, cause)`・`setFrozen(frozen)`、State・DestroyKind・DestroyCause の export を追加
- Scene の MountOptions と ShellOptions に `stopDelay`・`destroyTimeout`・`callTimeout`、MountOptions に `page`・`onFinish` を追加。Pause から既定 10 秒で Stop、onDestroy は既定 5 秒で打ち切る
- hidden で Pause、visible で Resume にし、blur だけでは移さない。freeze の間は Stop の時間を数えず、戻る・別のアプリを開くときは仮に Pause → Stop → Destroy（System・Stack）で捨てる
- ホームと設定を App の派生クラスに移し、最初の画面を onCreate で作る

- 仕様書にライフサイクルの章（`docs/spec/lifecycle.md`）を追加。ライブモード、画面を隠して残すこと（数はデバッグメニューで決める、既定 3）、起動の履歴、アプリの大本の `App` クラスと `onCreate`〜`onDestroy`、最後の状態の記録、Destroy の理由、ホームが落ち続けたときの受け皿の Apps を決める（App・6 つの状態・ページの識別子・時間切れは実装済み。スタックや記録などはまだ）
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
- 設定をシステムアプリ `apps/settings` に置き、Binette の版と説明を表示する。設定の項目と読み書きの呼び出しは未決
- ホームを HTML ＋ AS のシステムアプリ `apps/home` にする。Scene は `mountShell` で枠と「戻る」の帯を持つ
- app.json の role、ホーム用の apps.count・name・id・open を追加
- Régie から AS へ文字列を返し、call に i32 の引数を渡せるようにする
- 単独起動の入口をリポジトリ直下に追加

## v0.1.0 (2026-10-21)

- 仕様書 v0.1 の下書きと、それを実装した `@binette/core`・`@binette/scene`・`@binette/coulisses` を npm と JSR に初めて公開する
