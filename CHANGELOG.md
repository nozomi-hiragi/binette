# Changelog

## v0.2.0（未リリース）

- 設定アプリをグループのカードと行に整え、ホーム・シェルの選択、デバッグ値、更新、UTC の起動履歴を見やすくする。アプリ固有の CSS で狭い画面とライト・ダークに対応する

- 常駐シェルをシステムアプリ `apps/shell` に移す（形と名前は案）。Régie が最初に起動し、シェルが `ShellApi.openHome()` でホームを呼ぶ。シェルはスタックに数えず、ホームや Apps の一覧にも出さない。Décor の TS・AS に `appArea()`、Réplique に `ShellApi` と起動中一覧の同期を追加する。Scene はアプリを表示領域に配置し、シェルが落ち続けた場合だけ表示領域とホームボタンの大枠を描く。既定のバーはホーム・起動中のアプリのドック・ライブモードのインストール。名前の吹き出しと開く・閉じるメニューは Décor の TS・AS の部品にし、アプリの CSS を表示先に限定して適用する。設定からシェルを差し替えられ、通知は API の入口だけ
- asc をカーネルの外に配布し、目録で検証したコンパイラを Worker で動かして、ファイルの木のアプリのソースをビルドする（API と保存先は案）。Réplique のソースも目録に載せる。システムアプリは従来どおりビルド済みの WASM を使う

- 役割と API の辞書を実装する（[docs/spec/roles.md](docs/spec/roles.md)、形と名前は案）。
  - `app.json` の `role`（文字列）を `roles`（文字列の配列）に変える。旧名の `role` は読み替えず `BinetteError` にする。apps/home・apps/settings の `app.json`、テスト、仕様を合わせた
  - 役割の割り当て: 初回は `system/boot.json` の既定（カーネルが `SystemOptions.roles` に渡す）、そのあとは `SystemSettings.roles`（役割 → installedAppKey。以前の `home` を置き換える）。名乗っただけでは API は届かず、割り当てられたアプリにだけ届く。変えられるのは設定アプリの `OsApi.assign` だけで、設定の役割は固定
  - Réplique: `onCreate(last, api)` に変える。古い `onCreate(last)` の上書きは AS のコンパイルエラーになるので、`api: Api` を足して移行する。`Api`（`get<T>(key)`、`why(key)`）、`Why`、`AppsApi`・`OsApi`・`StorageApi`・`FsApi` を追加し、`apps`・`os` の名前空間は外す。`OsApi` は `home`・`homeCount`・`homeName`・`homeId`・`setHome` を `role`・`candidateCount`・`candidateName`・`candidateId`・`assign` に置き換え、`updateAvailable`・`update` を足す
  - Régie: `ProcessOptions.grants` と `LaunchOptions` に `storage`・`denied`（辞書に載せなかった理由）、`onAssign`・`onUpdate`・`onStorage` を足し、`onSetHome` を `onAssign` に変える。`OsSnapshot` の `homes` を `roles`・`candidates`・`updateAvailable` に、`SystemSettings.home` を `roles` に変える。`AppStore.data`（`/data/<id>/`）、`SystemOptions.roles`・`SystemOptions.update` を追加。辞書を通さずに `apps.*`・`os.*`・`storage.*` の import を呼ぶと、従来どおりアプリを終了する
  - 設定アプリに「更新」を追加する。新しい版があるとき、押すと `/system` を入れ替えて再読み込みする。起動画面の「復旧画面を開く」の知らせは、設定アプリへの案内に変えた
  - `storage`（アプリごとのデータ）を足す。`fs` はキーだけで、今は誰にも届かない
- Régie: `workerSource()`（Blob URL 用の Worker のソース文字列）を公開 API から削除する。Worker は `regie-worker.js`（開発では `worker-entry.ts`）の module Worker か、`createWorker` に `serveApp` をつないだもので作る

- カーネルを固定名の `regie.js` と `regie-worker.js` に分け、入口に SRI を付ける。Service Worker は入口とカーネルをオフライン用に保持し、ファイルの木を `./fs/` から返す（URL と Worker の改変検知方法は案）

- 目録とハッシュでシステムを配布・検査し、ファイルの木から起動する。更新の検出と復旧画面を追加（目録の形と同梱アプリの置き方は案）

- Régie に IndexedDB とメモリのファイルの木を追加し、`AppStore`・`SystemStore` をその上に移す。`/system` と `/user` を重ね、設定アプリは上書きしない。既存の IndexedDB の記録を移行する（API と保存先の細部は案）

- 仕様に、起動と配布（[docs/spec/boot.md](docs/spec/boot.md)）と、役割と API（[docs/spec/roles.md](docs/spec/roles.md)）を追加。カーネルだけを配り、システムアプリは目録とハッシュを見て取ってきてブラウザの中のファイルの木に置く。シェル（ホームバー・通知などの大枠とアプリの表示領域。最初に起動する）・ホーム・設定は役割を持つふつうのアプリにし、使える API を辞書で渡す。ファイルの木・辞書 API・常駐シェルは実装済み

- ホームバーをドックに作り直す（案）。左にホーム、中央の台に開いているアプリのアイコン（無ければ頭文字の札）、右にインストール。名前は吹き出し、閉じるのは右クリック・長押し・メニューキー・Shift+F10 のメニューから。× は出さない。並びは Décor の TS の `mount` で描き、`mount(element, { apps })` で `appIcon` のアイコンを渡せるようにした。Régie の `SystemView.instances` に `icon` を足した

- デザイナーにアイコンを追加

- Décor の TS・AS に、Flutter・Jetpack Compose・SwiftUI によくある部品 `spacer`・`separator`・`stack`・`checkbox`・`radio`・`slider`・`picker`・`segmented`・`tabs`・`progress`・`spinner`・`image`・`listTile`・`chip`・`badge` と、修飾 `step`・`align` を追加（案）。値を返す部品は数を届ける新しいイベント（Régie の `dispatchUiValue`、アプリの `__bina_ui_value`）で値を受け取り、描き直しでアプリの値にそろえる。画像は base64 のラスターの data URL だけ。ダイアログ・シート・スナックバーは OS の重ね表示が要るので見送る。デザイナーは新しい部品の追加・木・インスペクター・コードの読み書きとプレビューに対応し、修飾の `width`・`height`・`step`・`align` も扱う

- Décor の宣言 UI を部品の木として編集し、コールバック式を保ったままコードに戻せるデザイナーを追加

- Décor の TS・AS に見た目の修飾（ボタンの種類の `variant`・文字の色の `tone`・面の `surface`、`divider`・`mono`・`small`・`bold`・`truncate`・`width`・`height`・`minHeight`・`center`・`wrap`・`selected`・`highlight`・`toggle`・`scroll`・`fill`・`collapse`・`placeholder`）を追加し、色は OS の役割の CSS 変数で決める。既定の入力欄は線の色の枠と角丸と余白を持つ（案）

- Décor の TS・AS に `input(...).multiline()` を追加し、複数行の入力を textarea で扱う（案）

- `bundled/` の同梱アプリを `apps/` のシステムアプリから分け、出力先と入手元を独立させる。同梱アプリにはシステムの権限を与えない

- システム UI（Scene の枠）を画面の高さに固定し、アプリやアプリ一覧が大きいときはアプリの領域の中だけでスクロールする

- Scene は document 方式の最初の HTML を描く直前に許可リストで検査し、危険な要素・属性や外部 URL を取り除く（案）

- AS のフォルダ（apps・replique）に AS 公式の型定義を読ませ、型のための `@ts-ignore` を外した。`deno task check` に apps と `deno lint` を加え、lint の警告を 0 件にした。JSR の公開前チェックがメンバーの compilerOptions を見ないため、CI の `deno publish` は `--no-check` にした（型検査は `deno task check` で行う）

- Décor の部品・修飾・段・テーマを `parts.ts` にまとめ、TS と AS で同じコードを使う（案）。`View.callback` は両方とも `UiCallback`。公開の名前は変えない。ハンドラーの包み方と TS のフック・mount はそれぞれのファイルに残す

- Décor の TS・AS に名前付きの段 `space` / `radius` / `fontSize` と部分木の `theme(設定, view)` を追加（案）。button・input の padding・角丸・文字の大きさを宣言で設定できる。数は px のまま、引数なしの `.gap()` / `.padding()` は md。既存の Scene・home・settings の指定を維持する

- Décor の TS に関数の部品 `component`、状態の `useState`、片付け付きの `useEffect` を追加。状態の更新は root の再描画をマイクロタスクにまとめる（案）。AS と JSX は対象外

- 宣言 UI の木・差分・DOM への反映・AS の部品を `@binette/decor`（Décor）へ切り出す。`jsr:@binette/replique/ui` は互換の入口として再エクスポートする。普通の TS ページ向けに `mount(element)` と、返した root の `render(view)`・`unmount()` を追加する（案）。JSX は含めない
- Régie: `serveApp` は Décor の差分関数を引数で受け取る

- 宣言 UI に `.heading(level)` と `.list()` を追加（読み上げでも見出し・一覧になる）。OS の部品の CSS をアプリによらない汎用のものにし、テーマの変数を `--bina-ui-*` にそろえる。`--bina-home-*` は使わない
- 宣言的 UI に input・grid・minWidth・appIcon・show を追加し、ホームと設定を宣言的 UI に移行する（案）

- 宣言的 UI の部品と修飾、差分描画、要素ハンドルによるクリックの配送を追加し、app.json の entry.html を省略可能にする（案）

- Réplique に `removeEventListener` を追加し、リスナー解除と要素・子孫の削除時に Réplique と Scene の参照と DOM リスナーを解放する（案）

- Lume で仕様書を HTML にし、API ドキュメントと一緒にブランチごとの GitHub Pages に出す

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
