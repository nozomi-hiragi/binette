# Régie: システム

[Régie の目次](README.md)

OS 全体の判断を持つ部分です。インストール、ホームの選び方、スタック、閉じる流れ、落ちたときの扱い、誰にどの呼び出しを渡すか（権限）、OS の設定、ページで起きたことの扱いを決めます。画面は持たず、何をどう見せるかは Scene の [システム UI](../scene/shell.md) に知らせるだけです。

今のコードでは、これらは Scene の `mountShell`（`packages/scene/src/shell.ts`）の中に、表示と混ざってあります。Régie へ移す予定です。「API」の節は案、ほかの節の動きは実装済み（形は案）で、移しても今のままにします。

## API（案）

```ts
type SystemApp = { source: string } & (
  | { read: (path: string) => Promise<string>; prebuilt?: never }
  | { prebuilt: PrebuiltApp; read?: never }
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
  /** エラーを見せる */
  report(error: unknown): void;
}
interface SystemView {
  /** スタック。並びはホームバーに出す順 */
  instances: { id: number; name: string; home: boolean; closing: boolean }[];
  /** 前面。"apps" は Apps の一覧 */
  front: number | "apps" | undefined;
  /** Apps に並べるアプリ（名前の順） */
  apps: { key: string; name: string }[];
}
interface BinetteSystem {
  openHome(): Promise<void>;
  open(key: string): Promise<void>;
  close(id: number): Promise<void>;
  /** ページの今の様子を知らせる。システム UI が visibilityState と freeze・resume から作る */
  setPage(page: { visible: boolean; frozen: boolean }): void;
  stop(): void;
}
function startSystem(options: SystemOptions): Promise<BinetteSystem>
```

- `read` を渡したアプリがあるときだけ、`@binette/regie/build` を dynamic import してビルドします。`prebuilt` だけなら asc を読みません
- 名前と形は案です。今の `ShellOptions` から、見た目の部分（`installed`）を除き、`ui` を足したものです
- 文字の表示や DOM は一切持ちません。`SystemUi` を差し替えれば、DOM なしでテストできます

## インストール

1. `prebuilt` の manifest、または `read("app.json")` を検査した manifest を使う
2. `installedAppKey(source, manifest.id)` で保存先を引く。同じ key は重ねない
3. `prebuilt` は版にかかわらず毎回保存し直す。保存済みの `installedAt` は保つ。compiler は呼ばない
4. `read` は同じ版が保存済みなら使い回す。無いか版が違うときだけ [ビルド](build.md) し、HTML・WASM・SVG・manifest・日時を保存する。アイコンのパスは `iconPath` で検査する

インストール・更新する対象と通常のアプリの一覧は `apps` で渡したものです。1 つの保存に失敗しても残りを扱い、`ui.report` に知らせます。システムアプリは `.binapp` を同梱し、ブラウザでは asc を読みません。

## ホームの選び方

- `store.list()` も読み、今回保存したアプリと合わせて `manifest.role === "home"` をホーム候補にする。入手元は問わない
- 設定の `home`（installedAppKey）に合うものを開き、空・無効なら入手元が `binette:system` の最初のホームを開く。無ければ `ui.report` にエラーを出す
- ホーム候補と履歴の名前の解決は `store.list()` 全件を含む
- 設定アプリの os.setHome で選ぶと home をその場で保存し、前のホームを User・Os で Destroy する。設定アプリは開いたまま、以後のホームへ戻る動きは新しいホームを使い、apps.* も新しいホームだけに渡す。失敗の計時も消す

## 開く・戻る・閉じる

- 起動したらホームを開く。ホームには、ホーム候補以外のアプリを渡された順に `{ id, name, icon? }[]` として渡す。ホーム自身は一覧に入れない
- ホームの `apps.open(i)` や `open(key)` で、そのアプリを前面に出す。元の前面は Pause にし、置き場とプロセスを残す（隠すのはシステム UI）。Pause なら Resume、Stop なら Start(Stop) → Resume。無ければインスタンスを作る
- 同じアプリの Destroy が終わる前に次のインスタンスを作らない。起動の途中で離れたら、未完成のインスタンスを残さない
- ホームも含め既定 3 インスタンスまで残す。超えたら前面以外で最後に前面に出た順に片付け、Stop → Destroy（System・Stack）を通す
- `openHome()` でホームへ戻る。ホームが残っていなければ起動する。`close(id)` は User・Os で Destroy し、前面を閉じたらホームへ戻る（ホームが落ち続けて Apps に切り替えたあとは Apps に戻る）
- finish は現在の呼び出しのあと Pause → Stop → Destroy（User・App）を知らせてホームに戻す。ホーム自身ならホームを起動し直す。Destroy の時間切れはエラーを出さない
- 起動中に離れた場合と `stop()` は AbortSignal で何も知らせずに止める。stop は全インスタンスを止め、2 回目から何もしない

## 落ちたとき

- 落ちたインスタンスは状態を知らせずにスタックから外し、`ui.report` にエラーを出す。前面ならホームへ戻り、背面なら前面を変えない
- ホーム自身が前面で落ちた場合と起動失敗では開き直す。開き直す前に 100ms 待ち、落ちるたびに倍にして 1000ms で頭打ちにする（数え直すと 100ms に戻る。案）
- 最初の落ちから homeRetryWindow を過ぎても落ち続けたら、前面を Apps にしてエラーを残す。落ちたホームが起動を済ませてから homeRetryWindow 以上動いていたら数え直す。起動の失敗（時間切れを含む）では数え直さない
- Apps に並べるのは、ホームに渡す一覧と同じアプリ（role home の候補以外、設定を含む）。名前を `<`・`>` の文字コード順で比べる。Apps から開いたアプリが閉じたら Apps に戻る
- `openHome()` は、Apps のときも Apps から開いたアプリのときも、失敗の計時を消してホームを再試行する。起動できれば以後はホームへ戻り、落ち続ければ同じ時間を数えて Apps に戻る

## 権限

アプリは、プロセスの `grants` で渡された呼び出しだけを使えます。渡していない呼び出しは、アプリを終了する例外になります（[run.md](run.md)）。

| 呼び出し | 渡す相手 |
| --- | --- |
| `apps.*`（アプリの一覧、アイコン、開く） | 今のホームだけ |
| `os.*`（OS の設定、ホームの候補、起動の履歴） | 入手元が `binette:system` で role が `settings` のアプリだけ |

- `os` には、設定・ホーム候補・新しい順の履歴を写して渡す。履歴の写しは、設定アプリ自身の起動記録を足す直前に作る
- アプリごとの権限（`app.json` の `permissions`）の判断はまだありません

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
- hidden なら前面のアプリを Pause にし、visible なら Resume にする。blur・focus だけでは移さない
- freeze で全インスタンスの Stop までの計時を止め、resume で残りから続ける。状態の Pause・Resume は前面だけを対象にする
- 凍結が解けても見えていなければ Resume にしない（resume は前面に戻った知らせではないため）。Stop から戻るなら Start(Stop) → Resume。起動中にページが隠れた場合も、起動後に Pause にする
