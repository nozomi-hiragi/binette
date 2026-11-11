import { validateAppAbi, validateAppRequirements } from "./abi.ts";
import { type AppList, type AppListDocument, type AppManifest, findAppList, normalizeAppIdentifier, normalizeAppListUrl, parseAppId, parseAppList, parseAppManifest, verifyIntegrity } from "@binette/core";
import { buildAppInWorker, type BrowserBuildOptions } from "./browser-build.ts";
import { appPath, iconPath } from "./paths.ts";
import { appId, type AppStore, type InstalledApp, type ProviderListRegistration } from "./store.ts";

/** インストール・更新の進み具合 */
export type InstallPhase = "waiting" | "fetching" | "building" | "saving" | "prepared" | "failed";

/** アプリごとの状態。完全な ID で引く */
export interface InstallState {
  phase: InstallPhase;
  /** 取ったファイルの数とバイト数 */
  files: number;
  bytes: number;
  /** 失敗の理由 */
  error?: string;
}

/** 更新があるアプリ */
export interface AppUpdate {
  /** 完全な ID */
  key: string;
  list: string;
  id: string;
  /** 入っている版 */
  current: string;
  /** リストの版 */
  version: string;
  /** 増える権限（ビルドして分かったときだけ） */
  added?: string[];
  /** 取得とビルドが済み、適用を待っている */
  prepared: boolean;
}

/** 自動更新の設定。アプリごとの既定はオン、リストごと・全体の既定はオフ */
export interface AutoUpdateSettings {
  all?: boolean;
  lists?: Record<string, boolean>;
  apps?: Record<string, boolean>;
}

/** 権限の確認に渡す内容 */
export interface InstallConfirmation {
  key: string;
  name: string;
  list: string;
  listName: string;
  /** 宣言された権限（名前 → 理由） */
  permissions: Record<string, string>;
  /** 更新で増える権限。新しく入れるときは undefined */
  added?: string[];
}

/** アプリの詳細 */
export interface AppDetails {
  key: string;
  list: string;
  listName: string;
  entry: AppList["apps"][number];
  manifest: AppManifest;
  installed?: { version: string };
  update?: AppUpdate;
}

/** 提供リストとアプリを管理する TS API。アプリへは `manager` として包んで渡す */
export interface ProviderLists {
  list(): Promise<ProviderListRegistration[]>;
  add(url: string): Promise<AppList>;
  remove(url: string): Promise<void>;
  fetch(url: string): Promise<AppList>;
  /** 最後に取ったリストの中身。まだ取っていなければ undefined */
  cached(url: string): AppList | undefined;
  /** 入れる・更新する。`options.confirm` があれば権限を確かめる */
  install(url: string, id: string): Promise<InstalledApp>;
  /** 本体だけ、またはデータごと消す */
  uninstall(key: string, withData: boolean): Promise<void>;
  details(url: string, id: string): Promise<AppDetails>;
  /** 全リスト、または 1 つのリストの更新を確かめる。自動更新がオンなら入れる */
  check(url?: string): Promise<void>;
  updates(url?: string): AppUpdate[];
  /** 準備済みの更新を入れる（動いていれば終了させてから） */
  apply(key: string): Promise<void>;
  cancel(key: string): void;
  state(key: string): InstallState | undefined;
  autoUpdate(): AutoUpdateSettings;
  setAutoUpdate(scope: "all" | "list" | "app", target: string, value: boolean): Promise<void>;
  /** 自動更新がオンとして扱われるか（リストごと・全体の上書きを含む） */
  autoUpdates(key: string): boolean;
  /** 適用の途中か。途中のアプリは起動させない */
  applying(key: string): boolean;
  /** アプリが終了したことを知らせる。準備済みの自動更新があれば入れる */
  exited(key: string): void;
  /**
   * 提供リストのアイコン（URL）を data URL にしたもの。まだ取っていなければ取りに行き、取れたら subscribe で知らせる。
   * 取れない・画像でない・大きすぎるときは ""
   */
  icon(url: string): string;
  /** 状態が変わったら呼ぶ */
  subscribe(listener: () => void): () => void;
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
  /** 動いているか（完全な ID、親の ID で聞く） */
  running?: (key: string) => boolean;
  /** 権限の確認。false なら入れない。省くと確かめずに入れる */
  confirm?: (request: InstallConfirmation) => Promise<boolean>;
  /** 取得とビルドを並べる本数。既定は 2 */
  concurrency?: number;
}

/** リスト操作を直列化する。定期の確認はスケジューラの `os/catalogs` が `check` を呼ぶ。stop は進行中の取得・ビルドも中止する */
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
  const get = async (url: string, job?: AbortSignal): Promise<{ bytes: Uint8Array; url: string }> => {
    alive();
    if (job?.aborted) throw new Error("インストールを中止しました。");
    const request = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      // fetch の差し替えが signal を無視しても、直列キューを解放する。
      return await Promise.race([
        new Promise<never>((_, reject) => {
          abort = () => { request.abort(); reject(new Error("提供リストの処理を中止しました。")); };
          controller.signal.addEventListener("abort", abort, { once: true });
          job?.addEventListener("abort", abort, { once: true });
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
      if (abort) { controller.signal.removeEventListener("abort", abort); job?.removeEventListener("abort", abort); }
    }
  };
  const decoder = new TextDecoder("utf-8", { fatal: true });
  // アイコンは URL ごとに 1 回だけ取る。失敗も "" として覚える
  const icons = new Map<string, string>();
  const loadIcon = async (url: string) => {
    let data = "";
    try { data = iconDataUrl((await get(url)).bytes); } catch { /* 頭文字で代える */ }
    if (controller.signal.aborted) return;
    icons.set(url, data);
    if (data) notify();
  };
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
  const permissionNames = (manifest: AppManifest) => Object.keys(manifest.permissions ?? {});
  const added = (before: AppManifest, after: AppManifest) => {
    const old = new Set(permissionNames(before));
    return permissionNames(after).filter(name => !old.has(name));
  };
  // 状態・中止・準備済みの更新。キーは完全な ID
  const states = new Map<string, InstallState>();
  const jobs = new Map<string, AbortController>();
  const prepared = new Map<string, { app: InstalledApp; files: Map<string, Uint8Array>; added: string[] }>();
  const pending = new Map<string, AppUpdate>();
  const lists = new Map<string, AppList>();
  const applyingKeys = new Set<string>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of [...listeners]) { try { listener(); } catch (error) { options.report?.(error); } } };
  const setState = (key: string, state: InstallState | undefined) => {
    if (state) states.set(key, state); else states.delete(key);
    notify();
  };
  let auto: AutoUpdateSettings = (await store.system.getAutoUpdate?.()) ?? {};
  const autoUpdates = (key: string) => {
    if (auto.all) return true;
    const list = key.slice(0, key.indexOf("#"));
    if (auto.lists?.[list]) return true;
    return auto.apps?.[key] ?? true;
  };
  // 取得とビルドは並べ、保存と登録の書き換えは 1 つずつ。
  const limit = Math.max(1, Math.floor(options.concurrency ?? 2));
  let active = 0;
  const slots: (() => void)[] = [];
  const slot = async (signal: AbortSignal) => {
    while (active >= limit) {
      await new Promise<void>(resolve => slots.push(resolve));
      if (signal.aborted) throw new Error("インストールを中止しました。");
    }
    active++;
    return () => { active--; slots.shift()?.(); };
  };
  let writing = Promise.resolve();
  const serialWrite = <T>(work: () => Promise<T>): Promise<T> => {
    const result = writing.then(work);
    writing = result.then(() => {}, () => {});
    return result;
  };
  /** 取得・ビルド・検証まで。保存はしない */
  const prepare = async (url: string, entry: AppList["apps"][number], signal: AbortSignal) => {
    const key = appId(url, entry.id);
    for (const key of Object.keys(entry.integrity ?? {})) {
      if (key === "/") continue;
      const path = key.replace(/\/$/, "");
      if (appPath(path) !== path || path.includes("?") || path.includes("#")) throw new Error(`integrity のパスが正しくありません: ${key}`);
    }
    if (!options.browserBuild) throw new Error("提供リストのアプリにはブラウザ用コンパイラが必要です。");
    const base = new URL(entry.source);
    if (!base.pathname.endsWith("/")) base.pathname += "/";
    const files = new Map<string, Uint8Array>();
    const fetched = new Map<string, Promise<Uint8Array>>();
    const progress = { phase: "fetching" as InstallPhase, files: 0, bytes: 0 };
    setState(key, { ...progress });
    const cancelled = () => { if (signal.aborted) throw new Error("インストールを中止しました。"); };
    const readBytes = (name: string): Promise<Uint8Array> => {
      const path = appPath(name);
      if (!path || path.includes("?") || path.includes("#")) return Promise.reject(new Error("アプリのフォルダ外は読めません。"));
      let result = fetched.get(path);
      if (!result) {
        result = get(new URL(path, base).href, signal).then(({ bytes }) => {
          cancelled();
          files.set(path, bytes);
          progress.files++;
          progress.bytes += bytes.byteLength;
          setState(key, { ...progress });
          return bytes;
        });
        fetched.set(path, result);
      }
      return result;
    };
    const read = async (path: string) => decoder.decode(await readBytes(path));
    const manifest = parseAppManifest(await read("app.json"));
    if (normalizeAppIdentifier(manifest.id) !== entry.id) throw new Error("app.json の ID と提供リストの ID が一致しません。");
    progress.phase = "building";
    setState(key, { ...progress });
    const built = await buildAppInWorker(read, { ...options.browserBuild, signal: AbortSignal.any([controller.signal, signal]) });
    await validateAppAbi(built.wasm);
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
    cancelled();
    const previous = await store.get(key);
    const app: InstalledApp = { ...built, key, source: url, icon, subIcons, listVersion: entry.version, sourceIntegrity: { ...entry.integrity }, installedAt: previous?.installedAt ?? Date.now() };
    return { app, files, previous, progress };
  };
  /** 保存する。動いていれば終了させてから。中止はもう受け付けない */
  const commit = (app: InstalledApp, files: Map<string, Uint8Array>, progress: { files: number; bytes: number }) => serialWrite(async () => {
    const id = app.manifest.id;
    jobs.delete(app.key);
    applyingKeys.add(app.key);
    setState(app.key, { phase: "saving", files: progress.files, bytes: progress.bytes });
    // 再起動（changed）より前に適用中の印を外す。外さないと起動が止まったままになる
    try {
      await options.changing?.(app.source, id);
      alive();
      await store.put(app, files);
      await store.system.putPermissions(app.key, permissionNames(app.manifest));
      prepared.delete(app.key);
      pending.delete(app.key);
    } catch (error) {
      applyingKeys.delete(app.key);
      await options.changed?.();
      throw error;
    }
    applyingKeys.delete(app.key);
    await options.changed?.();
    setState(app.key, undefined);
    return app;
  });
  /** 1 つのアプリの取得から保存まで。`mode` が auto なら確認せず、権限が増える・動いているときは止める */
  const installJob = async (url: string, listName: string, entry: AppList["apps"][number], mode: "manual" | "auto") => {
    const key = appId(url, entry.id);
    if (jobs.has(key)) throw new Error("このアプリはインストールの途中です。");
    const job = new AbortController();
    jobs.set(key, job);
    setState(key, { phase: "waiting", files: 0, bytes: 0 });
    let release: (() => void) | undefined;
    try {
      validateAppRequirements(entry.requires);
      const ready = prepared.get(key);
      let app: InstalledApp, files: Map<string, Uint8Array>, previous: InstalledApp | undefined, progress = { files: 0, bytes: 0 };
      if (ready && ready.app.listVersion === entry.version) {
        ({ app, files } = ready);
        previous = await store.get(key);
      } else {
        release = await slot(job.signal);
        ({ app, files, previous, progress } = await prepare(url, entry, job.signal));
        release(); release = undefined;
      }
      const more = previous ? added(previous.manifest, app.manifest) : undefined;
      if (mode === "auto") {
        const running = options.running?.(key) ?? false;
        if ((more && more.length) || running) {
          prepared.set(key, { app, files, added: more ?? [] });
          const update = pending.get(key);
          if (update) { update.prepared = true; update.added = more ?? []; }
          jobs.delete(key);
          setState(key, { phase: "prepared", files: progress.files, bytes: progress.bytes });
          return app;
        }
      } else if (options.confirm) {
        const permissions = Object.fromEntries(Object.entries(app.manifest.permissions ?? {}).map(([name, value]) => [name, value.reason]));
        const ok = await options.confirm({ key, name: app.manifest.name, list: url, listName, permissions, ...(more ? { added: more } : {}) });
        if (!ok) {
          jobs.delete(key);
          if (prepared.has(key)) setState(key, { phase: "prepared", files: progress.files, bytes: progress.bytes });
          else setState(key, undefined);
          throw new Error("インストールをやめました。");
        }
      }
      if (job.signal.aborted) throw new Error("インストールを中止しました。");
      return await commit(app, files, progress);
    } catch (error) {
      release?.();
      if (jobs.get(key) === job) {
        jobs.delete(key);
        if (job.signal.aborted) setState(key, prepared.has(key) ? states.get(key) : undefined);
        else setState(key, { phase: "failed", files: 0, bytes: 0, error: error instanceof Error ? error.message : String(error) });
      }
      throw error;
    }
  };
  const findEntry = async (url: string, id: string) => {
    const normalized = await normalize(url);
    if (!registrations.some(list => list.url === normalized)) throw new Error("先に提供リストを登録してください。");
    const result = await run(() => follow(normalized));
    lists.set(result.url, result.list);
    const entry = result.list.apps.find(entry => entry.id === normalizeAppIdentifier(id));
    if (!entry) throw new Error("提供リストにアプリがありません。");
    return { url: result.url, list: result.list, entry };
  };
  const checkList = async (url: string, list: AppList) => {
    lists.set(url, list);
    for (const key of [...pending.keys()]) if (key.startsWith(`${url}#`)) pending.delete(key);
    const work: Promise<unknown>[] = [];
    for (const entry of list.apps) {
      const key = appId(url, entry.id);
      const installed = await store.get(key);
      if (!installed) continue;
      const current = installed.listVersion ?? installed.manifest.version ?? "";
      if (current === entry.version) { prepared.delete(key); continue; }
      const ready = prepared.get(key);
      pending.set(key, { key, list: url, id: entry.id, current, version: entry.version, prepared: ready?.app.listVersion === entry.version, ...(ready ? { added: ready.added } : {}) });
      if (autoUpdates(key) && !jobs.has(key)) {
        work.push(installJob(url, list.name, entry, "auto").catch(error => { if (!controller.signal.aborted) options.report?.(error); }));
      }
    }
    notify();
    await Promise.all(work);
  };
  // 確認は取得から自動更新の保存まで直列キューで行う（後の登録操作は確認の後に進む）。
  const check = (only?: string) => run(async () => {
    const targets = await (async () => {
      const result: { url: string; list: AppList }[] = [];
      const checked = new Set<string>();
      const wanted = only === undefined ? undefined : await normalize(only);
      for (const registration of [...registrations]) {
        if (checked.has(registration.url) || (wanted !== undefined && registration.url !== wanted)) continue;
        try {
          const followed = await follow(registration.url);
          checked.add(followed.url);
          result.push(followed);
        } catch (error) { if (!controller.signal.aborted) options.report?.(error); }
      }
      return result;
    })();
    await Promise.all(targets.map(({ url, list }) => checkList(url, list)));
  });
  const api: ProviderLists = {
    list: () => run(() => Promise.resolve(structuredClone(registrations))),
    add: url => run(async () => {
      const normalized = await normalize(url);
      const result = await follow(normalized);
      lists.set(result.url, result.list);
      if (!registrations.some(list => list.url === result.url)) { registrations.push({ url: result.url }); await persist(); }
      notify();
      return result.list;
    }),
    remove: url => run(async () => {
      const normalized = normalizeAppListUrl(url, { allowHttp: true });
      if (registrations.some(list => (list.url === normalized || list.boot === normalized) && list.boot)) throw new Error("既定の提供リストは削除できません。");
      for (let i = registrations.length - 1; i >= 0; i--) if (registrations[i].url === normalized) registrations.splice(i, 1);
      lists.delete(normalized);
      await persist();
      notify();
    }),
    fetch: url => run(async () => {
      const result = await follow(url);
      lists.set(result.url, result.list);
      return result.list;
    }),
    cached: url => {
      try { return lists.get(normalizeAppListUrl(url, { allowHttp: true })); } catch { return undefined; }
    },
    install: async (url, id) => {
      const cached = api.cached(url)?.apps.find(entry => entry.id === normalizeAppIdentifier(id));
      try { validateAppRequirements(cached?.requires); }
      catch (error) {
        setState(appId(await normalize(url), id), { phase: "failed", files: 0, bytes: 0, error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
      const found = await findEntry(url, id);
      return await installJob(found.url, found.list.name, found.entry, "manual");
    },
    uninstall: (key, withData) => serialWrite(async () => {
      const app = await store.get(key);
      const removed = app ? undefined : (await store.listRemoved()).find(entry => entry.key === key);
      const source = app?.source ?? removed?.source;
      if (source === undefined) throw new Error(`アプリが入っていません: ${key}`);
      if (source.startsWith("binette:")) throw new Error("埋め込みのアプリは消せません。");
      jobs.get(key)?.abort();
      prepared.delete(key);
      pending.delete(key);
      applyingKeys.add(key);
      try {
        await options.changing?.(source, app?.manifest.id ?? parseAppId(key, { allowHttp: true }).id);
        await store.uninstall(key, withData);
      } finally {
        applyingKeys.delete(key);
        await options.changed?.();
      }
      setState(key, undefined);
    }),
    details: async (url, id) => {
      const found = await findEntry(url, id);
      validateAppRequirements(found.entry.requires);
      const key = appId(found.url, found.entry.id);
      const base = new URL(found.entry.source);
      if (!base.pathname.endsWith("/")) base.pathname += "/";
      const manifest = parseAppManifest(decoder.decode((await get(new URL("app.json", base).href)).bytes));
      const installed = await store.get(key);
      const update = pending.get(key);
      return {
        key, list: found.url, listName: found.list.name, entry: structuredClone(found.entry), manifest,
        ...(installed ? { installed: { version: installed.listVersion ?? installed.manifest.version ?? "" } } : {}),
        ...(update ? { update: { ...update, ...(installed ? { added: added(installed.manifest, manifest) } : {}) } } : {}),
      };
    },
    check,
    updates: url => [...pending.values()].filter(update => url === undefined || update.list === url).map(update => structuredClone(update)),
    apply: async key => {
      const ready = prepared.get(key);
      if (!ready) throw new Error("準備済みの更新がありません。");
      const { url, list, entry } = await findEntry(ready.app.source, ready.app.manifest.id);
      if (entry.version !== ready.app.listVersion) { prepared.delete(key); throw new Error("提供リストの版が変わりました。もう一度更新を確かめてください。"); }
      await installJob(url, list.name, entry, "manual");
    },
    cancel: key => { jobs.get(key)?.abort(); },
    state: key => { const state = states.get(key); return state && { ...state }; },
    autoUpdate: () => structuredClone(auto),
    setAutoUpdate: async (scope, target, value) => {
      const next = structuredClone(auto);
      if (scope === "all") next.all = value;
      else if (scope === "list") (next.lists ??= {})[await normalize(target)] = value;
      else (next.apps ??= {})[target] = value;
      await store.system.putAutoUpdate?.(next);
      auto = next;
      notify();
    },
    autoUpdates,
    applying: key => applyingKeys.has(key),
    exited: key => {
      if (applyingKeys.has(key) || jobs.has(key)) return;
      const ready = prepared.get(key);
      if (!ready || ready.added.length || !autoUpdates(key)) return;
      void api.apply(key).catch(error => { if (!controller.signal.aborted) options.report?.(error); });
    },
    icon: url => {
      const known = icons.get(url);
      if (known !== undefined) return known;
      icons.set(url, "");
      void loadIcon(url);
      return "";
    },
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    stop() {
      controller.abort();
      for (const job of jobs.values()) job.abort();
      for (const resolve of slots.splice(0)) resolve();
    },
  };
  return api;
}

/** アイコンの上限。これより大きいものは出さない */
export const MAX_ICON_BYTES = 64 * 1024;

/** アイコンのファイルを、画面の画像に使える data URL にする。SVG と PNG・JPEG・GIF・WebP だけ。それ以外は "" */
export function iconDataUrl(bytes: Uint8Array): string {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ICON_BYTES) return "";
  const starts = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte);
  const ascii = (offset: number, text: string) => [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  const type = starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) ? "png"
    : starts(0xff, 0xd8, 0xff) ? "jpeg"
    : ascii(0, "GIF87a") || ascii(0, "GIF89a") ? "gif"
    : ascii(0, "RIFF") && ascii(8, "WEBP") ? "webp"
    : undefined;
  if (type) {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return `data:image/${type};base64,${btoa(binary)}`;
  }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "").trim(); } catch { return ""; }
  // 先頭の XML 宣言・コメント・DOCTYPE のあとに <svg が来るものだけを SVG とみなす。img で描くのでスクリプトは動かない
  const body = text.replace(/^(?:<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|\s+)*/i, "");
  if (!/^<svg[\s/>]/i.test(body)) return "";
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
}
