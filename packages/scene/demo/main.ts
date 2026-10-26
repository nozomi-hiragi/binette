import { buildApp, loadCompiler, mountApp } from "@binette/scene";
import repliqueSource from "../../replique/src/index.ts?raw";

const container = document.querySelector<HTMLElement>("#app");
const state = document.querySelector<HTMLElement>("#state");
const loadTime = document.querySelector<HTMLElement>("#load-time");
const buildTime = document.querySelector<HTMLElement>("#build-time");
if (!container || !state || !loadTime || !buildTime) throw new Error("表示先がありません。");

const setState = (kind: "loading" | "building" | "running" | "error", text: string) => {
  state.dataset.state = kind;
  state.textContent = text;
};
const ms = (from: number) => `${Math.round(performance.now() - from)} ms`;
// アプリのファイルは examples/ を GET で取る
const read = async (path: string) => {
  const url = new URL(path, new URL("/counter/", location.href));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url.pathname} を取得できません（${response.status}）。`);
  return response.text();
};

try {
  setState("loading", "asc を読み込み中");
  let start = performance.now();
  const compiler = await loadCompiler();
  loadTime.textContent = `asc の読み込み: ${ms(start)}`;

  setState("building", "ビルド中");
  start = performance.now();
  const built = await buildApp(read, { compiler, libraries: { "jsr:@binette/replique": repliqueSource } });
  buildTime.textContent = `ビルド: ${ms(start)}`;

  await mountApp(container, built, { onError: error => { console.error(error); setState("error", String(error)); } });
  setState("running", `${built.manifest.name} を実行中`);
} catch (error) {
  console.error(error);
  setState("error", error instanceof Error ? error.message : String(error));
}
