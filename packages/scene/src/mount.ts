import { launchApp, type LaunchOptions, type RegieApp } from "@binette/regie";
import type { BuiltApp } from "./build.ts";

/** {@link mountApp} の設定 */
export interface MountOptions {
  /** アプリを終了しない呼び出しの失敗 */
  onError?: (error: unknown) => void;
  /** mountApp の完了後にアプリが終了したとき */
  onExit?: (error: Error) => void;
  /** Worker を作る関数。省略すると Régie の Blob URL の Worker */
  createWorker?: LaunchOptions["createWorker"];
  /** 起動中でもアプリを止める */
  signal?: AbortSignal;
  /** ホームだけに渡すアプリの一覧 */
  apps?: { id: string; name: string; icon?: string }[];
  /** ホームが指定した番号のアプリを開く */
  onOpen?: (i: number) => void;
}

/** 画面に出したアプリ */
export interface MountedApp {
  /** Régie で動いているアプリ */
  readonly app: RegieApp;
  /** アプリを止め、クリックの受け付けをやめる */
  stop(): void;
}

/**
 * `element` に HTML を描き、Régie でアプリを起動して、document API の操作を反映する。
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

  const ids = new Map<number, string>();
  const created = new Map<number, HTMLElement>();
  const removers: (() => void)[] = [];
  const allowed = new Set("div span p h1 h2 h3 h4 h5 h6 button ul ol li img section header footer nav main article label strong em small br hr".split(" "));
  // CSS の文字列として引用する。制御文字もエスケープし、任意の id を安全に探す
  const escapeId = (id: string) => id.replace(/["\\\x00-\x1f\x7f]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `);
  const target = (handle: number): HTMLElement | undefined => {
    const made = created.get(handle);
    if (made) return made;
    const id = ids.get(handle);
    if (id === undefined) return undefined;
    const found = element.querySelector<HTMLElement>(`[id="${escapeId(id)}"]`);
    return found && found !== element && element.contains(found) ? found : undefined;
  };
  let running: RegieApp | undefined;
  let mounting = true;
  let exitError: Error | undefined;
  const removeListeners = () => { for (const remove of removers.splice(0)) remove(); };
  let cleanup = removeListeners;
  const app = await launchApp(built.wasm, {
    createWorker: options.createWorker,
    signal: options.signal,
    onError: report,
    onExit(error) {
      exitError = error;
      reported.add(error);
      cleanup();
      if (!mounting) options.onExit?.(error);
    },
    ...(options.apps === undefined ? {} : { apps: options.apps.map(({ id, name }) => ({ id, name })) }),
    onOpen: options.onOpen,
    onDom(ops) {
      for (const op of ops) {
        if (op.op === "byId") { ids.set(op.handle, op.id); continue; }
        if (op.op === "create") {
          const tag = op.tag.toLowerCase();
          if (!allowed.has(tag)) { report(new Error(`作れないタグです: ${op.tag}`)); continue; }
          const made = element.ownerDocument.createElement(tag);
          if (tag === "button") made.setAttribute("type", "button");
          // 装飾アイコンとして使う。属性 API が入るまではすべて空の代替テキストにする
          if (tag === "img") made.setAttribute("alt", "");
          created.set(op.handle, made);
          continue;
        }
        if (op.op === "append") {
          const parent = target(op.parent), child = target(op.child);
          if (parent && child && child !== element && parent !== child && !child.contains(parent)) parent.appendChild(child);
          continue;
        }
        if (op.op === "listen" && op.type !== "click") {
          report(new Error(`使えないイベントです: ${op.type}`)); continue;
        }
        const node = target(op.handle);
        if (!node || node === element) continue;
        switch (op.op) {
          case "text": node.textContent = op.value; break;
          // SVG の className は読み取り専用なので、属性で書く
          case "class": node.setAttribute("class", op.value); break;
          case "remove": node.remove(); break;
          case "icon": {
            if (node.tagName.toLowerCase() !== "img") break;
            const icon = options.apps?.[op.app]?.icon;
            if (icon === undefined) node.removeAttribute("src");
            else node.setAttribute("src", `data:image/svg+xml;charset=utf-8,${encodeURIComponent(icon)}`);
            break;
          }
          case "listen": {
            const listener = () => {
              running?.call("__bina_event", op.listener).catch((error: unknown) => {
                if (typeof error !== "object" || error === null || !reported.has(error)) report(error);
              });
            };
            node.addEventListener("click", listener);
            removers.push(() => node.removeEventListener("click", listener));
            break;
          }
        }
      }
    },
  }).catch((error: unknown) => { removeListeners(); throw error; });

  if (exitError) { removeListeners(); app.stop(); throw exitError; }

  running = app;
  const stop = () => {
    options.signal?.removeEventListener("abort", stop);
    removeListeners();
    running = undefined;
    app.stop();
  };
  cleanup = stop;
  options.signal?.addEventListener("abort", stop, { once: true });
  if (options.signal?.aborted) {
    stop();
    throw new Error("アプリを止めました。");
  }

  if (app.exports.includes("start")) {
    try {
      await app.call("start");
    } catch (error) {
      stop();
      throw error;
    }
  }
  if (exitError) { stop(); throw exitError; }
  mounting = false;
  return { app, stop };
}
