# Scene: ホーム

[Scene の目次](README.md)

## mountHome（実装済み）

ホームは Binette が持ちます（決定）。最初から渡したアプリを並べ、1 つずつ開いて戻れます。

```ts
interface HomeApp {
  source: string;
  read: (path: string) => Promise<string>;
}
interface HomeOptions extends BuildOptions {
  apps: HomeApp[];
  store: AppStore;
  onError?: (error: unknown) => void;
  createWorker?: MountOptions["createWorker"];
}
interface MountedHome {
  stop(): void;
}
function mountHome(element: HTMLElement, options: HomeOptions): Promise<MountedHome>
```

- `apps` は表示する順の配列。`source` は入手元を区別する文字列。`read` は `buildApp` と同じく、`app.json` からの相対パスを読む
- `compiler`・`libraries`・`parser` は `buildApp` に渡す。parser を省略すると、`element.ownerDocument` から作った文書で HTML を読む。グローバルの `document` は使わない
- `createWorker` と `onError` はアプリの起動にも使う

### 保存と描画

1. 各アプリの `app.json` を読んで検査する
2. `installedAppKey(source, manifest.id)` で保存先を引く。同じ `manifest.version` なら保存済みの結果を使う（版が両方無い場合も同じとみなす）
3. 無いか版が違う場合だけ `buildApp` する。`icon` があれば SVG を読み、HTML・WASM・manifest・日時と一緒に `store.put` する
4. アイコンと名前のボタンを、渡された順に並べる。同じ key は重ねて並べない

一覧は `store.list()` の全件ではなく、`apps` で渡されたものだけです。保存済みなら AS・HTML・SVG を読み直さず、compiler も呼びません。入手元の `app.json` は毎回読みます。1 つ失敗しても残りを並べ、エラーを状態表示と `onError` で知らせます。

SVG は `data:image/svg+xml;charset=utf-8,` に `encodeURIComponent` した文字列を続け、`img.src` に入れます。SVG を `innerHTML` に入れません。名前は `textContent` に入れます。

### 開く・戻る・停止

- 押すと一覧を隠し、上に「戻る」、その下の残りの領域に `mountApp` でアプリを描く。bindings は保存した HTML から読み直す
- 一度に開くのは 1 つだけ。起動中の連打も受け付けない
- 戻るとアプリを停止し、HTML とアプリの領域を消して一覧を出す。押したアプリのボタンにフォーカスを戻す
- 起動中の戻る・停止は AbortSignal で Worker を止める。起動の失敗時もホームに戻して知らせる
- `stop()` はアプリを止め、ホームのイベントと描いた内容を消す。2 回目からは何もしない

### CSS 変数

ホームに入れる style は `var(変数, 既定値)` を使います。フロントは表示先やその親で変数を指定して上書きできます。

| 名前 | 既定値 | 用途 |
| --- | --- | --- |
| `--bina-home-background` | `#f3f5f8` | ホームの背景 |
| `--bina-home-color` | `#16181d` | 文字色 |
| `--bina-home-padding` | `16px` | ホームの内側の余白 |
| `--bina-home-tile-size` | `112px` | 一覧の列の最小幅 |
| `--bina-home-gap` | `16px` | 一覧・アイコンと名前・アプリ領域の間隔 |
| `--bina-home-border` | `#d5dae1` | ボタンの枠線の色 |
| `--bina-home-surface` | `#ffffff` | ボタンとアプリ領域の背景 |
| `--bina-home-radius` | `12px` | ボタンの角丸 |
| `--bina-home-button-padding` | `12px` | ボタンの内側の余白 |
| `--bina-home-icon-size` | `56px` | アイコンの幅と高さ |
| `--bina-home-focus` | `#3273b9` | フォーカスの枠の色 |
| `--bina-home-error` | `#b3261e` | エラーの文字色 |

URL からの追加、更新や削除の操作、並べ替え、権限の画面、ルーティング、設定画面、複数アプリの同時実行はまだありません。
