/// <reference path="./env.d.ts" />
import { createIndexedDbAppStore } from "@binette/regie";
import { mountHome, parsePrebuiltApp } from "@binette/scene";
// @deno-types="./asset.d.ts"
import counterUrl from "./apps/counter.binapp?url";
// @deno-types="./asset.d.ts"
import helloUrl from "./apps/hello.binapp?url";

const container = document.querySelector<HTMLElement>("#app");
if (!container) throw new Error("表示先がありません。");

try {
  const apps = await Promise.all([counterUrl, helloUrl].map(async (url) => {
    const source = new URL(url, location.href).href;
    const response = await fetch(source);
    if (!response.ok) throw new Error(`アプリを取得できません（${response.status}）。`);
    return { source, prebuilt: parsePrebuiltApp(await response.text()) };
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
