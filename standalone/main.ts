/// <reference path="./env.d.ts" />
import { createIndexedDbAppStore } from "@binette/regie";
import { mountHome, parsePrebuiltApp } from "@binette/scene";
// @deno-types="./asset.d.ts"
import counterUrl from "./apps/counter.binapp?url";
// @deno-types="./asset.d.ts"
import helloUrl from "./apps/hello.binapp?url";

/** 最初から入れるアプリの入手元。OS を更新しても変えない */
const PREINSTALLED = "binette:preinstalled";

const container = document.querySelector<HTMLElement>("#app");
if (!container) throw new Error("表示先がありません。");

try {
  const apps = await Promise.all([counterUrl, helloUrl].map(async (url) => {
    const response = await fetch(new URL(url, location.href));
    if (!response.ok) throw new Error(`アプリを取得できません（${response.status}）。`);
    // 配信の URL は中身のハッシュで変わるので、source には使わない
    return { source: PREINSTALLED, prebuilt: parsePrebuiltApp(await response.text()) };
  }));
  const home = await mountHome(container, {
    apps,
    store: createIndexedDbAppStore(),
    onError(error) { console.error(error); },
  });
  import.meta.hot?.dispose(() => home.stop());
} catch (error) {
  console.error(error);
  const message = document.createElement("p");
  message.setAttribute("role", "alert");
  message.textContent = "Binette を読み込めませんでした。再読み込みしてください。";
  container.replaceChildren(message);
}
