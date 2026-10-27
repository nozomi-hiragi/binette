# Scene: アプリを開く枠

[Scene の目次](README.md)

ホームは Binette のシステムアプリ `apps/home` です（決定。[apps/home.md](../apps/home.md)）。タイルの並びと見た目はホームの HTML ＋ AS が持ちます。OS は `mountShell` でアプリを開く枠と「戻る」の帯を持ちます。以下は実装済み（形は案）です。

```ts
type ShellApp = { source: string } & (
  | { read: (path: string) => Promise<string>; prebuilt?: never }
  | { prebuilt: PrebuiltApp; read?: never }
);
interface ShellOptions extends BuildOptions {
  apps: ShellApp[];
  store: AppStore;
  onError?: (error: unknown) => void;
  createWorker?: MountOptions["createWorker"];
  callTimeout?: number; // ミリ秒、既定 5000
  stopDelay?: number; // ミリ秒、既定 10000
  destroyTimeout?: number; // ミリ秒、既定 5000
  homeRetryWindow?: number; // ミリ秒、既定 5000
}
interface MountedShell { stop(): void; }
function mountShell(element: HTMLElement, options: ShellOptions): Promise<MountedShell>
```

`apps` は渡された順に扱います。入手元 `source` は配信 URL と分けた変わらない名前です。システムアプリは `binette:system` を使います。`compiler`・`libraries` は `buildApp` に渡します。parser は HTML の解析が不要になったため無くしました（案・実装済み）。DOM は element から辿り、グローバルの document は使いません。

## 保存とホームの選び方

1. `prebuilt` の manifest、または `read("app.json")` を検査した manifest を使う
2. `installedAppKey(source, manifest.id)` で保存先を引く。同じ key は重ねない
3. `prebuilt` は版にかかわらず毎回保存し直す。保存済みの `installedAt` は保つ。compiler は呼ばない
4. `read` は同じ版が保存済みなら使い回す。無いか版が違うときだけビルドし、HTML・WASM・SVG・manifest・日時を保存する。アイコンのパスは `iconPath` で検査する（[build.md](build.md)）
5. 保存できたアプリのうち、入手元が `binette:system` で `manifest.role === "home"` の最初のものをホームとして開く。無ければ画面と `onError` にエラーを出す

対象は `store.list()` 全件ではなく、`apps` で渡したものです。1 つの保存に失敗しても残りを扱い、画面と `onError` に知らせます。システムアプリは `.binapp` を同梱し、ブラウザでは asc を読みません。

## 開く・戻る・停止

- ホームを領域いっぱいに開く。ホーム候補（`binette:system` かつ `role: "home"`）以外のアプリを渡された順に `{ id, name, icon? }[]` として渡す。ホーム自身は一覧に入れない
- ホームだけに一覧を渡す。ほかのアプリでは `apps.*` は例外になる（[regie.md](../regie.md)）
- ホームの `apps.open(i)` でホームに Pause → Stop → Destroy（System・Stack）を知らせ、そのアプリを開く。上に OS の「戻る」の帯を出す
- 戻ると Pause → Stop → Destroy（System・Stack）を続けて呼び、アプリを消してホームを開き直す。onCreate で一覧を作り直す。一度に動くのは 1 つだけ。スタックができるまでの仮の扱い
- 開いているアプリの `onExit` では、そのアプリを片付けてホームを開き直し、状態表示と onError にエラーを出します。ホーム自身の終了や起動失敗もホームを開き直します。起動失敗の再試行は次のタスクに回し、stop で取り消せます。ホームが落ち続け、最初の落ちから `homeRetryWindow`（既定 5 秒）を過ぎてもまた落ちたら、開き直すのをやめてエラーを出したままにします。前のホームが `homeRetryWindow` より長く動いていたら、落ち続けてはいないものとして数え直します。Apps はまだ無く、④ でここに出します。すでに別のアプリへ移っていたら何もしません
- 起動中の戻る・停止は AbortSignal で止める。`stop()` はイベントと画面も消し、2 回目からは何もしない

ホームの差し替え、権限の仕組み、アプリの CSS の分離は未決です。今は入手元と role だけでホームを判断します。URL からの追加、更新や削除の操作、並べ替え、複数アプリの同時実行はまだありません。

## ページとライフサイクル（実装済み）

mountShell ごとに crypto.randomUUID() で一つの識別子を作り、ホームを含む全アプリに同じ page を渡します。保存はしません。

visibilitychange で hidden なら前面のアプリを Pause にし、visible なら Resume にします。blur・focus だけでは移しません。freeze で Stop までの計時を止め、resume で残りから続けます。resume イベントは visibilityState が visible のときだけ前面のアプリを Resume にします。Stop から戻るなら Start(Stop) → Resume です。起動中にページが隠れた場合も、起動後に Pause にします。

finish は現在の呼び出しのあと Pause → Stop → Destroy（User・App）を知らせてホームに戻します。ホーム自身ならホームを起動し直します。Destroy の時間切れはエラーを出しません。stop と起動中のキャンセルは何も知らせずに止めます。

## CSS 変数

帯と枠の変数は `--bina-shell-*` です。ホームの変数は `apps/home/src/index.html` が持ち、フロントから上書きできます。

| 名前 | 既定値 | 用途 |
| --- | --- | --- |
| `--bina-shell-padding` | `12px` | 帯の余白 |
| `--bina-shell-background` | `#f3f5f8` | 帯の背景 |
| `--bina-shell-color` | `#16181d` | 帯の文字 |
| `--bina-shell-border` | `#d5dae1` | 戻るボタンの枠 |
| `--bina-shell-surface` | `#fff` | 戻るボタンの背景 |
| `--bina-shell-radius` | `12px` | ボタンの角丸 |
| `--bina-shell-button-padding` | `12px` | ボタンの余白 |
| `--bina-shell-focus` | `#3273b9` | フォーカスの枠 |
| `--bina-shell-error` | `#b3261e` | 状態表示の文字 |

ホームのタイルの変数（`--bina-home-*`）は [apps/home.md](../apps/home.md#見た目) にあります。
