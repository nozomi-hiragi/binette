import type { AssetResolver } from "./resolve";
import type { Binette } from "@binette/core";

export interface JoueurOptions {
  sh: object;
  resolver: AssetResolver;
  onNavigate?: (path: string) => void;
  signal?: AbortSignal;
  base?: string;
  /** 画面の css より先に入れる全体の CSS */
  styles?: string[];
}

export interface BinetteJoueur { dispose(): void }

const active = new WeakMap<HTMLElement, BinetteJoueur>();

export async function joueur(container: HTMLElement, binette: Binette, options: JoueurOptions): Promise<BinetteJoueur> {
  active.get(container)?.dispose();
  const root = container.shadowRoot ?? container.attachShadow({ mode: "open" });
  root.replaceChildren();
  let disposed = false;
  let cleanup: (() => void) | undefined;
  const urls = new Set<string>();
  const navigate = (event: Event) => {
    if (!options.onNavigate || !(event instanceof MouseEvent) || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.composedPath().find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
    if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    const href = link.getAttribute("href");
    if (!href) return;
    const url = new URL(href, document.baseURI);
    if (url.origin !== location.origin) return;
    const base = (options.base ?? "/").replace(/\/$/, "");
    if (base && url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return;
    event.preventDefault();
    options.onNavigate(url.pathname + url.search + url.hash);
  };
  const joueur: BinetteJoueur = {
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeEventListener("click", navigate);
      options.signal?.removeEventListener("abort", abort);
      try { cleanup?.(); } finally {
        for (const url of urls) URL.revokeObjectURL(url);
        urls.clear();
        if (active.get(container) === joueur) {
          active.delete(container);
          root.replaceChildren();
        }
      }
    },
  };
  const abort = () => joueur.dispose();
  active.set(container, joueur);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) {
    joueur.dispose();
    return joueur;
  }
  root.addEventListener("click", navigate);
  const asset = async (name: string) => {
    const value = Object.hasOwn(binette.assets, name) ? binette.assets[name] : undefined;
    if (!value) throw new Error(`asset が見つかりません: ${name}`);
    const response = await options.resolver(value);
    return response;
  };
  const assetText = async (name: string) => {
    const response = await asset(name);
    if (!response.ok) throw Object.assign(new Error(`asset を読み込めませんでした: ${name} (${response.status})`), { status: response.status, response });
    return response.text();
  };
  try {
    if (binette.entry === undefined) return joueur;
    const type = binette.assets[binette.entry].type;
    const styles = await Promise.all(Object.entries(binette.assets).filter(([, value]) => value.type === "css").map(([name]) => assetText(name)));
    if (disposed) return joueur;
    const content = await assetText(binette.entry);
    if (disposed) return joueur;
    const host = document.createElement("div");
    for (const css of [...options.styles ?? [], ...styles]) {
      const style = document.createElement("style");
      style.textContent = css;
      root.append(style);
    }
    root.append(host);
    if (type === "html") host.innerHTML = content;
    if (type === "js") {
      const url = URL.createObjectURL(new Blob([content], { type: "text/javascript" }));
      urls.add(url);
      let module: { mount?: unknown };
      try { module = await import(/* @vite-ignore */ url); } finally {
        URL.revokeObjectURL(url);
        urls.delete(url);
      }
      if (disposed) return joueur;
      if (typeof module.mount !== "function") throw new Error("Binette に mount 関数がありません。");
      const result: unknown = await module.mount(host, { ...options.sh, asset });
      if (typeof result === "function") {
        if (disposed) result();
        else cleanup = result as () => void;
      }
    }
    return joueur;
  } catch (error) {
    joueur.dispose();
    throw error;
  }
}
