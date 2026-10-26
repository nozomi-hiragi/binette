import { launchApp, type LaunchOptions, type RegieApp } from "@binette/regie";
import type { BuiltApp } from "./build.ts";

/** {@link mountApp} の設定 */
export interface MountOptions {
  /** アプリの中で起きたエラーや、呼び出しの失敗 */
  onError?: (error: unknown) => void;
  /** Worker を作る関数。省略すると Régie の Blob URL の Worker */
  createWorker?: LaunchOptions["createWorker"];
}

/** 画面に出したアプリ */
export interface MountedApp {
  /** Régie で動いているアプリ */
  readonly app: RegieApp;
  /** アプリを止め、クリックの受け付けをやめる */
  stop(): void;
}

/**
 * `element` に HTML を描き、Régie でアプリを起動して、`bina` と `bina-on-click` をつなぐ。
 * export に `start` があれば呼ぶ。HTML の検証はまだしない。
 *
 * @throws {Error} アプリを起動できないとき、または `start()` が失敗したとき
 */
export async function mountApp(element: HTMLElement, built: BuiltApp, options: MountOptions = {}): Promise<MountedApp> {
  // アプリの領域が外に出ないようにする
  element.style.contain = "paint";
  element.innerHTML = built.html;

  // Régie が onError に渡したエラーを、call の失敗で二重に知らせないために覚えておく
  const reported = new WeakSet<object>();
  const report = (error: unknown) => {
    if (typeof error === "object" && error !== null) reported.add(error);
    options.onError?.(error);
  };

  const app = await launchApp(built.wasm, {
    createWorker: options.createWorker,
    onError: report,
    onText(name, value) {
      // 同じ名前の要素はまとめて変える。探すのはアプリの領域の中だけ
      for (const target of element.querySelectorAll("[bina]")) {
        if (target.getAttribute("bina") === name) target.textContent = value;
      }
    },
  });

  const onClick = (event: Event) => {
    const target = event.target;
    if (typeof (target as Element | null)?.closest !== "function") return;
    const trigger = (target as Element).closest("[bina-on-click]");
    const name = trigger?.getAttribute("bina-on-click");
    if (!trigger || !name || !element.contains(trigger)) return;
    app.call(name).catch((error: unknown) => {
      if (typeof error !== "object" || error === null || !reported.has(error)) report(error);
    });
  };
  element.addEventListener("click", onClick);
  const stop = () => {
    element.removeEventListener("click", onClick);
    app.stop();
  };

  if (app.exports.includes("start")) {
    try {
      await app.call("start");
    } catch (error) {
      stop();
      throw error;
    }
  }
  return { app, stop };
}
