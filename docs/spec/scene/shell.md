# Scene: アプリを開く枠

[Scene の目次](README.md)

ホームは Binette のシステムアプリ `apps/home` です（決定）。タイルの並びと見た目はホームの HTML ＋ AS が持ちます。OS は `mountShell` でアプリを開く枠と「戻る」の帯を持ちます。以下は実装済み（形は案）です。

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
}
interface MountedShell { stop(): void; }
function mountShell(element: HTMLElement, options: ShellOptions): Promise<MountedShell>
```

`apps` は渡された順に扱います。入手元 `source` は配信 URL と分けた変わらない名前です。システムアプリは `binette:system` を使います。`compiler`・`libraries`・`parser` は `buildApp` に渡します。parser を省略すると `element.ownerDocument` の文書で読みます。DOM は element から辿り、グローバルの document は使いません。

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
- ホームの `apps.open(i)` でホームを止めて隠し、そのアプリを開く。上に OS の「戻る」の帯を出す
- 戻るとアプリを止めて消し、ホームを開き直す。`start()` が再び走り、一覧を作り直す。一度に動くのは 1 つだけ
- 起動中の戻る・停止は AbortSignal で止める。`stop()` はイベントと画面も消し、2 回目からは何もしない

ホームの差し替え、権限の仕組み、アプリの CSS の分離は未決です。今は入手元と role だけでホームを判断します。URL からの追加、更新や削除の操作、並べ替え、複数アプリの同時実行はまだありません。

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

ホームのタイルには `--bina-home-background`・`--bina-home-color`・`--bina-home-padding`・`--bina-home-tile-size`・`--bina-home-gap`・`--bina-home-border`・`--bina-home-surface`・`--bina-home-radius`・`--bina-home-button-padding`・`--bina-home-icon-size`・`--bina-home-focus` を使います。アイコンの既定の大きさは 56px です。クラス名は `home-` で始めます。
