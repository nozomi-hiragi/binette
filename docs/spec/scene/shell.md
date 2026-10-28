# Scene: システム UI の大枠

[Scene の目次](README.md)

ホームバー、Apps の一覧、エラー表示、ライブモード、アプリの置き場を並べる大枠です。何を前面にするか、何を並べるか、いつ閉じるかは Régie のシステムが決めます（[regie/system.md](../regie/system.md)）。大枠はそれを見せ、押されたボタンとページの知らせを Régie に渡すだけです。

ホームは Binette のシステムアプリ `apps/home` です（決定。[apps/home.md](../apps/home.md)）。タイルの並びと見た目はホームの HTML ＋ AS が持ち、置き場の 1 つに入ります。

今のコードの `packages/scene/src/shell.ts` は、ここに書いた表示を受け持ちます。判断は Régie の `startSystem` にあります。「API」の節は案、ほかの節の見た目と動きは実装済み（形は案）です。

## API（案）

```ts
interface ShellUiOptions {
  /** 指定時は表示モードの判定を上書きする */
  installed?: boolean;
  onError?: (error: unknown) => void;
}
interface ShellUi extends SystemUi {
  /** ボタンとページの知らせを Régie のシステムにつなぎ、今のページの様子を setPage で一度渡す。bind の前に押されたボタンは何もしない */
  bind(system: BinetteSystem): void;
  /** インストール済みなら true。ライブモードなら理由と手順を表示して false */
  requireInstall(reason: string): boolean;
  /** 画面とイベントを消す */
  stop(): void;
}
function createShellUi(element: HTMLElement, options?: ShellUiOptions): ShellUi

/** createShellUi と Régie の startSystem をまとめて呼ぶ。ルートの OS はこれを使う */
interface ShellOptions extends Omit<SystemOptions, "ui">, BuildOptions, ShellUiOptions {}
interface MountedShell {
  requireInstall(reason: string): boolean;
  /** システムを止め、画面とイベントを消す */
  stop(): void;
}
function mountShell(element: HTMLElement, options: ShellOptions): Promise<MountedShell>
function isInstalled(window: Window | null): boolean
```

- `mountShell` は `createShellUi` → `startSystem({ ...options, ui })` → `ui.bind(system)` → `system.openHome()` の順に呼びます。startSystem はホームを開く前に解決するので、ホームの起動中のボタンとページの知らせも Régie に届きます（[regie/system.md](../regie/system.md#api案)）
- ビルドを Régie に移すまでは、`BuildOptions` は Scene の `ShellOptions` にあり、`mountShell` はそれを使って `buildApp` を `startSystem` に渡します
- 途中で失敗したら大枠を止め、渡した要素の中身を元に戻してから reject します
- `mountShell` の使い方は今と同じです。ルートの `src/main.ts` は変わりません
- DOM は element から辿り、グローバルの document は使いません

## SystemUi の受け持ち

| Régie から | 大枠がすること |
| --- | --- |
| `present(instance, process)` | 置き場の要素（`.bina-shell-app`、ホーム以外は `.bina-shell-content` も）を作り、エラー表示の前に入れ、[mountApp](mount.md) で描く。`remove()` で mountApp を止めて要素を消す |
| `update(view)` | 前面の置き場だけを見せ、ほかは hidden にする。`front` が `"apps"` なら Apps の一覧を見せる。ホームバーを描き直し、`clearError` が true のときだけエラー表示を隠す |
| `report(error)` | エラー表示に文を出し、`onError` に知らせる。同じオブジェクトは一度だけ知らせ、文字列などは呼ばれるたびに知らせる |

## ホームバー（案・実装済み）

- 「ホーム」と、スタックのホーム以外のインスタンスの名前と「×」を並べる。閉じている途中のものは出さない
- 名前のボタンは `aria-pressed` で前面かを示す。aria-label は「名前を開く」「名前を閉じる」「ホームを開く」。バー自体は「ホームバー」
- 押されたら Régie の `openHome()`・`open(key)`（`SystemView.instances` の key）・`close(id)` を呼ぶだけ
- ホームバーはホームと Apps でも表示する。ライブモードなら右端に「インストール」を出す
- バーの操作と見た目は案（[lifecycle.md](../lifecycle.md#ホームバー案実装済み)）

## Apps の一覧（案・実装済み）

ホームが落ち続けたときの最後の受け皿です。並べるアプリと出すときは Régie が決め（[regie/system.md](../regie/system.md#落ちたとき)）、大枠はアプリの置き場と同じ並びの専用要素 `.bina-shell-apps` に DOM を直接描きます。Worker を作らず、スタックにもホームバーの一覧にも数えません。

見出しや飾りは付けず、縦に並べたリンクの見た目の button だけを表示します。type は button、名前は textContent、aria-label は「名前を開く」です。押されたら `open(key)` を呼びます。

見た目は `:where(.bina-shell-apps…)` の CSS と既存の `--bina-shell-*` 変数（gap・padding・background・color・focus）で決めます。ホームや設定のクラスを使わず、アプリの置き場の中にも置きません。stop は Apps も消します。

## ページの知らせ

visibilitychange・freeze・resume を受け、そのたびに `document.visibilityState` を確かめて `system.setPage({ visible, frozen })` を呼びます。どう移すかは Régie が決めます（[regie/system.md](../regie/system.md#ページで起きたこと)）。stop で監視をやめます。

## ライブモード（案・実装済み）

`isInstalled(window)` は display-mode が standalone・minimal-ui・window-controls-overlay のどれか、または navigator.standalone が true のとき true を返します。fullscreen だけでは false です。matchMedia が無い・使えないときも落ちません。大枠は element.ownerDocument.defaultView で判定し、display-mode の change と appinstalled で表示を切り替えます。ShellUiOptions.installed が指定されていればその値を使い、matchMedia は見ません。

ライブモードでは `.bina-shell-stage`（ホームバーより上の表示領域）の右下に「ライブモード」の透かしを出します。`.bina-shell-live` はアプリの枠の外に置き、最上層・pointer-events: none・aria-hidden: true にします。safe area を取り、ホームバーには重なりません。ホームバーの右端には `.bina-shell-install` の「インストール」を出し、aria-label でライブモードも伝えます。

beforeinstallprompt を受け取ったら preventDefault して保持し、ボタンで一度だけ prompt を呼びます。無い場合や失敗した場合は `.bina-shell-install-dialog` の dialog に手順と「閉じる」を出します。iPhone・iPad などは「Safari の共有 → ホーム画面に追加」、ほかはブラウザのメニューからの追加を案内します。showModal / close の無い DOM では open 属性で代用します。閉じたことは保存しません。インストール済みになれば透かし・ボタン・手順を隠します。

`MountedShell.requireInstall(reason)` は OS のための関数です。インストール済みなら何も表示せず true、ライブモードなら同じ dialog に理由と手順を出して false を返します。理由は textContent で入れます。Réplique・Régie の API には足さず、アプリには渡しません。stop は表示とイベントの監視を消します。保存などをライブ専用に扱う処理はしません。

マニフェストと Service Worker はルートの OS が持ち、Scene は登録しません。キャッシュと本番だけの登録は [lifecycle.md](../lifecycle.md#service-worker決定) のとおりです。

## CSS 変数

ホームバー・枠・Apps・ライブモードの変数は `--bina-shell-*` です。ホームの変数は `apps/home/src/index.html` が持ち、フロントから上書きできます。

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
| `--bina-shell-live-color` | `var(--bina-shell-color, #16181d)` | 透かしの文字 |
| `--bina-shell-live-opacity` | `0.35` | 透かしの薄さ |
| `--bina-shell-live-size` | `0.875em` | 透かしの文字の大きさ |

ホームのタイルの変数（`--bina-home-*`）は [apps/home.md](../apps/home.md#見た目) にあります。
