# Scene: システム UI の大枠

[Scene の目次](README.md)

Scene は、常駐 Cadre の表示先、Apps、エラー表示、ライブモードと、Cadre が落ち続けたときの最低限の大枠を持ちます。ホーム・ドック・時計の枠はシステムアプリ [apps/cadre](../apps/cadre.md) が AS の Décor で描きます。何を前面にするか、いつ閉じるか、Cadre を起動し直すかは Régie が決めます。

Cadre は `appArea()` でアプリの表示先を宣言し、Scene がその中へホームとほかのアプリを配置します。以下は実装済みですが、API と見た目の形は案です。

## API（案）

```ts
interface ShellUiOptions {
  /** 指定時は表示モードの判定を上書きする */
  installed?: boolean;
  onError?: (error: unknown) => void;
  /** フルスクリーンで呼び出した枠を戻す時計。テストで差し替える */
  revealTimers?: { setTimeout(callback: () => void, delay: number): number; clearTimeout(id: number): void };
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
interface ShellOptions extends Omit<SystemOptions, "ui">, ShellUiOptions {}
interface MountedShell {
  requireInstall(reason: string): boolean;
  /** システムを止め、画面とイベントを消す */
  stop(): void;
}
function mountShell(element: HTMLElement, options: ShellOptions): Promise<MountedShell>
function isInstalled(window: Window | null): boolean
```

- `mountShell` は `createShellUi` → `startSystem({ ...options, ui })` → `ui.bind(system)` の順に呼びます。Régie が Cadre を起動し、Cadre 自身がホームを呼びます。Cadre が無い場合は最低限の大枠でホームを開きます。
- `ShellOptions` は `SystemOptions` を通してビルドの設定を受け取り、`mountShell` はそのまま `startSystem` に渡します
- 途中で失敗したら大枠を止め、渡した要素の中身を元に戻してから reject します
- `mountShell` の使い方は今と同じです。ルートの `src/main.ts` は変わりません
- DOM は element から辿り、グローバルの document は使いません

## SystemUi の受け持ち

| Régie から | 大枠がすること |
| --- | --- |
| `present(instance, process)` | Cadre なら `.bina-shell-host` に描く。それ以外は置き場の要素（`.bina-shell-app`、ホーム以外は `.bina-shell-content` も）を作り、Cadre の `appArea()` に入れ、[mountApp](mount.md) で描く。`remove()` で mountApp を止めて要素を消す |
| `update(view)` | 前面の置き場だけを見せ、ほかは hidden にする。`front` が `"apps"` なら Apps の一覧を見せる。`cadreUnavailable` なら最低限の大枠へアプリの置き場を移し、`clearError` が true のときだけエラー表示を隠す |
| `report(error)` | エラー表示に文を出し、`onError` に知らせる。同じオブジェクトは一度だけ知らせ、文字列などは呼ばれるたびに知らせる |

## セーフエリアとフルスクリーン（決定・実装済み）

アプリの表示領域は画面全体です。Cadre は OS の枠を Décor の `.reserve(slot)` で宣言するだけで、測る・退ける・呼び出すのは Scene（メインスレッド）が受け持ちます。AS の側にタイマーが無いためです。

- Scene は Cadre の表示先の中（アプリの表示領域の外）の `[data-bina-reserve]` を ResizeObserver で測り、Cadre の DOM が変わったときと画面の大きさが変わったときにも測り直します
- 各辺のセーフエリアは、その辺の枠のうち表示領域にいちばん深く入るもの＋すき間（8px）です。角の枠と上下中央（`tl`・`tc`・`tr`・`bl`・`bc`・`br`）は上か下の辺にだけ数え、`ml`・`mr` だけが左右に効きます。大きさが 0 の枠（`display: none`）は数えません。端末の `env(safe-area-inset-*)` は見えない箱の padding で読み、各辺はそれを下回りません。値は px に切り上げます
- 値は各アプリの表示先（`.bina-shell-app` と Apps の一覧）に CSS の変数 `--bina-safe-top`・`--bina-safe-right`・`--bina-safe-bottom`・`--bina-safe-left` で置き、変わったときだけ `system.setSafeArea` で Régie に渡します（宣言 UI の `safeArea()` になる）
- `SystemView.fullscreen` が真なら、ルートに `bina-shell-fullscreen` を付けます。枠は CSS の `translate` で画面の外へすべります（上の 3 つは上、下の 3 つは下、`ml` は左、`mr` は右）。そのあいだのセーフエリアは端末の分だけです。Cadre が落ちて最低限の大枠を出しているときは退けません
- フルスクリーンのあいだ、4 辺に幅 8px の帯（`.bina-shell-edge`）を出します。帯を押す（クリック、または辺から内側へのスワイプの始まり）と、その辺の置き場のうち触った位置にいちばん近い枠だけに `data-bina-revealed` を付けて戻します。上の辺の左寄りなら `tl`、左右の辺は `ml`・`mr` です。3 秒で退け直し、ポインタが枠の上にある・触っているあいだは待ちます。離れてから 3 秒です。前面がフルスクリーンを求めないアプリに替われば、元どおり常に出します
- 動きを減らす設定では、すべらせるアニメーションを止めます

## Cadre の枠と最低限の大枠（案・実装済み）

通常の枠は [apps/cadre.md](../apps/cadre.md) のとおりです。Scene は枠の宣言の木を組まず、Cadre の CSS を表示先に限定して適用します。

Cadre が無い、または落ち続けると、`.bina-shell-fallback` にアプリの表示領域と「ホーム」ボタンを出します。ボタンは `system.openHome()` を呼びます。既存のアプリの DOM は作り直さず、表示先を移します。Cadre の再起動中と復帰後も、前面の判定は Régie が持ちます。

## Apps の一覧（案・実装済み）

ホームが落ち続けたときの最後の受け皿です。並べるアプリと出すときは Régie が決め（[regie/system.md](../regie/system.md#落ちたとき)）、大枠はアプリの置き場と同じ並びの専用要素 `.bina-shell-apps` に DOM を直接描きます。Worker を作らず、スタックにもドックにも数えません。

見出しや飾りは付けず、縦に並べたリンクの見た目の button だけを表示します。type は button、名前は textContent、aria-label は「名前を開く」です。押されたら `open(key)` を呼びます。

見た目は `:where(.bina-shell-apps…)` の CSS と既存の `--bina-shell-*` 変数（gap・padding・background・color・focus）で決めます。ホームや設定のクラスは使わず、Cadre または最低限の大枠のアプリ表示領域に配置します。stop は Apps も消します。

## ページの知らせ

visibilitychange・freeze・resume を受け、そのたびに `document.visibilityState` を確かめて `system.setPage({ visible, frozen })` を呼びます。どう移すかは Régie が決めます（[regie/system.md](../regie/system.md#ページで起きたこと)）。stop で監視をやめます。

## ライブモード（案・実装済み）

`isInstalled(window)` は display-mode が standalone・minimal-ui・window-controls-overlay のどれか、または navigator.standalone が true のとき true を返します。fullscreen だけでは false です。matchMedia が無い・使えないときも落ちません。大枠は element.ownerDocument.defaultView で判定し、display-mode の change と appinstalled で表示を切り替えます。ShellUiOptions.installed が指定されていればその値を使い、matchMedia は見ません。

ライブモードでは、Scene のルートの右下に「ライブモード」の透かしを出します。`.bina-shell-live` はアプリの枠の外に置き、最上層・pointer-events: none・aria-hidden: true にし、safe area を取ります。Cadre のバーとの位置調整、透かしの位置の細部は案です。Cadre のインストールボタンから Scene の案内を開きます。

beforeinstallprompt の保持と prompt、手順の dialog は Scene のライブモード処理に残します。`requireInstall` から開く手順には「閉じる」を用意し、閉じたことは保存しません。

`MountedShell.requireInstall(reason)` は OS のための関数です。インストール済みなら何も表示せず true、ライブモードなら同じ dialog に理由と手順を出して false を返します。理由は textContent で入れます。Réplique・Régie の API には足さず、アプリには渡しません。stop は表示とイベントの監視を消します。保存などをライブ専用に扱う処理はしません。

マニフェストと Service Worker はルートの OS が持ち、Scene は登録しません。キャッシュと本番だけの登録は [lifecycle.md](../lifecycle.md#service-worker決定) のとおりです。

## CSS 変数

最低限の大枠・Apps・エラー・ライブモードは `--bina-shell-*`（padding・gap・background・color・border・surface・focus・error・radius・homebar-padding-block・live-color・live-opacity・live-size）を使います。通常のバーは Cadre の Décor の宣言と `--bina-ui-*` の役割の色で描きます。古い TS ドックの `--bina-shell-dock-*` は使いません。

ホームの見た目は [apps/home.md](../apps/home.md#見た目) にあります。
