/// <reference path="./env.d.ts" />
import { createAppStore, createIndexedDbFileTree, createSystemDistribution } from "@binette/regie";
import { mountShell } from "@binette/scene";
import { bootAppStore, loadBootApps } from "./boot.ts";
import { browserKernels, createUpdater, kernelIdentity } from "./update.ts";
import { showRecovery } from "./recovery.ts";

const container = document.querySelector<HTMLElement>("#app");
if (!container) throw new Error("表示先がありません。");
const tree = createIndexedDbFileTree();
const distribution = createSystemDistribution(tree, { manifestUrl: new URL("./manifest.json", document.baseURI), origin: location.origin });

if (new URL(location.href).searchParams.has("recovery")) {
  showRecovery(container, distribution);
} else await start(container);

async function start(container: HTMLElement): Promise<void> {
try {
  const registration = import.meta.env.PROD && "serviceWorker" in navigator
    ? await navigator.serviceWorker.register(new URL("./sw.js", document.baseURI), { scope: "./", updateViaCache: "none" }) : undefined;
  const current = document.querySelector<HTMLMetaElement>('meta[name="binette-kernel"]')?.content;
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
        const update = await distribution.checkUpdate(true);
        if (update.manifest.kernel !== activeKernel) throw new Error("実行中のカーネルと組になるシステムを取得できません。");
        await distribution.install(update.manifest);
        location.reload();
        return;
      }
    }
  }
  let reloading = false;
  const updater = createUpdater(distribution, registration ? browserKernels(registration, current) : {
    current, check(kernel) { return current && kernel && kernel !== current ? Promise.reject(new Error("カーネルを更新できません。")) : Promise.resolve(); }, activate() { return Promise.resolve(); },
  }, () => { if (!reloading) { reloading = true; location.reload(); } });
  await updater.boot();
  const { apps, roles } = await loadBootApps(tree, distribution);
  let booting = true;
  const errors: unknown[] = [];
  const shell = await mountShell(container, {
    apps,
    workerUrl: import.meta.env.PROD ? new URL("./regie-worker.js", document.baseURI) : undefined,
    roles,
    update: { ...updater, openRecovery() { location.assign("?recovery"); } },
    store: bootAppStore(createAppStore(tree)),
    onError(error) { console.error(error); if (booting) errors.push(error); },
  });
  booting = false;
  if (errors.length) { shell.stop(); throw errors[0]; }
  void updater.check();
  const timer = setInterval(() => { void updater.check(); }, 30 * 60_000);
  import.meta.hot?.dispose(() => { clearInterval(timer); shell.stop(); });
} catch (error) {
  console.error(error);
  showRecovery(container, distribution, error);
}
}
