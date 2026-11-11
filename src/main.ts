/// <reference path="./env.d.ts" />
import { createAppStore, createIndexedDbFileTree, createScheduler, createSystemDistribution } from "@binette/regie";
import { mountShell } from "@binette/scene";
import { bootAppStore, loadBootApps } from "./boot.ts";
import { browserKernels, createUpdater, kernelIdentity } from "./update.ts";
import { showRecovery } from "./recovery.ts";
import { setBootProgress, setBootStage } from "./boot-screen.ts";
import { applyAppearance, recallAppearance, rememberAppearance } from "./appearance.ts";

const container = document.querySelector<HTMLElement>("#app");
if (!container) throw new Error("表示先がありません。");
// 設定を読む前から、前回の見た目で起動画面を出す
// サイトのデータを止めているブラウザでは localStorage に触るだけで例外になる
const storage: Pick<Storage, "getItem" | "setItem"> = (() => { try { return localStorage; } catch { return { getItem: () => null, setItem: () => {} }; } })();
const remembered = recallAppearance(storage);
if (remembered) applyAppearance(document.documentElement, remembered);
const tree = createIndexedDbFileTree();
const distribution = createSystemDistribution(tree, { manifestUrl: new URL("./manifest.json", document.baseURI), origin: location.origin });
const store = bootAppStore(createAppStore(tree));
// 定期実行はすべてスケジューラに載せる（docs/spec/scheduler.md）
const scheduler = await createScheduler({ store: store.system, report: error => console.error(error) });
scheduler.register({ id: "os/gc", owner: "os", label: "ストレージの片付け", rule: { every: 24 * 60 * 60 }, run: async () => { await tree.storage?.gc(); } });
scheduler.start();
import.meta.hot?.dispose(() => scheduler.stop());

if (new URL(location.href).searchParams.has("recovery")) {
  showRecovery(container, distribution);
} else await start(container);

async function start(container: HTMLElement): Promise<void> {
try {
  setBootStage("起動中", container);
  const registration = import.meta.env.PROD && "serviceWorker" in navigator
    ? await navigator.serviceWorker.register(new URL("./sw.js", document.baseURI), { scope: "./", updateViaCache: "none" }) : undefined;
  const current = document.querySelector<HTMLMetaElement>('meta[name="binette-kernel"]')?.content;
  const devSystemVersion = import.meta.env.DEV
    ? document.querySelector<HTMLMetaElement>('meta[name="binette-dev-system"]')?.content : undefined;
  if (import.meta.env.DEV && !devSystemVersion) throw new Error("開発用のシステムの版がありません。build:system を実行して再読み込みしてください。");
  if (current && navigator.serviceWorker.controller) {
    // 旧 SW は問い合わせに未対応。返答がある版では必ず照合する。
    const activeKernel = await kernelIdentity(navigator.serviceWorker.controller).catch(() => undefined);
    if (activeKernel !== undefined && activeKernel !== current) {
      // 保存の切替後、有効化の前にページが終了した場合は、準備済みの組を完成させる。
      if (!registration) throw new Error("ページと実行中のカーネルの印が一致しません。");
      const waiting = registration.waiting;
      if (waiting && await kernelIdentity(waiting) === current) {
        await browserKernels(registration, activeKernel).activate(current);
      } else {
        // 全タブの終了で新 SW が通常有効化した場合も、同じ組へ揃えてから入口を読み直す。
        setBootStage("更新を確認中", container);
        const update = await distribution.checkUpdate(true);
        if (update.manifest.kernel !== activeKernel) throw new Error("実行中のカーネルと組になるシステムを取得できません。");
        await distribution.install(update.manifest, {
          onProgress: (p) => setBootProgress(p, container),
        });
        location.reload();
        return;
      }
    }
  }
  let reloading = false;
  const updater = createUpdater(distribution, registration ? browserKernels(registration, current) : {
    current, devSystemVersion, check(kernel) { return current && kernel && kernel !== current ? Promise.reject(new Error("カーネルを更新できません。")) : Promise.resolve(); }, activate() { return Promise.resolve(); },
  }, () => { if (!reloading) { reloading = true; location.reload(); } });
  setBootStage("更新を確認中", container);
  await updater.boot({
    onProgress: (p) => setBootProgress(p, container),
  });
  setBootStage("起動中", container);
  const { apps, roles, lists } = await loadBootApps(tree, distribution);
  let booting = true;
  const errors: unknown[] = [];
  const shell = await mountShell(container, {
    apps,
    workerUrl: import.meta.env.PROD ? new URL("./regie-worker.js", document.baseURI) : undefined,
    roles,
    lists,
    browserBuild: { distribution, workerUrl: import.meta.env.PROD ? new URL("./build-worker.js", document.baseURI) : undefined },
    update: { ...updater, openRecovery() { location.assign("?recovery"); } },
    store,
    scheduler,
    onAppearance(appearance) { applyAppearance(document.documentElement, appearance); rememberAppearance(storage, appearance); },
    onError(error) { console.error(error); if (booting) errors.push(error); },
  });
  booting = false;
  if (errors.length) { shell.stop(); throw errors[0]; }
  const unregisterUpdate = scheduler.register({ id: "os/update", owner: "os", label: "OS の更新確認", rule: { every: 30 * 60 }, run: () => updater.check() });
  import.meta.hot?.dispose(() => { unregisterUpdate(); shell.stop(); });
} catch (error) {
  console.error(error);
  showRecovery(container, distribution, error);
}
}
