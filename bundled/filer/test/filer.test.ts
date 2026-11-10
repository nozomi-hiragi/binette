import { mockImports } from "../../../packages/replique/test/imports.ts";
import { readRepliqueLibraries } from "../../../packages/regie/src/cli.ts";
import { assert, assertEquals } from "@std/assert";
import { buildApp } from "../../../packages/regie/src/build.ts";

Deno.test("Filer は読み込みの名前衝突と共有 ON の処理を OS の応答につなぐ", async () => {
  const root = new URL("../", import.meta.url);
  const built = await buildApp(path => Deno.readTextFile(new URL(path, root)), { libraries: {
    ...await readRepliqueLibraries(new URL("../../../packages/replique/src/", import.meta.url)),
  } });
  const module = new WebAssembly.Module(new Uint8Array(built.wasm));
  type Node = { kind: string; text: string; label: string; handler: number; children: Node[] };
  let frame!: { build: number; root: Node };
  const read = (ptr: number): string => {
    const memory = instance.exports.memory as WebAssembly.Memory;
    return new TextDecoder("utf-16le").decode(new Uint8Array(memory.buffer, ptr, new DataView(memory.buffer).getUint32(ptr - 4, true)));
  };
  const write = (value: string): number => {
    const ptr = (instance.exports.__new as CallableFunction)(value.length * 2, 2) as number;
    const memory = new Uint16Array((instance.exports.memory as WebAssembly.Memory).buffer, ptr, value.length);
    for (let i = 0; i < value.length; i++) memory[i] = value.charCodeAt(i);
    return ptr;
  };
  const requests: { id: number; operation: string; args: string[] }[] = [];
  const results = new Map<number, string>(); const storage = new Map<string, string>(); let next = 0;
  const host: Record<string, CallableFunction> = {};
  for (const entry of WebAssembly.Module.imports(module)) if (entry.module.startsWith("binette:")) host[`${entry.module}/${entry.name}`] = () => 0;
  host["binette:app@0.1/why"] = () => 0;
  let incoming = false;
  host["binette:pigeon@0.1/count"] = () => incoming ? 1 : 0;
  host["binette:pigeon@0.1/kind"] = () => write("pick");
  host["binette:pigeon@0.1/from"] = () => write("requester");
  host["binette:pigeon@0.1/done"] = () => { incoming = false; };
  host["binette:shares@0.1/request"] = (op: number, args: number) => { const id = ++next; requests.push({ id, operation: read(op), args: JSON.parse(read(args)) }); return id; };
  host["binette:shares@0.1/result"] = (id: number) => { const value = results.get(id); if (value === undefined) return 0; results.delete(id); return write(value); };
  host["binette:storage@0.1/count"] = () => storage.size;
  host["binette:storage@0.1/name"] = (i: number) => write([...storage.keys()][i]!);
  host["binette:storage@0.1/read"] = (key: number) => { const value = storage.get(read(key)); return value === undefined ? 0 : write(value); };
  host["binette:storage@0.1/write"] = (key: number, value: number) => { storage.set(read(key), read(value)); return 1; };
  host["binette:storage@0.1/remove"] = (key: number) => storage.delete(read(key));
  host["binette:ui@0.1/render"] = (ptr: number) => { frame = JSON.parse(read(ptr)); };
  const instance = new WebAssembly.Instance(module, { ...mockImports(host), env: { abort: () => { throw new Error("AS abort"); } } });
  const call = (name: string, ...args: number[]) => (instance.exports[name] as CallableFunction)(...args);
  storage.set("filer-ref:/data/filer/legacy.txt", JSON.stringify({ share: "legacy", path: "/old.txt" }));
  call("_start"); call("__bina_lifecycle", 1, 0, 0);
  const complete = (operation: string, value: unknown) => {
    const req = requests.find(item => item.operation === operation && !results.has(item.id)); assert(req, operation);
    requests.splice(requests.indexOf(req), 1); results.set(req.id, JSON.stringify({ ok: true, value })); call("__bina_share");
    return req;
  };
  complete("ownList", [{ path: "/data/filer/a.txt", size: 1, modified: 1 }]);
  assertEquals(storage.has("filer-ref:/data/filer/legacy.txt"), true);
  assertEquals(complete("ownReference", null).args, ["/data/filer/legacy.txt", "legacy", "/old.txt"]);
  assertEquals(storage.has("filer-ref:/data/filer/legacy.txt"), false);
  complete("list", []); complete("estimate", { usage: 1, quota: 100 });
  const flatten = (node: Node): Node[] => [node, ...node.children.flatMap(flatten)];
  const find = (f: (node: Node) => boolean): Node => { const n = flatten(frame.root).find(f); assert(n); return n; };
  assert(flatten(frame.root).some(node => node.text === "1 B / 100 B 使用中"));
  assert(flatten(frame.root).some(node => node.kind === "progress"));
  const picker = find(node => node.kind === "filePick");
  call("__bina_ui_text", frame.build, picker.handler, write(JSON.stringify([{ name: "a.txt", data: "YQ==" }])));
  const imported = requests.find(item => item.operation === "ownWrite");
  assertEquals(imported?.args, ["/data/filer/a (2).txt", "YQ=="]);
  const menu = find(node => node.kind === "menuItem" && node.text === "共有 ON");
  call("__bina_ui_event", frame.build, menu.handler);
  assertEquals(complete("ownShareOn", { id: "share-id" }).args, ["/data/filer/a.txt", "/a.txt"]);
  complete("ownList", [{ path: "/data/filer/a.txt", share: "share-id", sharePath: "/a.txt", size: 1 }]);
  assert(flatten(frame.root).some(node => node.kind === "chip" && node.text === "共有 ON"));
  incoming = true; call("__bina_pigeon");
  const file = find(node => node.kind === "button" && node.label === "a.txt");
  call("__bina_ui_event", frame.build, file.handler);
  assertEquals(complete("pickReply", null).args, ["requester", "share-id", "/a.txt"]);

  // A shared file can be renamed, copied and removed without losing Filer references.
  const shared = [{ id: "external", creatorName: "Memo", filerState: "joined", filerIsCreator: false }];
  complete("list", shared); complete("files", ["/doc.txt"]);
  assertEquals(complete("fileInfo", { size: 1, modified: "2026-01-01" }).args, ["share-id", "/a.txt"]);
  assertEquals(complete("fileInfo", { size: 42, modified: "2026-02-03" }).args, ["external", "/doc.txt"]);
  const click = (name: string) => { const node = find(n => n.kind === "button" && (n.text === name || n.label === name)); call("__bina_ui_event", frame.build, node.handler); };
  const menuClick = (name: string) => { const node = find(n => n.kind === "menuItem" && n.text === name); call("__bina_ui_event", frame.build, node.handler); };
  click("共有"); click("Memo");
  assert(JSON.stringify(frame.root).includes("42 B  ·  2026-02-03"));
  menuClick("名前の変更");
  const field = find(node => node.label === "新しい名前");
  call("__bina_ui_text", frame.build, field.handler, write("renamed.txt")); click("保存");
  assertEquals(complete("sharedRename", null).args, ["external", "/doc.txt", "/renamed.txt"]);
  complete("list", shared); complete("files", ["/renamed.txt"]);
  menuClick("コピー"); click("マイファイル"); click("ここへコピー");
  assertEquals(complete("readBase64", "YQ==").args, ["external", "/renamed.txt"]);
  assert(requests.some(item => item.operation === "ownWrite" && item.args.join(",") === "/data/filer/renamed.txt,YQ=="));
  click("共有"); click("Memo"); menuClick("移動"); click("マイファイル"); click("ここへ移動");
  assertEquals(complete("ownReference", null).args, ["/data/filer/renamed.txt", "external", "/renamed.txt"]);
  click("共有"); click("Memo"); menuClick("削除"); click("削除");
  assertEquals(complete("sharedDelete", null).args, ["external", "/renamed.txt"]);

  // Distinct and even empty shares get independent root folders.
  const second = { id: "other-share", creatorName: "Memo", filerState: "joined", filerIsCreator: false };
  complete("list", [shared[0], second]);
  click("共有");
  const roots = flatten(frame.root).filter(n => n.kind === "button" && n.label === "Memo");
  assertEquals(roots.length, 2);
  menuClick("名前の変更");
  const folderName = find(node => node.label === "新しい名前");
  call("__bina_ui_text", frame.build, folderName.handler, write("共有資料")); click("保存");
  assertEquals(complete("folderRename", null).args, ["external", "共有資料"]);
  complete("list", [{ ...shared[0], creatorName: "共有資料" }, second]);
  click("共有");
  menuClick("削除");
  assert(JSON.stringify(frame.root).includes("この共有から退出しますか？"));
  click("削除");
  assertEquals(complete("folderLeave", null).args, ["external"]);

  // Nested folders use their shared path and do not leave the entire share.
  for (let i = requests.length - 1; i >= 0; i--) if (requests[i]!.operation === "files") requests.splice(i, 1);
  complete("list", [second]);
  assertEquals(complete("files", ["/dir/note.txt"]).args, ["other-share", "/"]);
  click("共有"); click("Memo"); menuClick("名前の変更");
  const nestedName = find(node => node.label === "新しい名前");
  call("__bina_ui_text", frame.build, nestedName.handler, write("renamed")); click("保存");
  assertEquals(complete("sharedFolderRename", null).args, ["other-share", "/dir", "/renamed"]);
  for (let i = requests.length - 1; i >= 0; i--) if (requests[i]!.operation === "files") requests.splice(i, 1);
  complete("list", [second]); complete("files", ["/renamed/note.txt"]);
  click("共有"); click("Memo"); menuClick("削除"); click("削除");
  assertEquals(complete("sharedFolderDelete", null).args, ["other-share", "/renamed"]);
});
