# Régie: システム

[Régie の目次](README.md)

OS 全体の判断を持つ部分です。インストール、ホームの選び方、スタック、閉じる流れ、落ちたときの扱い、誰にどの呼び出しを渡すか（権限）、OS の設定、ページで起きたことの扱いを決めます。画面は持たず、何をどう見せるかは Scene の [システム UI](../scene/shell.md) に知らせるだけです。

今のコードでは、これらは `packages/regie/src/system.ts` にあります。「API」の節は案、ほかの節の動きは実装済み（形は案）です。

## API（案）

```ts
type SystemApp = { source: string } & (
  | { read: (path: string) => Promise<string>; prebuilt?: never }
  | { prebuilt: Pick<InstalledApp, "manifest" | "html" | "wasm"> & { icon?: string }; read?: never }
);
interface SystemOptions extends BuildOptions {
  apps: SystemApp[];
  store: AppStore;
  callTimeout?: number; // ミリ秒、既定 5000
  stopDelay?: number; // ミリ秒、既定 10000
  destroyTimeout?: number; // ミリ秒、既定 5000
  homeRetryWindow?: number; // ミリ秒、既定 5000
  stackSize?: number; // ホームを含む、既定 3
  historyLimit?: number; // 既定 100
  createWorker?: ProcessOptions["createWorker"];
  /** 見せ方を受け持つ側。Scene のシステム UI が渡す */
  ui: SystemUi;
}
/** Régie がシステム UI に頼むこと */
interface SystemUi {
  /** インスタンスの置き場を作り、HTML を描いて process.attach する。返した置き場は remove で消す */
  present(instance: { id: number; app: InstalledApp; home: boolean; apps?: { id: string; name: string; icon?: string }[] }, process: Process): { remove(): void };
  /** 見せる状態が変わった */
  update(view: SystemView): void;
  /** エラーを見せる。同じエラーが何度か届くことがある（Pause の失敗など）。まとめるのは UI の役目 */
  report(error: unknown): void;
}
interface SystemView {
  /** スタック。並びはホームバーに出す順。icon はアプリの SVG の文字列（無ければ undefined） */
  instances: { id: number; key: string; name: string; icon?: string; home: boolean; closing: boolean }[];
  /** 前面。"apps" は Apps の一覧 */
  front: number | "apps" | undefined;
  /** Apps に並べるアプリ（名前の順） */
  apps: { key: string; name: string }[];
  /** show でエラー表示を消すときだけ true */
  clearError: boolean;
}
interface BinetteSystem {
  /** ホームを開く。startSystem のあと、システム UI をつないでから呼ぶ。ホームが残っていなければ起動する */
  openHome(): Promise<void>;
  open(key: string): Promise<void>;
  close(id: number): Promise<void>;
  /** ページの今の様子を知らせる。システム UI が visibilityState と freeze・resume から作る */
  setPage(page: { visible: boolean; frozen: boolean }): void;
  stop(): void;
}
function startSystem(options: SystemOptions): Promise<BinetteSystem>
```

- `startSystem` は、インストールと設定の読み込みとホームの選択までを済ませて解決します。ホームはまだ開きません。呼ぶ側はシステム UI をつなぎ（ボタンとページの知らせ）、今のページの様子を `setPage` で渡してから `openHome()` を呼びます。ホームの起動中に押されたボタンやページの知らせも、そのまま受けられるようにするためです
- `instances` の `key` は installedAppKey です。同じアプリのインスタンスは 1 つだけなので、ホームバーの名前のボタンは `open(key)` を呼びます
- `SystemOptions` は `BuildOptions` を継承し、`compiler` と `libraries` を受け取ります。`read` のアプリをビルドするときだけビルドの入口を dynamic import します。`prebuilt` だけなら asc を読みません
- 名前と形は案です。今の `ShellOptions` から、見た目の部分（`installed`）を除き、`ui` を足したものです
- 文字の表示や DOM は一切持ちません。`SystemUi` を差し替えれば、DOM なしでテストできます

## インストール

1. `prebuilt` の manifest、または `read("app.json")` を検査した manifest を使う
2. `installedAppKey(source, manifest.id)` で保存先を引く。同じ key は重ねない
3. `prebuilt` は版にかかわらず毎回保存し直す。保存済みの `installedAt` は保つ。compiler は呼ばない
4. `read` は同じ版が保存済みなら使い回す。無いか版が違うときだけ [ビルド](build.md) し、HTML・WASM・SVG・manifest・日時を保存する。アイコンのパスは `iconPath` で検査する

インストール・更新する対象と通常のアプリの一覧は `apps` で渡したものです。1 つの保存に失敗しても残りを扱い、`ui.report` に知らせます。システムアプリは `.binapp` を同梱し、ブラウザでは asc を読みません。

## 役割の割り当て（実装済み、形は案）

役割（`app.json` の `roles`）は名乗るだけでは効きません。割り当てを受けたアプリにだけ、その役割の API が届きます（[役割と API](../roles.md)）。

- `store.list()` も読み、今回保存したアプリと合わせて、`manifest.roles` にその役割を含むものを候補にする。入手元は問わない。設定（`settings`）の役割は、候補が入手元 `binette:system` のアプリだけ
- 割り当ては 3 段で選ぶ。(1) 設定 `roles[役割]`（installedAppKey）が候補にあればそれ、(2) `SystemOptions.roles[役割]`（ブートの既定。`system/boot.json` から読んだもの）が候補にあればそれ、(3) 入手元が `binette:system` の最初の候補。無ければホームは `ui.report` にエラーを出す。設定の役割は (1) を使わない（コアで差し替えられない）
- 設定を変えられるのは、設定アプリの `os.assign(役割, 候補の番号)` だけ。今変えられる役割は `home` だけで、その場で `roles.home` を保存し、前のホームを User・Os で Destroy する。設定アプリは開いたまま、以後のホームへ戻る動きは新しいホームを使い、`apps` も新しいホームだけに渡す。失敗の計時も消す。ホーム候補と履歴の名前の解決は `store.list()` 全件を含む
- 保存した割り当てのアプリが無い（削除された、名乗らなくなった）ときは、次の段に進む。保存した値は消さない

## 開く・戻る・閉じる

- `openHome()` でホームを開く（最初の 1 回も呼ぶ側が呼ぶ）。ホームには、`home` を名乗るアプリ以外を渡された順に `{ id, name, icon? }[]` として渡す。ホーム自身は一覧に入れない
- ホームの `AppsApi.open(i)` や `open(key)` で、そのアプリを前面に出す。元の前面は Pause にし、置き場とプロセスを残す（隠すのはシステム UI）。Pause なら Resume、Stop なら Start(Stop) → Resume。無ければインスタンスを作る
- 同じアプリの Destroy が終わる前に次のインスタンスを作らない。起動の途中で離れたら、未完成のインスタンスを残さない
- ホームも含め既定 3 インスタンスまで残す。超えたら前面以外で最後に前面に出た順に片付け、Stop → Destroy（System・Stack）を通す
- `openHome()` でホームへ戻る。ホームが残っていなければ起動する。`close(id)` は User・Os で Destroy し、前面を閉じたらホームへ戻る（ホームが落ち続けて Apps に切り替えたあとは Apps に戻る）
- finish は現在の呼び出しのあと Pause → Stop → Destroy（User・App）を知らせてホームに戻す。ホーム自身ならホームを起動し直す。Destroy の時間切れはエラーを出さない
- 起動中に離れた場合と `stop()` は AbortSignal で何も知らせずに止める。stop は全インスタンスを止め、2 回目から何もしない

## 落ちたとき

- 落ちたインスタンスは状態を知らせずにスタックから外し、`ui.report` にエラーを出す。前面ならホームへ戻り、背面なら前面を変えない
- ホーム自身が前面で落ちた場合と起動失敗では開き直す。開き直す前に 100ms 待ち、落ちるたびに倍にして 1000ms で頭打ちにする（数え直すと 100ms に戻る。案）
- 最初の落ちから homeRetryWindow を過ぎても落ち続けたら、前面を Apps にしてエラーを残す。落ちたホームが起動を済ませてから homeRetryWindow 以上動いていたら数え直す。起動の失敗（時間切れを含む）では数え直さない
- Apps に並べるのは、ホームに渡す一覧と同じアプリ（`home` を名乗るアプリ以外、設定を含む）。名前を `<`・`>` の文字コード順で比べる。Apps から開いたアプリが閉じたら Apps に戻る
- `openHome()` は、Apps のときも Apps から開いたアプリのときも、失敗の計時を消してホームを再試行する。起動できれば以後はホームへ戻り、落ち続ければ同じ時間を数えて Apps に戻る

## 権限

アプリは、プロセスの `grants` の辞書に載ったキーだけを使えます（[Réplique の API の辞書](../replique.md#api-の辞書実装済み形は案)）。システムは、アプリを起動するたびに次の表でキーごとに届けるかを決めます。届けないキーは `denied` に理由を書き、アプリの `api.why(key)` が返します。

| キー | 届く相手 | 届かないとき |
| --- | --- | --- |
| `apps`（アプリの一覧、アイコン、開く） | 役割 `home` か `shell` に割り当てられたアプリ。今はホームだけ（シェルは後で足す） | NotAssigned |
| `os`（OS の設定、役割の割り当て、起動の履歴、更新） | 役割 `settings` に割り当てられたアプリ（入手元が `binette:system`） | NotAssigned |
| `storage`（アプリごとのデータ） | すべてのアプリ。アプリのデータの読み込みに失敗したときと、ID が `system` のときだけ載せない | NotGranted |
| `fs`（ファイルの木） | 誰にも届かない。`app.json` の `permissions` に書くアプリに、ユーザーの許可を得て渡す流れは未決 | NotGranted |

- `os` には、設定・役割の割り当て・役割ごとの候補・新しい順の履歴・更新があるかを写して渡す。履歴の写しは、設定アプリ自身の起動記録を足す直前に作る
- 辞書に載っていないキーの呼び出しを、アプリが辞書を通さずに直接 import で呼んだときは、従来どおり例外でアプリを終了する（[run.md](run.md#辞書を通さない呼び出し実装済み)）。辞書の `get` が null を返すだけで終了しないのは、使えるかを調べる入口だからです
- システムは、`onSet`・`onAssign`・`onUpdate`・`onStorage` を、そのキーが載ったアプリからだけ受ける
- アプリごとの権限（`app.json` の `permissions`）の判断と、ユーザーに許可を聞く流れはまだありません。キーと役割の対応は `API_RULES` の表です

## 更新（実装済み）

`SystemOptions.update` を渡すと、設定アプリの `os.updateAvailable()` が true になり、`os.update()` で `update.apply()` を呼びます。渡す側（Binette の入口）は、新しい版があるときだけ、`/system` を入れ替えて再読み込みする処理を渡します。`apply()` の失敗は `ui.report` に出し、動いているアプリは止めません。

## OS の設定（案）

保存は `store.system` の SystemStore を使います（[store.md](store.md#systemstore案実装済み)）。

- 最初に getSettings() を読む。各項目は保存した値 → SystemOptions → DEFAULT_SYSTEM_SETTINGS の順で使う
- 時間の単位はミリ秒、stackSize は 1 以上の整数、historyLimit は 0 以上の整数。内部で使う時間は有限の 0 以上の数
- 保存は putSettings() でオブジェクト全体を置き換え、省いた項目は既定へ戻す
- os.set は数の 6 項目だけを許し、Worker とシステムで範囲を確かめる。システムは validateSystemSettings に加え、整数であることと callTimeout/destroyTimeout が 1000 以上であることを確かめる。その場で設定を変え、写したオブジェクトを順番に putSettings で保存する。保存の失敗は `ui.report` に出す
- 反映時点は [ライフサイクルの表](../lifecycle.md#値を変えたときに効く所案実装済み) のとおり。stopDelay は Process.setStopDelay で既存のインスタンスにも渡し、次の Pause から使う

## ページで起きたこと

ページの知らせ（visibilitychange・freeze・resume）を受けるのはシステム UI です。システム UI は、知らせが来るたびに `document.visibilityState` を確かめ、`{ visible, frozen }` を `setPage` でシステムに渡します。どう移すかはシステムが決めます。

- システムごとに crypto.randomUUID() で一つの識別子を作り、ホームを含む全アプリに同じ page を渡す。保存はしない
- 見えていて、しかも凍結していないときだけ、前面のアプリを Resume にする。hidden のときと凍結のときは Pause にする。blur・focus だけでは移さない
- freeze で全インスタンスの Stop までの計時を止め、resume で残りから続ける。状態の Pause・Resume は前面だけを対象にする
- 凍結が解けても見えていなければ Resume にしない（resume は前面に戻った知らせではないため）。Stop から戻るなら Start(Stop) → Resume。起動中にページが隠れた場合も、起動後に Pause にする
