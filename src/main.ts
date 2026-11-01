/// <reference path="./env.d.ts" />
import { createAppStore, createIndexedDbFileTree, createSystemDistribution } from "@binette/regie";
import { mountShell } from "@binette/scene";
import { bootAppStore, loadBootApps } from "./boot.ts";
import { showRecovery } from "./recovery.ts";

// Service Worker は本番の OS だけが持つ。アプリには登録する呼び出しを渡さない
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register(new URL("./sw.js", document.baseURI), { scope: "./" }).catch(console.error);
}

const container = document.querySelector<HTMLElement>("#app");
if (!container) throw new Error("表示先がありません。");
const tree = createIndexedDbFileTree();
const distribution = createSystemDistribution(tree, { manifestUrl: new URL("./manifest.json", document.baseURI), origin: location.origin });

if (new URL(location.href).searchParams.has("recovery")) {
  showRecovery(container, distribution);
} else try {
  const update = await distribution.checkUpdate();
  if (update.installedVersion === undefined) await distribution.install(update.manifest);
  const { apps, roles } = await loadBootApps(tree, distribution);
  const updatable = update.updateAvailable && update.installedVersion !== undefined;
  let booting = true;
  const errors: unknown[] = [];
  const shell = await mountShell(container, {
    apps,
    workerUrl: import.meta.env.PROD ? new URL("./regie-worker.js", document.baseURI) : undefined,
    roles,
    // 設定アプリの「更新」で /system を入れ替えて、新しい版で読み込み直す
    update: updatable ? { async apply() { await distribution.install(update.manifest); location.reload(); } } : undefined,
    store: bootAppStore(createAppStore(tree)),
    onError(error) { console.error(error); if (booting) errors.push(error); },
  });
  booting = false;
  if (errors.length) { shell.stop(); throw errors[0]; }
  if (updatable) {
    const notice = document.createElement("p");
    notice.setAttribute("role", "status");
    notice.textContent = "Binette の新しい版があります。ホームから設定を開き、「更新」を押してください。";
    container.append(notice);
  }
  import.meta.hot?.dispose(() => shell.stop());
} catch (error) {
  console.error(error);
  showRecovery(container, distribution, error);
}
