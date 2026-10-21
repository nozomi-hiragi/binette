import { parseBinette } from "@binette/core";
import { joueur as createJoueur, type BinetteJoueur } from "./joueur.ts";
import { importModule } from "./module.ts";
import { createResolver } from "./resolve.ts";
import { SettingsPage, type SettingListItem, type SettingsSection } from "./settings.ts";
import type { SceneAppShell, SceneComponent, SceneMount, SceneShell } from "./shell.ts";
import { button, element, renderView } from "./view.ts";
import type { Binette, BinetteSettingsSection } from "@binette/core";

/**
 * 同じ階層で開く先の行 id がぶつかったら、先に並べた行にあとの行の sections をつなげ、あとの行を消す。
 * 入れ子の中も同じようにまとめる。`sections` は書き換える。
 */
function mergeRows(sections: SettingsSection[]): void {
  const rows = new Map<string, SettingListItem>();
  for (const section of sections) {
    if (section.type !== "list") continue;
    section.contents = section.contents.filter(row => {
      if (row.sections === undefined) return true;
      const first = rows.get(row.id);
      if (!first) {
        rows.set(row.id, row);
        return true;
      }
      first.sections!.push(...row.sections);
      return false;
    });
  }
  for (const row of rows.values()) mergeRows(row.sections!);
}

/** {@link Scene} を作るときの設定 */
export interface SceneOptions {
  /** ビネットや asset の取得元。取得する URL はすべてこれを基準に解決する */
  serverURL: string;
  /** ビネットと asset を取る関数。省略するとブラウザ標準の `fetch` を使う */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Scene が管理する画面 URL の範囲。省略すると `/`。取得先の URL には付けない */
  base?: string;
  /** ビネットの settings の element セクションから component の名前で指定できる部品 */
  components?: Record<string, SceneComponent>;
  /** 読み込みや再生で起きたエラーを受け取る */
  onError?: (error: unknown) => void;
}

/**
 * ビネットを取得して再生する部品。
 *
 * `element` をクライアントが好きな場所に置き、`start()` で始める。
 * 以後の画面遷移、URL の更新、戻る・進むは Scene が受け持つ。
 *
 * @example
 * ```ts
 * const scene = new Scene({ serverURL: "https://example.com/" });
 * document.querySelector("#app")!.append(scene.element);
 * await scene.start();
 * ```
 */
export class Scene {
  /** Scene が描く要素。クライアントが好きな場所に置く */
  readonly element: HTMLElement;
  #options: SceneOptions;
  #root: ShadowRoot;
  /** 入口 /index.bina。無い（404）ときは undefined */
  #entry: Binette | undefined;
  /** 入口の css asset。全画面と設定画面に入れる全体の CSS */
  #styles: string[] = [];
  /** これまでに読んだ、settings を持つビネット。キーは取得したパス。同じパスを読み直したら置き換える */
  #settingsSources = new Map<string, Binette>();
  #disposed = false;
  #generation = 0;
  #joueur: BinetteJoueur | undefined;
  #controller: AbortController | undefined;
  #starting: Promise<void> | undefined;
  #startupFailed = false;
  #started = false;
  #fetch: NonNullable<SceneOptions["fetch"]>;
  #base: string;
  #listening = false;
  #settings: HTMLElement | undefined;
  #cleanups: (() => void)[] = [];

  constructor(options: SceneOptions) {
    this.#options = options;
    this.element = document.createElement("div");
    this.#root = this.element.attachShadow({ mode: "open" });
    const fetchResource = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.#fetch = (url, init) => fetchResource(new URL(url, options.serverURL).href, init);
    this.#base = `/${(options.base ?? "/").split("/").filter(Boolean).join("/")}`;
  }

  #report = (error: unknown) => this.#options.onError?.(error);
  #basicMain = (title: string) => {
    const main = element("main");
    main.append(element("h1", title));
    return main;
  };
  #clear = () => {
    this.#generation++;
    this.#controller?.abort();
    this.#controller = undefined;
    this.#joueur?.dispose();
    this.#joueur = undefined;
    this.#settings = undefined;
    for (const cleanup of this.#cleanups.splice(0)) {
      try { cleanup(); } catch (error) { this.#report(error); }
    }
    this.#root.replaceChildren();
  };
  #errorView = (retry: () => void) => {
    const main = renderView(this.#root, "読み込めませんでした", this.#basicMain("読み込めませんでした"), this.#styles);
    main.setAttribute("role", "alert");
    main.append(button("再試行", retry));
  };
  #notFound = () => {
    const main = renderView(this.#root, "見つかりません", this.#basicMain("見つかりません"), this.#styles);
    main.append(button("設定", () => this.#navigate("/settings")));
  };
  #fetchBinette = async (url: string) => {
    const response = await this.#fetch(url);
    if (response.status === 404) return undefined;
    if (!response.ok) throw response;
    return parseBinette(await response.text());
  };
  /** 読んだビネットの settings を設定画面用に覚える */
  #collectSettings = (url: string, binette: Binette | undefined) => {
    if (binette?.settings) this.#settingsSources.set(url, binette);
    else this.#settingsSources.delete(url);
  };
  #path = (url: URL): string | undefined => {
    if (url.origin !== location.origin) return undefined;
    if (this.#base === "/") return url.pathname;
    if (url.pathname === this.#base) return "/";
    return url.pathname.startsWith(`${this.#base}/`) ? url.pathname.slice(this.#base.length) : undefined;
  };
  #url = (path: string): URL => {
    const target = new URL(path, "https://scene.invalid/");
    if (target.origin !== "https://scene.invalid") throw new Error("Scene 内のパスを指定してください。");
    return new URL(`${this.#base === "/" ? "" : this.#base}${target.pathname}${target.search}${target.hash}`, location.origin);
  };
  #popstate = () => { void this.#showCurrent(); };
  #navigate = async (path: string, replace = false): Promise<void> => {
    if (this.#disposed) return;
    const url = this.#url(path);
    history[replace ? "replaceState" : "pushState"](history.state, "", url);
    if (this.#starting) await this.#starting;
    else await this.#showCurrent();
  };
  /** 入口 `/index.bina` を取り、今の URL の画面まで表示する。何度呼んでも 1 回だけ始める */
  start = (): Promise<void> => {
    if (this.#disposed) return Promise.resolve();
    if (this.#starting) return this.#starting;
    if (this.#started) return Promise.resolve();
    if (!this.#listening) {
      window.addEventListener("popstate", this.#popstate);
      this.#listening = true;
    }
    this.#startupFailed = false;
    this.#starting = (async () => {
      try {
        const value = await this.#fetchBinette("/index.bina");
        const styles = value ? await this.#entryStyles(value) : [];
        if (this.#disposed) return;
        this.#started = true;
        this.#entry = value;
        this.#styles = styles;
        this.#collectSettings("/index.bina", value);
      } catch (error) {
        if (this.#disposed) return;
        this.#startupFailed = true;
        this.#report(error);
        this.#errorView(() => {
          this.#starting = undefined;
          void this.start();
        });
      }
    })().then(async () => {
      this.#starting = undefined;
      if (!this.#startupFailed) await this.#showCurrent();
    });
    return this.#starting;
  };
  #entryStyles = async (entry: Binette): Promise<string[]> => {
    const resolver = createResolver({ fetch: this.#fetch });
    return Promise.all(Object.entries(entry.assets).filter(([, asset]) => asset.type === "css").map(async ([name, asset]) => {
      const response = await resolver(asset);
      if (!response.ok) throw new Error(`asset を読み込めませんでした: ${name} (${response.status})`);
      return response.text();
    }));
  };
  /** Scene の中のパスへ移り、その画面を表示する */
  show = async (path: string): Promise<void> => {
    await this.#navigate(path);
  };
  #showCurrent = async (): Promise<void> => {
    if (this.#starting) return;
    if (this.#disposed || this.#startupFailed) return;
    let url = new URL(location.href);
    let path = this.#path(url);
    if (path === undefined) { this.#clear(); return; }
    if ((path === "/settings" || path.startsWith("/settings/")) && this.#settings) {
      this.#settings.dispatchEvent(new Event("scene-location-change"));
      return;
    }
    this.#clear();
    const current = this.#generation;
    const valid = () => !this.#disposed && current === this.#generation;
    const visited = new Set<string>();
    const redirect = (target: string) => {
      const next = this.#url(target);
      if (!next.search) next.search = url.search;
      if (!next.hash) next.hash = url.hash;
      url = next;
      path = this.#path(url)!;
      history.replaceState(history.state, "", url);
    };
    // 離れた画面の非同期処理から遷移させない
    const navigate = (target: string) => { if (valid()) this.#navigate(target); };
    const abort = new AbortController();
    this.#controller = abort;
    try {
      while (valid()) {
        if (visited.has(path!)) throw new Error("転送が循環しています。");
        visited.add(path!);
        if (path === "/settings" || path!.startsWith("/settings/")) {
          const sectionGeneral: SettingsSection = {
            type: "list",
            contents: [
              {
                id: "general",
                start: "⚙️",
                label: "General",
                sections: [
                  {
                    type: "list", contents: [
                      { id: "version", start: "", label: "Version", end: element("span", "0.1") },
                    ]
                  },
                ],
              },
            ],
          };
          const sh: SceneShell = { version: "0.1", navigate, fetch: this.#fetch };
          // General の order は 0。小さいほど上に並べる。同じ値どうしの順は仕様では決めていない
          const inserted = [...this.#settingsSources.values()].flatMap(binette => binette.settings!.map(section => ({
            order: section.order ?? 0,
            section: this.#settingsSection(section, binette, sh, valid),
          })));
          mergeRows([sectionGeneral, ...inserted.map(item => item.section)]);
          const sections = [{ order: 0, section: sectionGeneral }, ...inserted.filter(item => item.section.type !== "list" || item.section.contents.length > 0)]
            .sort((a, b) => a.order - b.order).map(item => item.section);
          this.#settings = SettingsPage({
            title: "Settings", sections,
            basePath: this.#url("/settings").pathname,
            navigate,
          });
          renderView(this.#root, "設定", this.#settings, this.#styles);
          this.#settings.dispatchEvent(new Event("scene-location-change"));
          return;
        }
        // /index は / と同じ画面なので / へ寄せる
        if (path === "/index") {
          redirect("/");
          continue;
        }
        // / は覚えている入口を出す。入口が無ければ設定画面へ転送する
        const value = path === "/" ? this.#entry : await this.#fetchBinette(`${path}.bina`);
        if (!valid()) return;
        if (path !== "/") this.#collectSettings(`${path}.bina`, value);
        if (!value) {
          if (path === "/") {
            redirect("/settings");
            continue;
          }
          this.#notFound();
        } else if (value.redirect !== undefined) {
          redirect(value.redirect);
          continue;
        } else {
          document.title = value.title ?? "ホーム";
          const handle = await createJoueur(this.element, value, {
            signal: abort.signal,
            resolver: createResolver({ fetch: this.#fetch }),
            onNavigate: target => {
              if (!valid()) return;
              const targetURL = new URL(target, location.href);
              const targetPath = this.#path(targetURL);
              if (targetPath !== undefined) this.#navigate(`${targetPath}${targetURL.search}${targetURL.hash}`);
            },
            base: this.#base,
            // 入口自身の css は joueur が画面の css として入れる
            styles: value === this.#entry ? [] : this.#styles,
            sh: { version: "0.1", navigate, fetch: this.#fetch } satisfies SceneShell,
          });
          if (!valid()) handle.dispose();
          else this.#joueur = handle;
        }
        return;
      }
    } catch (error) {
      if (valid()) this.#report(error);
      if (valid()) this.#errorView(() => { void this.#showCurrent(); });
    }
  };
  #settingsSection = (section: BinetteSettingsSection, binette: Binette, sh: SceneShell, valid: () => boolean): SettingsSection => {
    if (section.type === "list") {
      return {
        type: "list", label: section.label,
        contents: section.contents.map(row => ({
          id: row.id, start: row.start, label: row.label, end: row.end,
          sections: row.sections?.map(child => this.#settingsSection(child, binette, sh, valid)),
        })),
      };
    }
    const host = element("div");
    void this.#mountElement(host, section, binette, sh, valid).catch(error => {
      if (valid()) this.#report(error);
    });
    return { type: "element", label: section.label, element: host };
  };
  #mountElement = async (host: HTMLElement, section: BinetteSettingsSection & { type: "element" }, binette: Binette, sh: SceneShell, valid: () => boolean) => {
    let mount: SceneComponent | SceneMount | undefined;
    let shell: SceneShell | SceneAppShell = sh;
    if (section.component !== undefined) {
      mount = this.#options.components && Object.hasOwn(this.#options.components, section.component) ? this.#options.components[section.component] : undefined;
      if (typeof mount !== "function") throw new Error(`部品が登録されていません: ${section.component}`);
    } else {
      const resolver = createResolver({ fetch: this.#fetch });
      const asset = (name: string) => {
        if (!Object.hasOwn(binette.assets, name)) return Promise.reject(new Error(`asset が見つかりません: ${name}`));
        return resolver(binette.assets[name]);
      };
      const response = await asset(section.entry!);
      if (!response.ok) throw new Error(`asset を読み込めませんでした: ${section.entry} (${response.status})`);
      const code = await response.text();
      if (!valid()) return;
      const exported = (await importModule(code)).mount;
      if (typeof exported !== "function") throw new Error(`mount 関数がありません: ${section.entry}`);
      mount = exported as SceneMount;
      shell = { ...sh, asset };
    }
    if (!valid()) return;
    // component には asset の無いシェル、entry には asset 付きのシェルを渡している
    const result = await (mount as SceneMount)(host, shell as SceneAppShell);
    if (typeof result !== "function") return;
    if (valid()) this.#cleanups.push(result);
    else result();
  };
  /** 表示を片付け、URL の監視をやめる。以後は使えない */
  dispose = (): void => {
    if (this.#disposed) return;
    this.#disposed = true;
    window.removeEventListener("popstate", this.#popstate);
    this.#clear();
  };
}
