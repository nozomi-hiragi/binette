/// <reference path="./env.d.ts" />
import { createAppStore, createIndexedDbFileTree, createSystemDistribution, installedAppKey } from "@binette/regie";
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
  const { apps, home } = await loadBootApps(tree, distribution);
  let booting = true;
  const errors: unknown[] = [];
  const shell = await mountShell(container, {
    apps,
    store: bootAppStore(createAppStore(tree), home, apps.flatMap(app => app.prebuilt?.manifest.role === "home" ? [installedAppKey(app.source, app.prebuilt.manifest.id)] : [])),
    onError(error) { console.error(error); if (booting) errors.push(error); },
  });
  booting = false;
  if (errors.length) { shell.stop(); throw errors[0]; }
  if (update.updateAvailable && update.installedVersion !== undefined) {
    const notice = document.createElement("p");
    notice.setAttribute("role", "status");
    notice.textContent = "Binette の新しい版があります。復旧画面から /system を取り直すと更新できます。";
    const link = document.createElement("a");
    const url = new URL(location.href);
    url.searchParams.set("recovery", "");
    link.href = url.href;
    link.textContent = "復旧画面を開く";
    notice.append(" ", link);
    container.append(notice);
  }
  import.meta.hot?.dispose(() => shell.stop());
} catch (error) {
  console.error(error);
  showRecovery(container, distribution, error);
}
