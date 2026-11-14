# Changelog

## 未リリース

- ドキュメントアプリを binette-apps に移し、`catalog/docs`・`scripts/docs-app.ts`・`deno task docs:app` を削除する
- Binette 自身の提供リスト `apps/<ブランチ>/` と生成スクリプト `scripts/catalog.ts` を削除する。GitHub Pages の既定の提供リストは `https://nozomi-hiragi.github.io/binette-apps/` だけにする
- ホームバーの時計の時刻がボタンの左に寄り、押せる範囲が右に広がっていたのを直す。時刻をボタンの中央に置き、未開封数のバッジはドックと同じくボタンの右上の角に出す

## v0.2.1 (2026-11-14)

- ホームバー右端に未開封数を示す時計と通知センターを追加し、再読み込み前を含む未開封を新しい順に表示する。届いた最新の 1 通は 5 秒間ポップアップにし、返信中と urgent は待つ
- ドックとホームにアプリごとの未開封バッジを出し、インストールの操作をライブモードのホームのタイルへ移す。通知・時計・バッジのための Cadre と Apps の ABI を追加し、版は維持する

- ネット通信の第 3 段として、更新で増えた要求 URL を確認待ちにし、通信時の「許可」「拒否」「あとで」と設定からの一括操作を追加する。画面なし起動では設定から手紙で知らせ、確認を待つ時間は通信の制限時間に含めない
- 拒否した要求 URL を確認待ちから外し、deny list から削除すると再び確認待ちにする
- ネット通信の第 2 段として、`NetApi.addAllow`・`removeAllow`、アプリ追加の通信先の保存と 100 件の制限、設定から届く追加の手紙と通知を控える設定を足す
- 設定に「アプリ」と「ネット」を足し、アプリごとの通知の許可と通信先、全アプリ共通の allow・deny を編集できるようにする。通知画面には届いた手紙の履歴と操作を残す
- ドキュメントアプリの `src/content.ts` を、本文の区切りごとに行を分けて書き出す（1 行が長すぎて差分が読めなかったため）。GitHub では生成物として畳む（`.gitattributes`）
- ネット通信の第 1 段として、権限と URL の検査、GET 通信の制限、Réplique の `NetApi` を追加する。リストの操作と更新時の確認は今後対応する
- `App.osRef()`・`App.osCommit()` で起動中の OS のビルド情報を取得できるようにする
- 仕様に「ネット通信（net）」を足す（`docs/spec/net.md`）。権限 `net`（`request`・`tools`）、要求 URL・allow list・deny list、更新で増えた要求 URL の確認、標準の fetch に寄せた `NetApi`、`App.osRef()`・`osCommit()`
- デザイナーを Binette から binette-apps へ移し、Binette の提供リストにはドキュメントアプリだけを残す
- 破壊的変更: デザイナーの完全な ID は `https://nozomi-hiragi.github.io/binette-apps/#designer` に変わる。従来の Binette の提供リストで入れたデザイナーの保存データは引き継がない
- GitHub Pages の既定の提供リストに `https://nozomi-hiragi.github.io/binette-apps/` を追加し、ブランチの Binette のリストの次に置く。ローカルの `BINETTE_LISTS` 未指定時は空リストを維持する

- 見た目の設定が無い間は、OS のライト／ダークに合わせる。`data-theme="light"`・`"dark"` を付けたときはそちらを使う。ダークの配色は、面（`--color-base-100`）を背景（`--color-base-200`）より明るくして持ち上げる向きに変え、アクセントを明るい青にする
- ホームのタイルを枠のないアイコンと名前にし、中央に寄せて並べる。キーと部品の木は変えない
- 設定の「詳しく」「今すぐ確認」「復旧画面を開く」、通知と定期実行の操作を、面のあるボタン（`subtle`）にする。「復旧画面を開く」は「今すぐ確認」と同じ行に置く。定期実行の行に余白と区切りを足す
- アプリ管理を設定と同じ地の色・最大幅・見出しにし、まとまりを枠付きのカードで見せる。「更新を確認」「中止」「やめる」は `subtle` にする
- Filer の空のフォルダーで箇条書きの点が出ていたのを直し、中央にアイコンと文を出す。「読み込む」をほかの道具と同じ高さにし、場所の列を下まで伸ばす
- Filer の名前の入力や確認の行のボタンを、折り返さない小さめの大きさにする
- OS の設定に見た目の 3 項目を足す。`theme`（0 OS に合わせる・1 ライト・2 ダーク）、`accent`（アクセント色の番号、0〜255）、`wallpaper`（壁紙の番号、0〜255、0 は無し）。どれも既定は 0 で、`OsApi.get`・`set` の名前に加わる（ABI は変えない）。範囲外は保存しない
- `SystemOptions.onAppearance(appearance)` を足す。起動のときと設定が変わるたびに `{ theme, accent, wallpaper }` を知らせる。`@binette/regie` から `Appearance` と `APPEARANCE_LIMITS` を公開する
- 入口のページは番号を `data-theme`・`data-accent`・`data-wallpaper` に付け、色（6 色）と壁紙（5 種類のグラデーション）を CSS で決める。前回の見た目を `localStorage` の `binette.appearance` に覚え、起動画面から同じ見た目で出す。設定の色見本には `--bina-accent-N`・`--bina-wallpaper-N` を渡す
- 設定に「見た目」の節を足し、テーマ・アクセント色・壁紙を選べるようにする。壁紙はホームの後ろに敷く
- 設定を項目の一覧と中身に分ける。項目は「見た目」「既定のアプリ」（ホーム・Cadre）「通知」「定期実行」「Binette について」（説明と更新）「デバッグ」（動作の値と起動の履歴）。幅 760px を超えると左に一覧・右に中身を並べ、開いた直後は「見た目」を見せる。それ以下では一覧だけを見せ、項目を押すと中身に進み「‹ 設定」で戻る。一覧のキーは `open-appearance`・`open-defaults`・`open-notifications`・`open-schedules`・`open-about`・`open-debug`。ホームの選択やデバッグの値は、項目を開くまで木に無い
- Décor の既定のボタンに hover と押下の見た目を足し、`primary`・`ghost`・`subtle` に押下の色を足す。見出しに行間と字間を、入力欄の placeholder に色を付ける。動きを減らす設定では遷移を止める
- ホームバーのホームとインストール（狭い幅）を、ドックのアイコンと同じ 40px にそろえ、押したときにアイコンを少し縮める。通知の中の操作を小さめのボタンにする
- ドキュメントアプリ 0.1.1: 本文に読み物の余白・行間・見出しの区切りを付ける（`src/style.css` を追加）
- 設定に「日付と時刻」の項目を足し、OS のタイムゾーンを表示する。今はブラウザの設定に従い、変更はできない
- 画面に出す日時を OS のタイムゾーンにそろえる。設定の起動の履歴は UTC の表示をやめ、定期実行の「次回」「前回」と Filer の更新日も同じ入口（`@binette/regie` の `systemTimeZone()`・`formatTime()`・`formatDate()`）を通す
- `OsApi` に `timeZone()`（例 `Asia/Tokyo`）と `launchText(i)`（「YYYY-MM-DD HH:MM:SS」）を足す。`launchTime(i)` は残す
- ユーザー宛ての手紙（通知）を、届いた時刻と開封の印つきで保存する。新しい方から 100 通（`PIGEON_HISTORY_LIMIT`）で、再読み込みしても残る。`PigeonStore` に `history()`・`record(letter, time)`・`open(ids)`・`forget(ids?)` が増え、IndexedDB の `…-pigeon` は版 3 になる（表 `history` を足すだけで、受信欄はそのまま）。`@binette/regie` から `UserLetter`・`LetterAction`・`PIGEON_HISTORY_LIMIT` を公開する
- 通知の開封: 通知を押す・返事をする・閉じる、差出人のアプリが `PigeonApi.opened(kind = "")` を呼ぶ、設定から開封にする、のどれかで開封になる。アプリをアイコンから開いただけでは開封にならない。閉じた通知は消えず、開封の印が付く。通知を止めたアプリの未開封の手紙も開封にする
- 通知の ID は保存した手紙の ID になる
- 設定の「通知」に「届いた通知」を足す。新しい順に、差出人・題・本文・届いた時刻（OS のタイムゾーン）・未開封の印を出す。手紙を押すと差出人のアプリを開く。「開封にする」「すべて開封にする」（強制の開封）、「消す」「すべて消す」を置く。項目の一覧には未開封の件数を出す
- `OsApi` に `letterCount()`・`letterId(i)`・`letterFrom(i)`・`letterName(i)`・`letterTitle(i)`・`letterBody(i)`・`letterTime(i)`・`letterOpened(i)` と `showLetter(id)`・`openLetter(id)`・`openAllLetters()`・`deleteLetter(id)`・`deleteAllLetters()` を足す。`binette:os@0.1` に `letter*` の 9 関数、`binette:pigeon@0.1` に `opened` が増える

## v0.2.0 (2026-11-11)

- Réplique の 13 機能を単一の `@binette/replique` に含めて JSR に公開し、機能別の版と OS の解決・ABI は維持する
- 開発時は生成目録の内容ハッシュを入口に埋め込み、保存済み `/system` と照合する。再ビルド後に古い固定物が残っていたら、組が合う配布物を検証して取り直す。取得・検証できなければ復旧画面に進む。本番の待機中の更新と、保存済みの組によるオフライン起動は維持する
- システム・同梱のビルド済みアプリの `unsupported_abi` は、復旧画面の「/system を取り直す」を案内する。提供リストのアプリの入れ直し案内、ABI・OS call・権限と役割の条件は維持する

- 起動時の `unsupported_abi` は、保存ソースがあれば現在の検証済み SDK で自動再ビルドして開く。親・サブの同時起動はビルドを共有し、Scene に「今の OS 向けに作り直しています」を表示する。記録済みの integrity と manifest、新 WASM の ABI を確認してから開始時の保存記録・WASM がまだ一致するときだけ成果物を原子的に置き換え、再ビルド中の手動削除・更新・入れ直しを上書きしない。データ・権限・役割・版・インストール日時は保つ。失敗やソースなしでは従来の起動エラー・手動の入れ直しを維持する

- 提供リストに任意の `requires`（機能名 → ABI の版）を足し、既定カタログは同じビルドの WASM imports から自動生成する。現在の `HOST_ABI` に合わないアプリは本体の取得前に `unsupported_abi` で止め、アプリ管理に理由を出してインストール・更新を無効にする。未記載の従来アプリとビルド後の ABI 検査は維持する
- アプリ管理に `compatible`・`compatibilityError`・`installedError`・`reinstall` を足す。保存済み WASM の ABI 不一致には「この OS では動きません。入れ直してください」と表示し、既存の本体だけ削除・再インストールの経路でデータを引き継ぐ。ABI 名・OS call・権限判定は変えない
- 「探す」のカードが汎用ボタンの青背景・白文字になり、白い状態 pill の文字が読めなかった不具合を直す。アプリ行を ghost ボタンにし、行の配置と文字色・状態の色を指定する

- Réplique の 13 機能を `packages/replique/<機能>/src/index.ts` の独立パッケージ `@binette/replique-<機能>`（初期版 `0.1.0`）にし、機能間・アプリの import を `jsr:@binette/replique-<機能>@^0.1` に変更する。集約入口 `@binette/replique` の公開名、既存の ABI 名・OS call・権限判定は維持する
- SDK の exact・`^`・`~` 要求を提供版に照合し、範囲外・未知の機能・不正な形式をコンパイル前に `unsupported_sdk` で拒む。複数の範囲指定と集約入口は同じ実体へ解決する。ブラウザ Worker も専用コードと文言を保つ
- `--replique` は `packages/replique` のパッケージルートを読む。配布目録 `index.json` は機能名から完全なパッケージ版への辞書に変更する。公開物検査に全機能を含め、パッケージ版・ABI 宣言・HOST_ABI の一致を検証する
- `jsr:@binette/replique-ui` など版なしの機能指定子を受け入れ、提供中の完全な版へ解決する。旧指定子・版付き指定子とクラスや状態を共有し、未知の機能はコンパイル前に `unsupported_sdk` で拒む
- 旧 `jsr:@binette/replique/<機能>` は全 13 機能の互換入口として残し、版付きの新入口と同じ実体へ解決する。JSR の旧サブパスも再 export で維持する。Designer は元の import を残し、integrity `/` の `sha256-4EZvOMG/4uGVXvTSP/4h0R5KsrJQu1QSoJpVqDMds5E=` を維持する。ハッシュの対象と計算方法は変えない
- 未対応 ABI のエラーには「アプリの管理から入れ直すと直ります」を加える。integrity はビルドで読んだ元ソースをハッシュする動作を維持する

- 破壊的変更: Réplique の WASM import を `binette` / `dom.text` などから、機能ごとの `binette:dom@0.1` / `text` などへ変更する。`binette` / `storage.read` → `binette:storage@0.1` / `read`。`api.why`・`api.sub` は `binette:app@0.1` / `why`・`sub`。旧 `binette` は非対応で、既存のアプリは対応する SDK で再ビルドが必要
- ABI の版は 0.x では `0.minor`、1 以降では `major` を使う。既存の呼び出しを壊す変更で版を変え、追加のみでは変更しない
- SDK の各機能（外部呼び出しのない `fs` を含む）に ABI の版を宣言し、全 external と OS の提供一覧・実際のリンクの一致をテストする。OS の一覧は Worker と起動・インストール時の検査で共有する。未対応 module・関数は実行・保存前に `BinetteError`（`code: "unsupported_abi"`）にし、Worker を越えてコードと日本語のメッセージを保持して、既存の経路で Scene に表示する。OS call の実装、権限と役割の条件は維持する
- [旧アプリの復旧方法](docs/spec/regie/build.md#旧-abi-のアプリの復旧)を明記する。システム・同梱アプリは配布時に再ビルドし、提供リストのアプリは更新またはデータを残して入れ直す。保存ソースには `buildStoredApp` があるが、ABI 変更だけを契機とする自動再ビルドは行わない

- 破壊的変更: Réplique の `Api.get<T>(key)` を廃止し、各機能の `XxxApi.from(api)` で取得する。キーと権限・役割の条件、届いていないときに null を返す動作は維持する。各機能の呼び出しは次のように変更する
  - `api.get<AppsApi>("apps")` → `AppsApi.from(api)`
  - `api.get<OsApi>("os")` → `OsApi.from(api)`
  - `api.get<StorageApi>("storage")` → `StorageApi.from(api)`
  - `api.get<SharesApi>("shares")` → `SharesApi.from(api)`
  - `api.get<PigeonApi>("pigeon")` → `PigeonApi.from(api)`
  - `api.get<FsApi>("fs")` → `FsApi.from(api)`
  - `api.get<CadreApi>("cadre")` → `CadreApi.from(api)`
  - `api.get<AppManagerApi>("manager")` → `AppManagerApi.from(api)`
  - `api.get<SchedulerApi>("scheduler")` → `SchedulerApi.from(api)`
  - `api.get<ScheduleApi>("schedule")` → `ScheduleApi.from(api)`

- Réplique をホストの機能ごとの AS ファイルへ分割し、`jsr:@binette/replique/<機能名>` を公開する。既存の入口は維持する
- 破壊的変更: CLI の `--replique` は AS の単一ファイルからソースフォルダの指定へ変わる。OS の配布先は `/system/libraries/replique.ts` から `/system/libraries/replique/`（`index.ts`・各機能の `.ts`・`index.json`）へ変わる

- アプリ管理の画面にカタログのアイコンを出す。Régie の `ProviderLists` に `icon(url)` を足し（破壊的変更: 実装には `icon` が要る）、提供リストのアイコンを https で 1 回だけ取って、SVG と PNG・JPEG・GIF・WebP（64 KiB まで）を data URL にする。取れたら購読者に知らせ、写しの `icon` に入れる。届くまでと取れないときは名前の頭文字
- Décor の `image(src)` が、`data:image/svg+xml;charset=utf-8,` に `encodeURIComponent` した SVG も描く。base64 の SVG と外部 URL は今までどおり描かない
- アプリ管理を使うアプリの起動の途中に写しが変わると、起動後に届かなかった不具合を直す

- アプリの予定を実装する（[docs/spec/scheduler.md](docs/spec/scheduler.md#アプリの予定)）。辞書のキー `schedule`（Réplique の `ScheduleApi`）は、`app.json` の `permissions` に `schedule` を書いたアプリに届く。枠 0 だけに `register`（空いているときだけ）・`update`・`remove`・`runNow` と、形・止めているか・前回の時刻と結果の読み取りを持つ。`every` は 900 秒以上で、正しくない形と枠の外の番号は false を返す。予定の ID は `<完全なアプリ ID>/<枠番号>`、ラベルが無ければ設定に「スケジュール{枠番号+1}」と出す
- 予定の時刻が来ると、インスタンスがあれば（どの状態でも）`App.onSchedule(slot, api)` を届け、無ければ画面なしで起こして呼ぶ（`onCreate` は呼ばない、返ったら Worker を止める、スタックと履歴には数えない）。上限は 30 秒で、過ぎたらアプリを終了して結果を `error: 時間切れ` にする。画面なしの実行中にユーザーが開くと、終わってから開く。アプリを消すとその予定も消す
- 破壊的変更: `RegieApp` に `callWithin(timeout, name, ...args)`、`Process` に `schedule(slot, timeout)`、`Scheduler` に `saved()`・`remove(id)` が加わる。AS のビルドが `__bina_schedule` を export する
- Régie の `SystemDistribution.install` と `prepare` に任意の `options.onProgress({ loaded, total, files, totalFiles })` を追加する。保存済みファイルの即時算入、本文の逐次読み込みによる進捗通知、目録の大きさを超える取得の中断を扱う

- 辞書のキー `scheduler`（Réplique の `SchedulerApi`）を足す。設定アプリ（`binette:system` の役割 settings）にだけ届き、OS とアプリの予定の一覧、形の変更、止める・再開、今すぐ実行を扱う。設定アプリに「定期実行」の節を足し、間隔の予定は − ＋ で変えられる

- 破壊的変更: `BinetteSystem` に `scheduler` が加わる。`SystemStore` に任意の `getSchedules`・`putSchedules`（予定の保存先）を足す。省いた実装では予定を保存しない
- Régie にスケジューラ（`createScheduler`、[docs/spec/scheduler.md](docs/spec/scheduler.md)）を追加する。予定の形（`every`・`at`・`daily`・`weekly`・`monthly`）を検査し、前回の実行のあとで最初に来る時刻を過ぎた予定を 1 つずつ実行する。閉じていた間に何回分過ぎても 1 回だけ実行し、`every` の下限は OS 60 秒・アプリ 900 秒。予定は `/data/system/schedules.json` に保存し、保存した形は登録の初期値より優先する
- OS の更新確認（`os/update`、30 分）・カタログの更新確認（`os/catalogs`、30 分）・ストレージの片付け（`os/gc`、1 日）を `setInterval` からスケジューラの予定に移す。`createProviderLists` は自分のタイマーを持たなくなる。起動のたびの確認はやめ、前回＋間隔を過ぎていたときだけ起動時に実行する。初めて登録したときは間隔が過ぎるまで実行しない

- Binette の既定の提供リストを足す。`deno task pages` がブランチごとに `apps/<ブランチ>/`（例 `https://nozomi-hiragi.github.io/binette/apps/v0.2.0/`）へ HTML と `apps.json` を書き出し、そのブランチの OS の `system/boot.json` の `lists` に載せる。`source` は commit 入りの raw.githubusercontent.com の URL、`version` は `app.json` の版 ＋ `+<commit の短いハッシュ>`、`integrity` の `"/"` はビルドで求める。`build:system` は環境変数 `BINETTE_LISTS`（カンマ区切りの https の URL）を `lists` に書く
- 破壊的変更: デザイナーとドキュメントアプリを同梱から外し、`bundled/designer`・`bundled/docs` を `catalog/designer`・`catalog/docs` に移す。ID は `designer`・`docs` から、提供リストの URL ＋ `#designer`・`#docs` になる。「アプリ」から入れる
- アプリ管理の画面を足す。Cadre のサブアプリ `cadre.apps`（「アプリ」、役割 `apps-manager`）に、探す・入っている・リストの 3 つのタブと詳細を持たせる。入れる・更新・適用・中止・削除（本体だけ・データごと）、更新の確認、自動更新のトグル（アプリごと・リストごと・全体）、提供リストの追加と削除を扱う。カタログのアイコンは、画面に URL の画像を描けないため、今は名前の頭文字で代える
- Scene の枠が、インストールと権限が増える更新の前に権限を確かめるダイアログを出す（`SystemUi.confirmInstall`）。アプリ名・出どころ・権限と理由を出し、更新では増える権限を先に強調する。確認は 1 つずつ出し、Esc はやめるとみなす
- Cadre は、起動し直したときに開いているアプリがあれば、ホームを開かずに前面をそのままにする。アプリを入れると Cadre が起動し直すため、アプリ管理からホームに戻されていた
- アプリ管理の写しに、追加の途中と追加に失敗した提供リストも出す（状態 `loading`・`error: 理由`）。削除で消える
- 辞書のキー `manager`（Réplique の `AppManagerApi`）を足す。役割 `apps-manager` の、入手元が `binette:system` のアプリにだけ届く（設定と同じく割り当ては固定）。提供リストの一覧・追加・削除、カタログと入っているアプリ（本体なし・データありを含む）の一覧、状態・進捗、詳細（権限と理由、増える権限、役割、`integrity` の有無）、インストール・削除・中止・適用、更新の確認、自動更新の設定を扱う。状態が変わると OS が写しを送り直し、アプリの `build()` をやり直させる。`SystemUi` に任意の `confirmInstall` を足す（権限の確認）

- Régie にアプリ管理の TS API を足す（[docs/spec/app-manager.md](docs/spec/app-manager.md)）。`system.lists` に `uninstall(key, withData)`・`details`・`check(url?)`・`updates`・`apply`・`cancel`・`state`・`autoUpdate`・`setAutoUpdate`・`autoUpdates`・`applying`・`exited`・`subscribe`・`cached` を足す。取得とビルドは並列（既定 2 本）、保存は 1 つずつ。自動更新はアプリごとの既定がオン、リストごと・全体のオンで上書きする。権限が増える更新と動いているアプリの更新は自動では入れず、準備だけをして、終了時または `apply` で入れる。`ProviderListsOptions` に `confirm`（権限の確認）・`running`・`concurrency` を足す。更新の適用中のアプリは起動しない
- 破壊的変更: `AppStore` に `uninstall(key, withData)` と `listRemoved()` が必要になる。本体だけを消すとデータと「本体なし」の印（`/build/removed.json`）を残し、入れ直すと引き継ぐ。`SystemStore` に任意の `getAutoUpdate`・`putAutoUpdate` を足す
- `@binette/core` の `parseAppList` が、提供リストの各アプリの任意の `name`・`icon`（JSON の URL を基準に解決）・`description` を読む

- 仕様: スケジューラ（定期実行）を追加する（[docs/spec/scheduler.md](docs/spec/scheduler.md)、未実装）。OS の更新確認・カタログの更新確認・ストレージの片付けとアプリの予定を Régie にまとめ、設定アプリで一覧して変える。アプリは `schedule` 権限で自分の予定を登録し、画面なしの起動で `onSchedule(slot, api)` を受ける

- 仕様: アプリ管理（[docs/spec/app-manager.md](docs/spec/app-manager.md)）を追加する（未実装）。役割 `apps-manager` と辞書のキー `manager`、提供リストの任意の表示用の欄 `name`・`icon`・`description`、自動更新のトグル、権限の確認、本体だけの削除、Cadre のサブアプリ `cadre.apps`、Binette の既定の提供リストを決める
- 起動が終わるまで「読み込み中…」を出す。初回はシステムのファイル（ブラウザ内ビルド用の asc を含む）を取得し終えるまで、何も出なかった
- GitHub Pages のブランチごとのページを、Lume の仕様書から動く OS に変える（`deno task pages`）。API ドキュメントは OS の Service Worker の範囲から外すため `api/<ブランチ>/` に移す。仕様書はドキュメントアプリで読む。Lume の `deno task docs` はローカル用に残す
- 同梱アプリ「ドキュメント」（`bundled/docs`、ID `docs`）を追加する。`docs/` の Markdown を `deno task docs:app` で AS のソース（`bundled/docs/src/content.ts`）に変換してコミットし、テストで `docs/` との一致を確かめる。目次とページ、ページ間のリンク、見出しへの移動、前に開いていたページの復元に対応する

- 破壊的変更: 独自の `AppStore` 実装に `fileStorage` が必要になる。
- Filer と `files` の既定割り当てを追加する。端末からの読み込み・書き出し、共有とピッカー、共有フォルダーの名前変更と退出に対応する

- 破壊的変更: 独自の `AppStore` 実装に `shares`（共有の保存先）が必要になる。
- アプリ間のファイル共有を実装する。共有の作成、Pigeon による招待、承認・退出、アクセス権に応じた読み書きに対応する。Filer とピッカーに対応する

- 破壊的変更: IndexedDB のファイルの木を、OPFS の内容と IndexedDB のメタデータに分けたストレージへ変更する（[docs/spec/storage.md](docs/spec/storage.md)）。v0.2.0 は未リリースのため、旧 IndexedDB の保存データは移行しない。中身は OPFS、メタデータは IndexedDB に置く。OPFS は `_<プロバイダー番号>/-<アプリ番号>/` のフォルダに SHA-256 の名前で平置きし、編集・削除・移動は表の書き換えと履歴で行い、参照されない実ファイルは GC で消す
- 破壊的変更: 独自の `AppStore` 実装には、新たに `pigeon`（受信欄と通知設定の保存先）が必要になる
- Pigeon（[docs/spec/pigeon.md](docs/spec/pigeon.md)）を実装する。OS が差出人を付け、ユーザー宛ては Cadre の通知、アプリ宛ては IndexedDB の受信欄に届ける。通知の応答、アプリごとの通知停止、緊急の手紙による起動と、Réplique の `PigeonApi`・`onPigeon()` に対応する。宛先を種類で選ぶ機能は今後の作業
- 仕様: アプリ間のファイル共有（[docs/spec/file-sharing.md](docs/spec/file-sharing.md)）を追加する（未実装）。共有は `shared/<UUID>` を招待と承認で渡し、Filer がユーザーのファイルを持ってピッカーを受け持つ

- Régie に提供リストの登録・取得、アプリのインストール、起動時と 30 分ごとの更新確認、`movedTo` による ID の付け替えを追加する。`http:` はデバッグ設定でのみ許可する。整合性は取得した全ファイルを対象にした `/` と、ファイル・取得済みファイルを対象にしたフォルダを検証する（[仕様](docs/spec/app-id.md)）

- 破壊的変更: 埋め込みアプリの ID を `io.github.nozomi-hiragi.binette.cadre` → `cadre`、`io.github.nozomi-hiragi.binette.home` → `cadre.home`、`io.github.nozomi-hiragi.binette.settings` → `cadre.settings`、`io.github.nozomi-hiragi.binette.designer` → `designer` に変更する。`apps/home`・`apps/settings` を `apps/cadre` に統合し、ホーム・設定は `sub` として親の AS の入口・CSS を共有する。画面とホームバーの見た目は維持する
- `system/boot.json` の役割の既定を `cadre`・`cadre.home`・`cadre.settings` にし、`lists: []` を出力する。designer は `bundled/designer` の同梱のままにする。設定の上書きを防ぐため、`/user` の重ね合わせから `/apps/cadre` パッケージ全体を保護する
- 破壊的変更: `app.json` の `id` を既定で識別子の規則で検査し、`.` を含む ID を拒む。旧形式を読む道具向けの `{ strictId: false }` は残し、Régie の旧 ID の暫定例外を削除する。サブアプリは親の `sub` に宣言する

- 破壊的変更: Régie のアプリのキーを `installedAppKey(source, id)`（`JSON.stringify([source, id])`）から `appId(source, id)` が返す完全なアプリ ID に変更する。役割の割り当て・起動履歴・ライフサイクルの記録も同じ ID を使う。旧キーの保存データは移行しないため、読めなくなることがある
- `app.json` の `sub` を起動可能な入口として扱う。サブアプリは親と保存領域・権限を共有し、別の Worker とスタック項目で動く。`listed: false` はホームの一覧から隠すが、役割の候補には含める。Réplique の `Api.sub()` はサブアプリの識別子を返し、親では空文字列を返す

- `@binette/core` にアプリの識別子と提供リストの関数を追加する（[docs/spec/app-id.md](docs/spec/app-id.md)）。
  - `normalizeAppIdentifier`・`normalizeAppListUrl`・`formatAppId`・`parseAppId`: 識別子の % エンコードの正規化、提供リストの URL の検査、完全な ID（URL の ID・生の ID・サブアプリ）の組み立てと分解
  - `findAppList`・`parseAppList`: 提供リストの HTML から `<link rel="binette-apps">` か埋め込みの JSON を探し、JSON を検査する（`source` の解決、`integrity` の形、`movedTo`）。HTML を読む DOM は呼び出し側が渡す
  - `hashFile`・`hashFolder`・`computeIntegrity`・`verifyIntegrity`: `integrity` のハッシュ（`sha256-<base64>`）の計算と検証。フォルダのハッシュのバイト列のつなぎ方（`UTF-8(パス) 0x00 UTF-8(バイト数) 0x00 中身`）
  - `parseAppManifest` が `sub`（サブアプリ）と `id` の識別子の規則（`.` を含まない）を検査する
- Régie の CLI に `integrity <アプリのフォルダ> [キー...]` を追加する。キーごとのハッシュを JSON で出す（既定のキーは `/`）。`/` とフォルダキーは `--replique <AS のパス>` を指定してビルドし、インストールで取得するファイルを対象にする

- 仕様: アプリの識別子と提供リストを追加する（[docs/spec/app-id.md](docs/spec/app-id.md)、一部実装済み）。完全な ID は提供リストの URL ＋ `#` ＋ 識別子。提供リストは HTML で、`<link rel="binette-apps">` の JSON か埋め込みの JSON を読む。Cadre（ユーザー向けには「枠アプリ」）を独立したアプリにし、ホームと設定をそのサブアプリにする

- 破壊的変更: 役割・API キー `shell` を `cadre`、`ShellApi`・`ShellSnapshot`・`ShellInstance` を `CadreApi`・`CadreSnapshot`・`CadreInstance` に変更し、関連する起動・同期 API と Worker の `shell.*`・`__bina_shell_sync` も `cadre.*`・`__bina_cadre_sync` に改名する。システムアプリと boot の役割も `shell` から `cadre` に変える。

- カーネルと `/system` の更新を設定の「ソフトウェア・アップデート」にまとめる。目録に表示用の版とカーネルの印を加え、起動時に組を確かめる。目録の確認後、新しい組を裏で取得・検証してから更新する。先取り中と失敗は設定に表示し、失敗したら再試行できる。設定から復旧画面を開ける（目録の形と名前は案）

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
