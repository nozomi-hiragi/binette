/**
 * シェル（`sh`）。アプリの `mount(el, sh)` と部品に渡す、Scene に頼むための API。
 */
export interface SceneShell {
  /** シェルの API のバージョン（今は `"0.1"`） */
  version: string;
  /** Scene の中のパスへ移る */
  navigate: (path: string) => void;
  /** Scene と同じ `fetch` で取る。URL は `serverURL` を基準に解決する */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}

/** ビネットの js に渡すシェル。{@link SceneShell} に、そのビネットの asset を取る `asset(name)` が付く */
export interface SceneAppShell extends SceneShell {
  /** このビネットの `assets` から名前で取る */
  asset: (name: string) => Promise<Response>;
}

/** `mount` が返せる後始末の関数。画面を離れるときに呼ぶ */
export type SceneCleanup = () => void;

/** ビネットの js が書き出す `mount` の形 */
export type SceneMount = (element: HTMLElement, sh: SceneAppShell) => void | SceneCleanup | Promise<void | SceneCleanup>;

/**
 * 設定画面の element セクションに出す、クライアントが用意する部品。アプリの `mount` と同じ形で、`sh` に `asset` は付かない。
 *
 * 後始末の関数を返すと、設定画面を離れるときに呼ぶ。
 */
export type SceneComponent = (element: HTMLElement, sh: SceneShell) => void | SceneCleanup | Promise<void | SceneCleanup>;
