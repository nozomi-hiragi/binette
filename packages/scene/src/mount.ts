import { createUiDom } from "@binette/decor";
import type { DomOp } from "@binette/core";
import type { Process } from "@binette/regie";

/** {@link mountApp} の設定 */
export interface MountOptions {
  /** ホームに渡したアプリの一覧。icon の操作で使う */
  apps?: { id: string; name: string; icon?: string }[];
  /** アプリを終了しない誤り */
  onError?: (error: unknown) => void;
}

/** 描いたアプリのリスナー */
export interface MountedApp {
  /** リスナーを外す。描いた HTML は消さない */
  stop(): void;
}

// テスト用。公開エントリーポイントからは出さない。
const counts = new WeakMap<MountedApp, () => { ids: number; created: number; removers: number }>();
/** @internal */
export function mountCounts(mounted: MountedApp): { ids: number; created: number; removers: number } | undefined {
  return counts.get(mounted)?.();
}

/** HTML を描き、プロセスからの DOM 操作を反映する */
export function mountApp(element: HTMLElement, html: string, process: Process, options: MountOptions = {}): MountedApp {
  // アプリの領域が外に出ないようにする
  element.style.contain = "paint";
  element.innerHTML = html;
  const report = (error: unknown) => options.onError?.(error);
  const ids = new Map<number, string>();
  const created = new Map<number, HTMLElement>();
  const removers = new Map<number, { handle: number; type: string; node: HTMLElement; remove: () => void }>();
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
  // DOM を変える前に対象を調べる。byId はその時点の DOM に対して解決する。
  const release = (root: HTMLElement, includeRoot: boolean) => {
    const includes = (node: HTMLElement) => (includeRoot || node !== root) && root.contains(node);
    const handles = new Set<number>();
    for (const [handle, node] of created) if (includes(node)) { handles.add(handle); created.delete(handle); }
    for (const handle of ids.keys()) {
      const node = target(handle);
      if (node && includes(node)) { handles.add(handle); ids.delete(handle); }
    }
    for (const [number, entry] of removers) {
      if (handles.has(entry.handle) || includes(entry.node)) { entry.remove(); removers.delete(number); }
    }
  };
  const ui = createUiDom(element, process, options);
  let stopped = false;
  const applyDom = (ops: DomOp[]) => {
    if (stopped) return;
    for (const op of ops) {
      if (op.op === "ui-create" || op.op === "ui-update" || op.op === "ui-insert" || op.op === "ui-remove") { ui.apply([op]); continue; }
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
      if (op.op === "unlisten") {
        const entry = removers.get(op.listener);
        if (entry && entry.handle === op.handle && entry.type === op.type) {
          entry.remove(); removers.delete(op.listener);
        }
        continue;
      }
      if (op.op === "listen" && op.type !== "click") {
        report(new Error(`使えないイベントです: ${op.type}`)); continue;
      }
      const node = target(op.handle);
      if (!node || node === element) {
        if (op.op === "remove") {
          ids.delete(op.handle);
          for (const [number, entry] of removers) {
            if (entry.handle === op.handle) { entry.remove(); removers.delete(number); }
          }
        }
        continue;
      }
      switch (op.op) {
        case "text": release(node, false); node.textContent = op.value; break;
        // SVG の className は読み取り専用なので、属性で書く
        case "class": node.setAttribute("class", op.value); break;
        case "remove": release(node, true); node.remove(); break;
        case "icon": {
          if (node.tagName.toLowerCase() !== "img") break;
          const icon = options.apps?.[op.app]?.icon;
          if (icon === undefined) node.removeAttribute("src");
          else node.setAttribute("src", `data:image/svg+xml;charset=utf-8,${encodeURIComponent(icon)}`);
          break;
        }
        case "listen": {
          const listener = () => process.dispatch(op.listener);
          node.addEventListener("click", listener);
          // 番号はプロセス内で一意。重複した入力でも古い DOM リスナーを残さない。
          removers.get(op.listener)?.remove();
          removers.set(op.listener, { handle: op.handle, type: op.type, node, remove: () => node.removeEventListener("click", listener) });
          break;
        }
      }
    }
  };
  process.attach(applyDom);
  const mounted = { stop() { stopped = true; for (const entry of removers.values()) entry.remove(); ui.stop(); removers.clear(); ids.clear(); created.clear(); } };
  counts.set(mounted, () => ({ ids: ids.size, created: created.size, removers: removers.size }));
  return mounted;
}
