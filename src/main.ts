/// <reference path="./env.d.ts" />
import { createIndexedDbAppStore, parsePrebuiltApp } from "@binette/regie";
import { mountShell } from "@binette/scene";

// Service Worker は本番の OS だけが持つ。アプリには登録する呼び出しを渡さない
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register(new URL("./sw.js", document.baseURI), { scope: "./" }).catch(console.error);
}

/** アプリの入手元。OS を更新しても変えない */
const SYSTEM = "binette:system";
const BUNDLED = "binette:bundled";
const systemUrls = import.meta.glob<string>("../.binapp/system/*.binapp", { query: "?url", import: "default", eager: true });
const bundledUrls = import.meta.glob<string>("../.binapp/bundled/*.binapp", { query: "?url", import: "default", eager: true });
// スクリプトと同じ UTF-16 コード単位の辞書順。拡張子を除いて比べる
const appName = (key: string) => key.slice(0, -".binapp".length);
const urls = ([[SYSTEM, systemUrls], [BUNDLED, bundledUrls]] as const).flatMap(([source, appUrls]) =>
  Object.keys(appUrls).sort((a, b) => appName(a) < appName(b) ? -1 : appName(a) > appName(b) ? 1 : 0).map((key) => ({ source, url: appUrls[key]! }))
);

const container = document.querySelector<HTMLElement>("#app");
if (!container) throw new Error("表示先がありません。");

try {
  const apps = await Promise.all(urls.map(async ({ source, url }) => {
    const response = await fetch(new URL(url, location.href));
    if (!response.ok) throw new Error(`アプリを取得できません（${response.status}）。`);
    // 配信の URL は中身のハッシュで変わるので、source には使わない
    return { source, prebuilt: parsePrebuiltApp(await response.text()) };
  }));
  const shell = await mountShell(container, {
    apps,
    store: createIndexedDbAppStore(),
    onError(error) { console.error(error); },
  });
  import.meta.hot?.dispose(() => shell.stop());
} catch (error) {
  console.error(error);
  const message = document.createElement("p");
  message.setAttribute("role", "alert");
  message.textContent = "Binette を読み込めませんでした。再読み込みしてください。";
  container.replaceChildren(message);
}
