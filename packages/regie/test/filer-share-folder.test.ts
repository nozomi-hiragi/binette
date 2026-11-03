import { assert, assertEquals } from "@std/assert";
import { Window } from "happy-dom";
import { createMemoryAppStore, serveApp, startSystem, type Process, type RegieWorker, type SystemUi } from "../src/index.ts";
import { buildApp } from "../src/build.ts";
import { mountApp } from "../../scene/src/mount.ts";

const library = await Deno.readTextFile(new URL("../../replique/src/index.ts", import.meta.url));
const libraries = { "jsr:@binette/replique": library };
const filerRoot = new URL("../../../bundled/filer/", import.meta.url);
function worker(): RegieWorker {
  const { port1, port2 } = new MessageChannel(); port1.start(); port2.start(); serveApp(port1 as never);
  return { postMessage: (message, transfer) => port2.postMessage(message, transfer as never), addEventListener: (type, listener) => port2.addEventListener(type, listener as never), terminate() { port1.close(); port2.close(); } };
}
async function waitFor(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = performance.now() + 15000;
  while (performance.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert(await check(), "待っても共有フォルダーの状態が変わりませんでした");
}
Deno.test("外部共有の表示名変更と退出は Filer のみへ反映され、送信元の内容を保つ", async () => {
  const store = createMemoryAppStore();
  const senderId = "https://example.test/share-folder/#sender";
  const share = await store.shares.createShare(senderId, "元の共有");
  const bytes = new TextEncoder().encode("送信元の文書");
  await store.shares.shareFiles(share.id, senderId).write("/note.txt", bytes);
  const filer = await buildApp(path => Deno.readTextFile(new URL(path, filerRoot)), { libraries });
  const senderFiles: Record<string, string> = {
    "app.json": JSON.stringify({ id: "sender", name: "文章アプリ", entry: { as: "main.ts" } }),
    "main.ts": `import { App, PigeonApi, launch } from "jsr:@binette/replique";
export function send(): void { new PigeonApi().send("filer", "share", "", "", true, "[]", '[{"id":"${share.id}","access":"write"}]'); }
launch(new App());`,
  };
  const sender = await buildApp(path => Promise.resolve(senderFiles[path]!), { libraries });
  const window = new Window();
  const processes = new Map<string, Process>();
  const hosts = new Map<string, HTMLElement>();
  const errors: unknown[] = [];
  const ui: SystemUi = {
    update() {}, report(error) { errors.push(error); },
    present(instance, process) {
      const host = window.document.createElement("div") as unknown as HTMLElement;
      window.document.body.append(host as never);
      const mounted = mountApp(host, instance.app.html, process, { css: instance.app.css, onError: error => errors.push(error) });
      hosts.set(instance.app.key, host); processes.set(instance.app.key, process);
      return { remove() { mounted.stop(); host.remove(); } };
    },
  };
  const system = await startSystem({ apps: [
    { source: "binette:system", prebuilt: { ...sender, manifest: { ...sender.manifest, id: "home", roles: ["home"] } } },
    { source: "https://example.test/share-folder/", prebuilt: sender },
    { source: "binette:bundled", prebuilt: filer },
  ], store, ui, createWorker: worker, roles: { files: "filer" }, stackSize: 5 });
  try {
    await system.open(senderId);
    await processes.get(senderId)!.app.call("send");
    await waitFor(async () => (await store.shares.getShare(share.id))?.members.filer?.state === "joined");
    await waitFor(() => !!hosts.get("filer")?.querySelector('[data-bina-key="filer-tabs"]'));
    const host = hosts.get("filer")!;
    const findButton = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === text)!;
    const shareTab = [...host.querySelectorAll<HTMLButtonElement>('[data-bina-key="filer-tabs"] button')].find(button => button.textContent === "共有")!;
    assert(shareTab); shareTab.click();
    await waitFor(() => !!host.querySelector('button[aria-label="文章アプリ"]'));
    const context = (button: HTMLElement) => button.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }) as unknown as Event);
    const menu = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.textContent === name)!;
    context(host.querySelector('button[aria-label="文章アプリ"]') as HTMLElement);
    assert(menu("名前の変更")); menu("名前の変更").click();
    await waitFor(() => !!host.querySelector('input[aria-label="新しい名前"]'));
    const input = host.querySelector<HTMLInputElement>('input[aria-label="新しい名前"]')!;
    input.value = "自分の資料"; input.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
    assert(findButton("保存")); findButton("保存").click();
    await waitFor(async () => (await store.shares.getShare(share.id))?.members.filer?.label === "自分の資料");
    await waitFor(() => !!host.querySelector('button[aria-label="自分の資料"]'));
    assertEquals((await store.shares.getShare(share.id))?.name, "元の共有");
    assertEquals(await store.shares.shareFiles(share.id, senderId).read("/note.txt"), bytes);
    context(host.querySelector('button[aria-label="自分の資料"]') as HTMLElement);
    assert(menu("削除")); menu("削除").click();
    await waitFor(() => host.textContent!.includes("この共有から退出しますか？"));
    const confirm = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "削除" && button.classList.contains("bina-ui-variant-danger"));
    assert(confirm); confirm.click();
    await waitFor(async () => !(await store.shares.getShare(share.id))?.members.filer);
    await waitFor(() => !host.querySelector('button[aria-label="自分の資料"]'));
    assertEquals((await store.shares.getShare(share.id))?.members[senderId]?.state, "joined");
    assertEquals(await store.shares.shareFiles(share.id, senderId).read("/note.txt"), bytes);
    assertEquals(errors, []);
  } finally { system.stop(); await window.happyDOM.close(); }
});
