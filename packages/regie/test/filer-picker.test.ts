import { readRepliqueLibraries } from "../src/cli.ts";
import { assert, assertEquals } from "@std/assert";
import type { DomOp } from "@binette/core";
import { createMemoryAppStore, serveApp, startSystem, type Process, type RegieWorker, type SystemUi } from "../src/index.ts";
import { buildApp } from "../src/build.ts";

const libraries = await readRepliqueLibraries(new URL("../../replique/", import.meta.url));
const filerRoot = new URL("../../../bundled/filer/", import.meta.url);
const filer = await buildApp(path => Deno.readTextFile(new URL(path, filerRoot)), { libraries });
const requesterFiles: Record<string, string> = {
  "app.json": JSON.stringify({ id: "requester", name: "依頼元", entry: { as: "main.ts" } }),
  "main.ts": `import { App, Api, Last, PigeonApi, SharesApi, StorageApi, launch } from "jsr:@binette/replique";
let pigeon = new PigeonApi(); let shares = new SharesApi(); let storage = new StorageApi(); let pending: i32 = 0;
export function pick(): void { pigeon.send("filer", "pick", "", "", true); }
class Requester extends App {
  override onCreate(_last: Last, api: Api): void { pigeon = PigeonApi.from(api)!; shares = SharesApi.from(api)!; storage = StorageApi.from(api)!; }
  override onPigeon(): void {
    for (let i = 0; i < pigeon.count(); i++) if (pigeon.kind(i) == "pick.reply") {
      const attached = pigeon.shares(i); storage.write("attachment", attached);
      const body = pigeon.body(i); storage.write("reply", body);
      const begin = body.indexOf('"id":"') + 6; const end = body.indexOf('"', begin);
      pending = shares.readBase64(body.substring(begin, end), "/chosen.txt"); pigeon.done(i); break;
    }
  }
  override onShare(): void { const result = shares.result(pending); if (result !== null) storage.write("result", result); }
}
launch(new Requester());`,
};
const requester = await buildApp(path => Promise.resolve(requesterFiles[path]!), { libraries });
function worker(): RegieWorker {
  const { port1, port2 } = new MessageChannel(); port1.start(); port2.start(); serveApp(port1 as never);
  return { postMessage: (message, transfer) => port2.postMessage(message, transfer as never), addEventListener: (type, listener) => port2.addEventListener(type, listener as never), terminate() { port1.close(); port2.close(); } };
}
async function waitFor(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = performance.now() + 15000;
  while (performance.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert(await check(), "待ってもピッカーの状態が変わりませんでした");
}

Deno.test("ピッカーで選んだファイルは承認済み共有として依頼元へ届き、そのまま読める", async () => {
  const store = createMemoryAppStore();
  const records = new Map<string, { process: Process; labels: Map<number, string>; text: Map<string, string> }>();
  const errors: unknown[] = [];
  const ui: SystemUi = {
    update() {}, report(error) { errors.push(error); },
    present(instance, process) {
      const labels = new Map<number, string>(), text = new Map<string, string>(), ids = new Map<number, string>();
      records.set(instance.app.key, { process, labels, text });
      process.attach((ops: DomOp[]) => { for (const op of ops) {
        if (op.op === "ui-update") { if (op.label) labels.set(op.handle, op.label); else labels.delete(op.handle); }
        else if (op.op === "ui-remove") labels.delete(op.handle);
        else if (op.op === "byId") ids.set(op.handle, op.id);
        else if (op.op === "text") { const id = ids.get(op.handle); if (id) text.set(id, op.value); }
      } });
      return { remove() { process.attach(() => {}); } };
    },
  };
  const requesterId = "https://example.test/picker/#requester";
  const system = await startSystem({ apps: [{ source: "binette:system", prebuilt: { ...requester, manifest: { ...requester.manifest, id: "home", roles: ["home"] } } }, { source: "binette:bundled", prebuilt: filer }, { source: "https://example.test/picker/", prebuilt: requester }], store, ui, createWorker: worker, roles: { files: "filer" }, stackSize: 5 });
  try {
    const owner = await store.fileStorage.appOwner("filer", "binette:bundled");
    await store.fileStorage.forOwner(owner).write("/data/filer/chosen.txt", new TextEncoder().encode("選んだファイル"));
    await system.open(requesterId);
    const sender = records.get(requesterId)!;
    await sender.process.app.call("pick");
    await waitFor(() => [...(records.get("filer")?.labels.values() ?? [])].includes("chosen.txt"));
    const chooser = records.get("filer")!;
    const handle = [...chooser.labels].find(([, label]) => label === "chosen.txt")![0];
    chooser.process.dispatchUi(handle);
    await waitFor(async () => (await store.shares.listShares("filer")).some(share => share.members[requesterId]?.state === "joined"));
    await system.open(requesterId);
    await waitFor(async () => (await store.data.read(requesterId)).has("result"));
    const output = await store.data.read(requesterId);
    assertEquals(JSON.parse(output.get("result")!), { ok: true, value: btoa(unescape(encodeURIComponent("選んだファイル"))) });
    const body = JSON.parse(output.get("reply")!);
    const attachment = JSON.parse(output.get("attachment")!);
    assertEquals(attachment, [{ id: body.id, access: "write" }]);
    assertEquals(body.path, "/chosen.txt");
    assertEquals((await store.shares.getShare(body.id))!.members[requesterId]!.state, "joined");
    assertEquals(errors, []);
  } finally { system.stop(); }
});
