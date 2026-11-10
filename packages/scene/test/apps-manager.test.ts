import { repliqueFiles } from "../../regie/test/replique.ts";
import { readRepliqueLibraries } from "../../regie/src/cli.ts";
import { assert, assertEquals } from "@std/assert";
import { createMemoryAppStore, serveApp, type RegieWorker } from "@binette/regie";
import { Window } from "happy-dom";
import { createShellUi } from "../src/index.ts";
import { mountSystem, systemView } from "./system-helper.ts";
import { buildCompiler } from "../../../scripts/build-system.ts";

const root = new URL("../../..", import.meta.url);
const libraries = { ...await readRepliqueLibraries(new URL("packages/replique/src/", root)) };
const listUrl = "https://provider.test/apps/";
const sourceUrl = "https://sources.test/memo/";
const sources: Record<string, string> = {
  "app.json": JSON.stringify({ id: "memo", name: "メモ", version: "1.0.0", entry: { as: "src/main.ts" }, permissions: { notify: { reason: "締め切りを知らせるため" } } }),
  "src/main.ts": "export function answer(): i32 { return 42; }",
  "icon.svg": '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
};
const listHtml = `<script type="application/json" id="binette-apps">${JSON.stringify({
  name: "テストの提供者", apps: [{ id: "memo", source: sourceUrl, version: "1.0.0", description: "短いメモ", icon: `${sourceUrl}icon.svg` }],
})}</script>`;

function createWorker(): RegieWorker {
  const { port1, port2 } = new MessageChannel();
  port1.start(); port2.start(); serveApp(port1 as never);
  return { postMessage: (message, transfer) => port2.postMessage(message, transfer as never),
    addEventListener: (type, listener) => port2.addEventListener(type, listener as never),
    terminate() { port1.close(); port2.close(); } };
}
async function waitFor(condition: () => boolean, message = "待っても画面が変わりませんでした"): Promise<void> {
  const deadline = performance.now() + 20000;
  while (!condition() && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert(condition(), message);
}
function key(element: HTMLElement, name: string): HTMLElement | null { return element.querySelector<HTMLElement>(`[data-bina-key="${name}"]`); }

Deno.test("権限の確認は 1 つずつ出し、やめると Esc は false、許可は true を返す", async () => {
  const window = new Window();
  const element = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.append(element as never);
  const ui = createShellUi(element, { installed: true });
  try {
    const request = { key: `${listUrl}#memo`, name: "メモ", list: listUrl, listName: "テストの提供者", permissions: { notify: "知らせるため", files: "" } };
    const first = ui.confirmInstall!(request);
    const second = ui.confirmInstall!({ ...request, name: "更新するメモ", added: ["files"] });
    const dialog = element.querySelector<HTMLDialogElement>(".bina-shell-confirm")!;
    assert(dialog.open);
    assertEquals(dialog.querySelector("h2")!.textContent, "メモを入れますか？");
    assertEquals(dialog.querySelector(".bina-shell-confirm-source")!.textContent, "テストの提供者（provider.test）");
    const buttons = () => [...dialog.querySelectorAll<HTMLButtonElement>("button")];
    buttons().find(button => button.textContent === "やめる")!.click();
    assertEquals(await first, false);
    // 2 つ目は増える権限を先に、強調して出す
    assertEquals(dialog.querySelector("h2")!.textContent, "更新するメモを更新しますか？");
    assertEquals(dialog.querySelector("li strong")!.textContent, "files（増える）");
    buttons().find(button => button.textContent === "許可して更新する")!.click();
    assertEquals(await second, true);
    assert(!dialog.open);
    const third = ui.confirmInstall!(request);
    ui.stop();
    assertEquals(await third, false);
  } finally { ui.stop(); await window.happyDOM.close(); }
});

Deno.test("Cadre のアプリ画面は提供リストのアプリを出し、OS の確認のあとで入れる", async () => {
  const directory = await Deno.makeTempDir({ prefix: "binette-apps-test-" });
  let compiler: Uint8Array;
  try { await buildCompiler(`${directory}/asc.js`); compiler = await Deno.readFile(`${directory}/asc.js`); }
  finally { await Deno.remove(directory, { recursive: true }); }
  const window = new Window();
  const element = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.append(element as never);
  const store = createMemoryAppStore();
  const replique = await repliqueFiles();
  const errors: unknown[] = [];
  const shell = await mountSystem(element, {
    apps: [{ source: "binette:system", read: path => Deno.readTextFile(new URL(`apps/cadre/${path}`, root)) }],
    roles: { cadre: "cadre", home: "cadre.home", settings: "cadre.settings", "apps-manager": "cadre.apps" },
    lists: [listUrl], store, libraries, createWorker, onError: error => errors.push(error), installed: true,
    providerLists: {
      fetch: input => {
        const url = String(input);
        const text = url === listUrl ? listHtml : url.startsWith(sourceUrl) ? sources[url.slice(sourceUrl.length)] : undefined;
        return Promise.resolve(new Response(text ?? "無し", { status: text === undefined ? 404 : 200 }));
      },
      parseHtml: html => new window.DOMParser().parseFromString(html, "text/html") as unknown as Document,
    },
    browserBuild: {
      distribution: { readSystem: path => Promise.resolve(path.endsWith("asc.js") ? compiler : replique.get(path)) },
      workerUrl: new URL("../../regie/test/fixtures/browser-build-worker.ts", import.meta.url),
    },
  });
  try {
    await waitFor(() => element.querySelector("[data-bina-key=home-grid]") !== null);
    const tile = [...element.querySelectorAll<HTMLButtonElement>("[data-bina-key^=home-tile-]")].find(tile => tile.textContent === "アプリ");
    assert(tile, "ホームにアプリ管理がありません");
    tile.click();
    await waitFor(() => (key(element, "apps-find")?.textContent ?? "").includes("メモ"), "探すにカタログのアプリが出ません");
    const find = key(element, "apps-find")!;
    assert(find.textContent!.includes("テストの提供者"));
    assert(find.textContent!.includes("短いメモ"));
    // カタログのアイコンは OS が取って data URL にし、届いたら頭文字の代わりに出す
    await waitFor(() => key(element, "apps-icon") !== null, "カタログのアイコンが出ません");
    assertEquals(key(element, "apps-icon")!.getAttribute("src"), `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sources["icon.svg"])}`);
    find.querySelector<HTMLButtonElement>("[data-bina-key^=find-app-]")!.click();
    await waitFor(() => key(element, "detail-permissions") !== null, "詳細が届きません");
    assert(key(element, "detail-permissions")!.textContent!.includes("締め切りを知らせるため"));
    key(element, "detail-install")!.click();
    const dialog = () => element.querySelector<HTMLDialogElement>(".bina-shell-confirm");
    await waitFor(() => dialog()?.open === true, "権限の確認が出ません");
    assertEquals(dialog()!.querySelector("h2")!.textContent, "メモを入れますか？");
    [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "許可して入れる")!.click();
    let installed = false;
    const deadline = performance.now() + 20000;
    while (!installed && performance.now() < deadline) {
      installed = (await store.list()).some(app => app.key === `${listUrl}#memo`);
      if (!installed) await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert(installed, "アプリが入りません");
    // 入れたあとも、アプリ管理が前面のまま（Cadre が起動し直してもホームに戻さない）
    assertEquals(systemView(element).instances.find(instance => instance.id === systemView(element).front)?.key, "cadre.apps");
    await waitFor(() => key(element, "detail-remove") !== null, "入れたあとに削除が出ません");
    key(element, "detail-remove")!.click();
    await waitFor(() => key(element, "detail-remove-app") !== null, "削除の選択肢が出ません");
    key(element, "detail-remove-app")!.click();
    await waitFor(() => (key(element, "apps-detail")?.textContent ?? "").includes("データだけ"), "本体だけを消したあとにデータだけと出ません");
    assertEquals((await store.listRemoved()).map(app => app.key), [`${listUrl}#memo`]);
    assertEquals(errors, []);
  } finally { shell.stop(); await window.happyDOM.close(); }
});
