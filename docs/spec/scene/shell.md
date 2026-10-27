# Scene: アプリを開く枠

[Scene の目次](README.md)

ホームは Binette のシステムアプリ `apps/home` です（決定。[apps/home.md](../apps/home.md)）。タイルの並びと見た目はホームの HTML ＋ AS が持ちます。OS は `mountShell` でアプリを開く枠とホームバーを持ちます。以下は実装済み（形は案）です。

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
  stackSize?: number; // ホームを含む、既定 3
  historyLimit?: number; // 既定 100
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
- ホームの `apps.open(i)` やホームバーの名前のボタンで、そのアプリを前面に出す。元の画面は hidden にして Pause にし、DOM と Worker を残す。Pause なら Resume、Stop なら Start(Stop) → Resume。無ければインスタンスを作る
- ホームも含め既定 3 インスタンスまで残す。超えたら前面以外で最後に前面に出た順に片付け、Stop → Destroy（System・Stack）を通す
- ホームボタンでホームへ戻る。ホームが残っていなければ起動する。ホームバーはホームでも表示する。名前の隣の「×」は User・Os で Destroy し、前面を閉じたらホームへ戻る。バーの操作と見た目は案（[lifecycle.md](../lifecycle.md#ホームバー案実装済み)）
- 落ちたインスタンスは状態を知らせずにスタックから外し、状態表示と onError にエラーを出す。前面ならホームへ戻り、背面なら画面を変えない。ホーム自身が前面で落ちた場合と起動失敗では開き直す。最初の落ちから homeRetryWindow を過ぎても落ち続けたら開き直さず、エラーを残す。落ちたホームが起動を済ませてから homeRetryWindow より長く動いていたら数え直す。起動の失敗（時間切れを含む）では数え直さない。Apps は④
- 起動中に離れた場合と `stop()` は AbortSignal で何も知らせずに止める。stop は全インスタンス・イベント・画面を消し、2 回目から何もしない

ホームの差し替え、権限の仕組み、アプリの CSS の分離は後続の作業です。今は入手元と role だけでホームを判断します。URL からの追加、更新や削除の操作、並べ替えはまだありません。

## OS の記録と設定（案・実装済み）

`store.system` の SystemStore を使います。最後の状態と起動の履歴のキーは installedAppKey です。各状態のメソッドの前後に記録し、前回の値を次の onCreate に渡します。履歴はインスタンスを作るときだけ追加します。

mountShell の最初に getSettings() を読みます。各項目は保存した値 → ShellOptions → DEFAULT_SYSTEM_SETTINGS の順で使います。時間の単位はミリ秒、stackSize は 1 以上の整数、historyLimit は 0 以上の整数です。時間は有限の 0 以上の数です。保存は putSettings() でオブジェクト全体を置き換え、省いた項目は既定へ戻します。変更は次の mountShell から使います。home は今回保存だけで、ホームを選ぶ処理にはまだ使いません。

## ページとライフサイクル（実装済み）

mountShell ごとに crypto.randomUUID() で一つの識別子を作り、ホームを含む全アプリに同じ page を渡します。保存はしません。

visibilitychange で hidden なら前面のアプリを Pause にし、visible なら Resume にします。blur・focus だけでは移しません。freeze で全インスタンスの Stop までの計時を止め、resume で残りから続けます。状態の Pause・Resume は前面だけを対象にします。resume イベントは visibilityState が visible のときだけ前面のアプリを Resume にします。Stop から戻るなら Start(Stop) → Resume です。起動中にページが隠れた場合も、起動後に Pause にします。

finish は現在の呼び出しのあと Pause → Stop → Destroy（User・App）を知らせてホームに戻します。ホーム自身ならホームを起動し直します。Destroy の時間切れはエラーを出しません。stop と起動中のキャンセルは何も知らせずに止めます。

## CSS 変数

ホームバーと枠の変数は `--bina-shell-*` です。ホームの変数は `apps/home/src/index.html` が持ち、フロントから上書きできます。

| 名前 | 既定値 | 用途 |
| --- | --- | --- |
| `--bina-shell-gap` | `8px` | ボタンの間隔 |
| `--bina-shell-padding` | `12px` | ホームバーの余白 |
| `--bina-shell-background` | `#f3f5f8` | ホームバーの背景 |
| `--bina-shell-color` | `#16181d` | ホームバーの文字 |
| `--bina-shell-border` | `#d5dae1` | ボタンの枠 |
| `--bina-shell-surface` | `#fff` | ボタンの背景 |
| `--bina-shell-radius` | `12px` | ボタンの角丸 |
| `--bina-shell-button-padding` | `12px` | ボタンの余白 |
| `--bina-shell-focus` | `#3273b9` | フォーカスの枠 |
| `--bina-shell-error` | `#b3261e` | 状態表示の文字 |

ホームのタイルの変数（`--bina-home-*`）は [apps/home.md](../apps/home.md#見た目) にあります。
