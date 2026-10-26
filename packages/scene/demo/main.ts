import { createIndexedDbAppStore } from "@binette/regie";
import { mountHome } from "@binette/scene";
import repliqueSource from "../../replique/src/index.ts?raw";

const container = document.querySelector<HTMLElement>("#app");
const state = document.querySelector<HTMLElement>("#state");
if (!container || !state) throw new Error("表示先がありません。");

// アプリのファイルは examples/ を GET で取る
const apps = ["counter", "hello"].map((name) => {
  const source = new URL(`/${name}/`, location.href).href;
  return {
    source,
    async read(path: string) {
      const url = new URL(path, source);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url.pathname} を取得できません（${response.status}）。`);
      return response.text();
    },
  };
});

try {
  const home = await mountHome(container, {
    apps,
    store: createIndexedDbAppStore(),
    libraries: { "jsr:@binette/replique": repliqueSource },
    onError(error) { console.error(error); },
  });
  state.textContent = "ホーム";
  state.dataset.state = "ready";
  import.meta.hot?.dispose(() => home.stop());
} catch (error) {
  console.error(error);
  state.textContent = error instanceof Error ? error.message : String(error);
  state.dataset.state = "error";
}
