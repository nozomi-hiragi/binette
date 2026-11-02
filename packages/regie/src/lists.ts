import { type AppList, type AppListDocument, findAppList, normalizeAppIdentifier, normalizeAppListUrl, parseAppList, parseAppManifest, verifyIntegrity } from "@binette/core";
import { buildAppInWorker, type BrowserBuildOptions } from "./browser-build.ts";
import { appPath, iconPath } from "./paths.ts";
import { appId, type AppStore, type InstalledApp, type ProviderListRegistration } from "./store.ts";

/** 提供リストを管理する TS API。アプリへ渡す API はまだ設けない */
export interface ProviderLists {
  list(): Promise<ProviderListRegistration[]>;
  add(url: string): Promise<AppList>;
  remove(url: string): Promise<void>;
  fetch(url: string): Promise<AppList>;
  install(url: string, id: string): Promise<InstalledApp>;
  check(): Promise<void>;
  stop(): void;
}

export interface ProviderListsOptions {
  store: AppStore;
  /** boot.json の既定リスト */
  lists?: string[];
  browserBuild?: BrowserBuildOptions;
  fetch?: typeof globalThis.fetch;
  /** ファイルの取得と本文の読み込みの制限時間（ミリ秒）。既定は 30 秒 */
  fetchTimeout?: number;
  /** ブラウザでは DOMParser。テストではスクリプトを実行しないパーサーを渡せる */
  parseHtml?: (html: string) => AppListDocument;
  /** インストール・更新・引っ越し後に起動候補を読み直す */
  changing?: (source: string, id?: string) => Promise<void>;
  changed?: (move?: { from: string; to: string }) => Promise<void>;
  report?: (error: unknown) => void;
}

/** リスト操作を直列化し、起動時と 30 分ごとに更新する。stop は進行中の取得・ビルドも中止する */
export async function createProviderLists(options: ProviderListsOptions): Promise<ProviderLists> {
  const { store } = options;
  const controller = new AbortController();
  let tail = Promise.resolve();
  const run = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(() => { alive(); return work(); });
    tail = result.then(() => {}, () => {});
    return result;
  };
  const alive = () => { if (controller.signal.aborted) throw new Error("提供リストの処理を中止しました。"); };
  const policy = async () => ({ allowHttp: (await store.system.getSettings())?.allowHttpLists === true });
  const normalize = async (url: string) => normalizeAppListUrl(url, await policy());
  const saved = await store.system.getLists();
  // 設定を無効にしても、以前追加した http: リストの削除はできる。
  const boot = (options.lists ?? []).map(url => normalizeAppListUrl(url, { allowHttp: true }));
  const registrations = saved.filter(list => !list.boot || boot.includes(list.boot));
  for (const url of boot) if (!registrations.some(list => list.boot === url)) registrations.push({ url, boot: url });
  const persist = () => store.system.putLists(registrations);
  await persist();
  const get = async (url: string): Promise<{ bytes: Uint8Array; url: string }> => {
    alive();
    const request = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      // fetch の差し替えが signal を無視しても、直列キューを解放する。
      return await Promise.race([
        new Promise<never>((_, reject) => {
          abort = () => { request.abort(); reject(new Error("提供リストの処理を中止しました。")); };
          controller.signal.addEventListener("abort", abort, { once: true });
          timer = setTimeout(() => {
            request.abort();
            reject(new Error(`提供リストのファイルの取得がタイムアウトしました: ${url}`));
          }, options.fetchTimeout ?? 30_000);
        }),
        (async () => {
          const response = await (options.fetch ?? globalThis.fetch)(url, { mode: "cors", cache: "no-store", signal: request.signal });
          if (!response.ok) throw new Error(`提供リストのファイルを取得できません: ${url} (${response.status})`);
          const final = response.url || url;
          const protocol = new URL(final).protocol;
          if (protocol !== "https:" && !(protocol === "http:" && (await policy()).allowHttp)) throw new Error("提供リストのファイルは https: だけ使えます。");
          const bytes = new Uint8Array(await response.arrayBuffer());
          alive();
          return { bytes, url: final };
        })(),
      ]);
    } finally {
      clearTimeout(timer);
      if (abort) controller.signal.removeEventListener("abort", abort);
    }
  };
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const readList = async (url: string) => {
    url = await normalize(url);
    const page = await get(url);
    const doc = options.parseHtml?.(decoder.decode(page.bytes)) ?? new DOMParser().parseFromString(decoder.decode(page.bytes), "text/html");
    const location = findAppList(doc, page.url, await policy());
    const json = location.kind === "link" ? await get(location.url) : { bytes: page.bytes, url: page.url };
    return parseAppList(location.kind === "embedded" ? location.text : decoder.decode(json.bytes), json.url, await policy());
  };
  const follow = async (initial: string): Promise<{ url: string; list: AppList }> => {
    const from = await normalize(initial);
    let url = from;
    const seen = new Set<string>();
    let list: AppList;
    while (true) {
      if (seen.has(url) || seen.size >= 20) throw new Error("提供リストの引っ越し先が循環しているか、多すぎます。");
      seen.add(url);
      list = await readList(url);
      if (!list.movedTo) break;
      url = await normalize(list.movedTo);
    }
    // 移転の全経路を取得してから登録とデータを付け替える。
    if (url !== from) {
      await options.changing?.(from);
      alive();
      const next = registrations.map(registration => registration.url === from ? { ...registration, url } : registration);
      try { await store.moveSource(from, url, next); }
      catch (error) { await options.changed?.(); throw error; }
      registrations.splice(0, registrations.length, ...next);
      await options.changed?.({ from, to: url });
    }
    return { url, list };
  };
  const installEntry = async (url: string, entry: AppList["apps"][number]) => {
    for (const key of Object.keys(entry.integrity ?? {})) {
      if (key === "/") continue;
      const path = key.replace(/\/$/, "");
      if (appPath(path) !== path || path.includes("?") || path.includes("#")) throw new Error(`integrity のパスが正しくありません: ${key}`);
    }
    if (Object.hasOwn(entry.integrity ?? {}, "/")) throw new Error("integrity の /（アプリ全体）はまだ対応していません。");
    if (!options.browserBuild) throw new Error("提供リストのアプリにはブラウザ用コンパイラが必要です。");
    const base = new URL(entry.source);
    if (!base.pathname.endsWith("/")) base.pathname += "/";
    const files = new Map<string, Uint8Array>();
    const pending = new Map<string, Promise<Uint8Array>>();
    const readBytes = (name: string): Promise<Uint8Array> => {
      const path = appPath(name);
      if (!path || path.includes("?") || path.includes("#")) return Promise.reject(new Error("アプリのフォルダ外は読めません。"));
      let result = pending.get(path);
      if (!result) {
        result = get(new URL(path, base).href).then(({ bytes }) => { files.set(path, bytes); return bytes; });
        pending.set(path, result);
      }
      return result;
    };
    const read = async (path: string) => decoder.decode(await readBytes(path));
    const manifest = parseAppManifest(await read("app.json"));
    if (normalizeAppIdentifier(manifest.id) !== entry.id) throw new Error("app.json の ID と提供リストの ID が一致しません。");
    const built = await buildAppInWorker(read, { ...options.browserBuild, signal: controller.signal });
    const path = iconPath(manifest.icon);
    const icon = path === undefined ? undefined : await read(path);
    const subIcons: Record<string, string> = {};
    for (const [id, sub] of Object.entries(manifest.sub ?? {})) {
      const path = iconPath(sub.icon);
      if (path !== undefined) subIcons[id] = await read(path);
    }
    // ファイルキーは明記されたファイルも取得。フォルダは OS が実際に取得したファイルだけを含める。
    for (const key of Object.keys(entry.integrity ?? {})) if (!key.endsWith("/")) {
      if (appPath(key) !== key || key.includes("?") || key.includes("#")) throw new Error(`integrity のパスが正しくありません: ${key}`);
      await readBytes(key);
    }
    await verifyIntegrity(entry.integrity ?? {}, [...files].map(([path, bytes]) => ({ path, bytes })));
    alive();
    const key = appId(url, entry.id);
    const previous = await store.get(key);
    const app: InstalledApp = { ...built, key, source: url, icon, subIcons, listVersion: entry.version, installedAt: previous?.installedAt ?? Date.now() };
    await options.changing?.(url, entry.id);
    alive();
    try { await store.put(app); }
    catch (error) { await options.changed?.(); throw error; }
    await options.changed?.();
    return app;
  };
  const check = () => run(async () => {
    const checked = new Set<string>();
    for (const registration of [...registrations]) {
      if (checked.has(registration.url)) continue;
      try {
        const { url, list } = await follow(registration.url);
        checked.add(url);
        for (const entry of list.apps) {
          const installed = await store.get(appId(url, entry.id));
          if (installed && (installed.listVersion ?? installed.manifest.version) !== entry.version) {
            try { await installEntry(url, entry); } catch (error) { if (!controller.signal.aborted) options.report?.(error); }
          }
        }
      } catch (error) { if (!controller.signal.aborted) options.report?.(error); }
    }
  });
  const api: ProviderLists = {
    list: () => run(() => Promise.resolve(structuredClone(registrations))),
    add: url => run(async () => {
      const normalized = await normalize(url);
      const result = await follow(normalized);
      if (!registrations.some(list => list.url === result.url)) { registrations.push({ url: result.url }); await persist(); }
      return result.list;
    }),
    remove: url => run(async () => {
      const normalized = normalizeAppListUrl(url, { allowHttp: true });
      if (registrations.some(list => (list.url === normalized || list.boot === normalized) && list.boot)) throw new Error("既定の提供リストは削除できません。");
      for (let i = registrations.length - 1; i >= 0; i--) if (registrations[i].url === normalized) registrations.splice(i, 1);
      await persist();
    }),
    fetch: url => run(async () => (await follow(url)).list),
    install: (url, id) => run(async () => {
      const normalized = await normalize(url);
      if (!registrations.some(list => list.url === normalized)) throw new Error("先に提供リストを登録してください。");
      const result = await follow(normalized);
      const entry = result.list.apps.find(entry => entry.id === normalizeAppIdentifier(id));
      if (!entry) throw new Error("提供リストにアプリがありません。");
      return await installEntry(result.url, entry);
    }),
    check,
    stop() { clearInterval(timer); controller.abort(); },
  };
  const timer = setInterval(() => { void check().catch(error => { if (!controller.signal.aborted) options.report?.(error); }); }, 30 * 60_000);
  return api;
}
