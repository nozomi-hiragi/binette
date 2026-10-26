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

  const lists = new Map<string, { template: HTMLTemplateElement; rows: Node[][] }>();
  const rowNumbers = new WeakMap<Node, number>();
  for (const template of element.querySelectorAll<HTMLTemplateElement>("template[bina]")) {
    lists.set(template.getAttribute("bina")!, { template, rows: [] });
  }
  const rowElements = (nodes: Node[]): Element[] => nodes.flatMap((node) =>
    node.nodeType === 1 ? [node as Element, ...(node as Element).querySelectorAll("*")] : []);
  const isRow = (target: Node): boolean => {
    for (let node: Node | null = target; node && node !== element; node = node.parentNode) {
      if (rowNumbers.has(node)) return true;
    }
    return false;
  };
  let mounting = true;
  let exitError: Error | undefined;
  let cleanup = () => {};
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
    onListAdd(name, row) {
      const list = lists.get(name);
      if (!list || row !== list.rows.length) return;
      const fragment = list.template.content.cloneNode(true) as DocumentFragment;
      const nodes = [...fragment.childNodes];
      const previous = list.rows.at(-1)?.at(-1) ?? list.template;
      previous.parentNode!.insertBefore(fragment, previous.nextSibling);
      for (const node of nodes) rowNumbers.set(node, row);
      list.rows.push(nodes);
    },
    onListClear(name) {
      const list = lists.get(name);
      if (!list) return;
      for (const nodes of list.rows) for (const node of nodes) { rowNumbers.delete(node); node.parentNode?.removeChild(node); }
      list.rows = [];
    },
    onItemText(list, row, name, value) {
      for (const target of rowElements(lists.get(list)?.rows[row] ?? [])) {
        if (target.getAttribute("bina") === name) target.textContent = value;
      }
    },
    onItemIcon(list, row, app) {
      const icon = options.apps?.[app]?.icon;
      for (const target of rowElements(lists.get(list)?.rows[row] ?? [])) {
        if (target.tagName.toLowerCase() !== "img" || !target.hasAttribute("bina-icon")) continue;
        if (icon === undefined) target.removeAttribute("src");
        else target.setAttribute("src", `data:image/svg+xml;charset=utf-8,${encodeURIComponent(icon)}`);
      }
    },
    onText(name, value) {
      // 同じ名前の要素はまとめて変える。探すのはアプリの領域の中だけ
      for (const target of element.querySelectorAll("[bina]")) {
        if (!isRow(target) && target.tagName.toLowerCase() !== "template" && target.getAttribute("bina") === name) target.textContent = value;
      }
    },
  });

  if (exitError) { app.stop(); throw exitError; }

  const onClick = (event: Event) => {
    const target = event.target;
    if (typeof (target as Element | null)?.closest !== "function") return;
    const trigger = (target as Element).closest("[bina-on-click]");
    const name = trigger?.getAttribute("bina-on-click");
    if (!trigger || !name || !element.contains(trigger)) return;
    let row: number | undefined;
    for (let node: Node | null = trigger; node && node !== element; node = node.parentNode) {
      if (rowNumbers.has(node)) { row = rowNumbers.get(node); break; }
    }
    app.call(name, row).catch((error: unknown) => {
      if (typeof error !== "object" || error === null || !reported.has(error)) report(error);
    });
  };
  element.addEventListener("click", onClick);
  const stop = () => {
    options.signal?.removeEventListener("abort", stop);
    element.removeEventListener("click", onClick);
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
