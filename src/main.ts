/// <reference path="./env.d.ts" />
import { createIndexedDbAppStore } from "@binette/regie";
import { mountShell, parsePrebuiltApp } from "@binette/scene";
/** システムアプリの入手元。OS を更新しても変えない */
const SYSTEM = "binette:system";
const appUrls = import.meta.glob<string>("../.binapp/*.binapp", { query: "?url", import: "default", eager: true });
// スクリプトと同じ UTF-16 コード単位の辞書順。共通の接頭辞・拡張子を除いて比べる
const appName = (key: string) => key.slice("../.binapp/".length, -".binapp".length);
const urls = Object.keys(appUrls).sort((a, b) => appName(a) < appName(b) ? -1 : appName(a) > appName(b) ? 1 : 0).map((key) => appUrls[key]!);

const container = document.querySelector<HTMLElement>("#app");
if (!container) throw new Error("表示先がありません。");

try {
  const apps = await Promise.all(urls.map(async (url) => {
    const response = await fetch(new URL(url, location.href));
    if (!response.ok) throw new Error(`アプリを取得できません（${response.status}）。`);
    // 配信の URL は中身のハッシュで変わるので、source には使わない
    return { source: SYSTEM, prebuilt: parsePrebuiltApp(await response.text()) };
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
