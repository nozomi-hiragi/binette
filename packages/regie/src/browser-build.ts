import type { BuiltApp, BuildOptions } from "./build.ts";
import type { SystemDistribution } from "./distribution.ts";
import type { FileTree } from "./fs.ts";
import type { RegieWorker } from "./launch.ts";
import { appPath, iconPath } from "./paths.ts";
import { encodeAppPathSegment } from "./app-files.ts";
import { createAppStore, installedAppFiles, appId, type InstalledApp } from "./store.ts";

/** 検証したコンパイラを独立した Worker で動かす設定。 */
export interface BrowserBuildOptions extends Pick<BuildOptions, "libraries"> {
  distribution: Pick<SystemDistribution, "readSystem">;
  workerUrl?: string | URL;
  createWorker?: () => RegieWorker;
  /** Worker 内のWorker の起動からの時間切れ。既定は 60 秒。 */
  timeout?: number;
  signal?: AbortSignal;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

/** ソースは要求ごとに読み、コンパイラは検証した実際のバイトからだけ読み込む。 */
export async function buildAppInWorker(read: (path: string) => Promise<string>, options: BrowserBuildOptions): Promise<BuiltApp> {
  const timeout = options.timeout ?? 60000;
  if (!Number.isFinite(timeout) || timeout < 0) throw new Error("ビルドの時間切れは有限の 0 以上の数にしてください。");
  const aborted = () => { if (options.signal?.aborted) throw new Error("ビルドを中止しました。"); };
  aborted();
  const libraries = { ...options.libraries };
  const required = async (path: string) => {
    const bytes = await options.distribution.readSystem(path);
    if (bytes === undefined) throw new Error(`ビルドに必要な固定物がありません: ${path}`);
    return bytes;
  };
  // URL を渡して再取得させず、検査済みのバイトをそのまま Worker に渡す。
  const compiler = (await required("/system/tools/asc.js")).slice();
  const features: unknown = JSON.parse(decoder.decode(await required("/system/libraries/replique/index.json")));
  if (!Array.isArray(features) || features.some(name => typeof name !== "string" || !/^[a-z][a-z0-9-]*$/.test(name) || name === "index") || new Set(features).size !== features.length) {
    throw new Error("Invalid Réplique feature index.");
  }
  for (const name of ["index", ...features]) {
    const specifier = name === "index" ? "jsr:@binette/replique" : `jsr:@binette/replique/${name}`;
    if (libraries[specifier] === undefined) libraries[specifier] = decoder.decode(await required(`/system/libraries/replique/${name}.ts`));
  }
  aborted();
  const worker: RegieWorker = options.createWorker?.() ?? (options.workerUrl === undefined
    ? new Worker(new URL("./build-worker-entry.ts", import.meta.url), { type: "module" })
    : new Worker(options.workerUrl, { type: "module" }));
  return await new Promise<BuiltApp>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, built?: BuiltApp) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", stop);
      worker.terminate();
      if (error) reject(error); else resolve(built!);
    };
    const stop = () => finish(new Error("ビルドを中止しました。"));
    const timer = setTimeout(() => finish(new Error("ビルドが時間切れになりました。")), timeout);
    options.signal?.addEventListener("abort", stop, { once: true });
    worker.addEventListener("error", (event) => {
      event.preventDefault?.();
      finish(new Error(`ビルド Worker が停止しました。${event.message ?? ""}`));
    });
    worker.addEventListener("messageerror", () => finish(new Error("ビルド Worker とのやりとりに失敗しました。")));
    worker.addEventListener("message", (event) => {
      if (settled) return;
      const data = event.data;
      if (data.type === "built") finish(undefined, data.built);
      else if (data.type === "failed") finish(new Error(data.message));
      else if (data.type === "read") {
        const path = typeof data.path === "string" ? appPath(data.path) : null;
        const value = path ? Promise.resolve().then(() => read(path)) : Promise.reject(new Error("アプリのフォルダ外は読めません。"));
        void value.then(
          contents => { if (!settled) worker.postMessage({ type: "file", id: data.id, contents }); },
          error => { if (!settled) worker.postMessage({ type: "file", id: data.id, error: String(error) }); },
        ).catch(error => finish(error instanceof Error ? error : new Error(String(error))));
      }
    });
    if (options.signal?.aborted) { stop(); return; }
    try { worker.postMessage({ type: "build", compiler, libraries }, [compiler.buffer]); }
    catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}

/** Build stored sources and save them with the output in their app owner. */
export async function buildStoredApp(
  tree: FileTree,
  distribution: Pick<SystemDistribution, "readSystem">,
  id: string,
  source: string,
  options: Omit<BrowserBuildOptions, "distribution"> = {},
): Promise<InstalledApp> {
  const directory = `/apps/${encodeAppPathSegment(id)}`;
  const key = appId(source, id);
  const entry = await tree.storage?.findApp(key);
  const owner = entry && tree.storage?.forOwner(entry.owner);
  const files = new Map<string, Uint8Array>();
  const ownedPaths = owner ? await owner.list("/source") : [];
  const paths = ownedPaths.length ? ownedPaths.map(path => path.slice("/source/".length))
    : (await tree.list(directory)).filter(path => path.startsWith(`${directory}/`) && !path.startsWith(`${directory}/build/`))
      .map(path => path.slice(directory.length + 1));
  for (const path of paths) {
    if (!appPath(path)) throw new Error("アプリのフォルダ内の相対パスにしてください。");
  }
  const values = ownedPaths.length
    ? await owner!.readFiles(paths.map(path => `/source/${path}`))
    : await tree.readFiles(paths.map(path => `${directory}/${path}`));
  paths.forEach((path, index) => {
    if (values[index] !== undefined) files.set(path, values[index]);
  });
  const read = (name: string): Promise<string> => {
    const path = appPath(name);
    if (!path) throw new Error("アプリのフォルダ内の相対パスにしてください。");
    const bytes = files.get(path);
    if (bytes === undefined) throw new Error(`アプリのファイルがありません: ${name}`);
    return Promise.resolve(decoder.decode(bytes));
  };
  const built = await buildAppInWorker(read, { ...options, distribution });
  if (built.manifest.id !== id) throw new Error("app.json の ID と保存先の ID が一致しません。");
  const icon = iconPath(built.manifest.icon);
  const subIcons: Record<string, string> = {};
  for (const [id, sub] of Object.entries(built.manifest.sub ?? {})) {
    const path = iconPath(sub.icon);
    if (path !== undefined) subIcons[id] = await read(path);
  }
  const installed: InstalledApp = {
    ...built, key, source,
    ...(Object.keys(subIcons).length ? { subIcons } : {}),
    icon: icon === undefined ? undefined : await read(icon), installedAt: Date.now(),
  };
  if (options.signal?.aborted) throw new Error("ビルドを中止しました。");
  if (tree.storage) await createAppStore(tree).put(installed, files);
  else {
    const output = installedAppFiles(installed);
    output.set(`${directory}/build/app.wasm`, built.wasm);
    output.set(`${directory}/build/index.html`, new TextEncoder().encode(built.html));
    await tree.writeFiles(output);
  }
  return installed;
}
