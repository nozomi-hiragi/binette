import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  createMemoryContentStore,
  createMemoryStorage,
} from "../src/storage.ts";

Deno.test("共有は招待承認と権限を検査し最後の参加者退出で招待も消す", async () => {
  const content = createMemoryContentStore();
  const storage = createMemoryStorage({ content });
  const share = await storage.createShare("author", "資料");
  const files = storage.shareFiles(share.id, "author");
  await files.write("/note", new Uint8Array([1]));
  await storage.inviteShare(share.id, "author", "reader", "read");
  await assertRejects(() =>
    storage.shareFiles(share.id, "reader").read("/note")
  );
  await storage.joinShare(share.id, "reader");
  const reader = storage.shareFiles(share.id, "reader");
  assertEquals(await reader.read("/note"), new Uint8Array([1]));
  await assertRejects(() => reader.write("/note", new Uint8Array([2])));
  await storage.leaveShare(share.id, "author");
  assertEquals(await reader.list("/"), ["/note"]);
  await storage.leaveShare(share.id, "reader");
  assertEquals(await storage.getShare(share.id), undefined);
  await storage.gc();
  assertEquals(await content.list(), []);
  const pending = await storage.createShare("author", "招待");
  await storage.inviteShare(pending.id, "author", "reader", "write");
  await storage.leaveShare(pending.id, "author");
  await assertRejects(() => storage.joinShare(pending.id, "reader"));
});

Deno.test("共有の移動は所有者を検査し履歴と内容を保つ", async () => {
  const storage = createMemoryStorage();
  const owner = await storage.appOwner("author");
  const own = storage.forOwner(owner);
  await own.write("/data/file", new Uint8Array([1]));
  await own.write("/data/file", new Uint8Array([2]));
  const share = await storage.createShare("author", "資料");
  await assertRejects(() =>
    storage.moveShareFile(
      share.id,
      "author",
      "_0/-f",
      "/data/file",
      "/file",
      true,
    )
  );
  await storage.moveShareFile(
    share.id,
    "author",
    owner,
    "/data/file",
    "/file",
    true,
  );
  assertEquals(await own.read("/data/file"), undefined);
  const files = storage.shareFiles(share.id, "author");
  assertEquals(await files.read("/file"), new Uint8Array([2]));
  const old = (await files.metadata("/file"))!.history[0];
  await files.restore("/file", old);
  await storage.moveShareFile(
    share.id,
    "author",
    owner,
    "/data/file",
    "/file",
    false,
  );
  assertEquals(await own.read("/data/file"), new Uint8Array([1]));
  assertEquals(await files.read("/file"), undefined);
});

Deno.test("共有の招待配送失敗は全件を元に戻しアンインストールは参加を外す", async () => {
  const storage = createMemoryStorage();
  await storage.appOwner("author");
  const a = await storage.createShare("author", "a");
  const b = await storage.createShare("author", "b");
  await storage.inviteShare(a.id, "author", "reader", "read");
  await assertRejects(() =>
    storage.inviteSharesWithDelivery(
      "author",
      "reader",
      [{ id: a.id, access: "write" }, { id: b.id, access: "read" }],
      () => Promise.reject(new Error("delivery")),
    )
  );
  assertEquals((await storage.getShare(a.id))!.members.reader, {
    access: "read",
    state: "invited",
  });
  assertEquals((await storage.getShare(b.id))!.members.reader, undefined);
  await storage.removeApp("author");
  assertEquals(await storage.getShare(a.id), undefined);
  assertEquals(await storage.getShare(b.id), undefined);
});

Deno.test("提供リストの移転は共有の作成者と親子のメンバー ID も更新する", async () => {
  const storage = createMemoryStorage();
  const from = "https://old.test/list";
  const to = "https://new.test/list";
  const author = `${from}#author`;
  await storage.appOwner(author);
  const share = await storage.createShare(author, "移転");
  await storage.inviteShare(share.id, author, `${author}.child`, "read");
  await storage.moveProvider(from, to);
  const row = (await storage.getShare(share.id))!;
  assertEquals(row.creator, `${to}#author`);
  assertEquals(Object.keys(row.members).sort(), [
    `${to}#author`,
    `${to}#author.child`,
  ]);
});

Deno.test("Filer の参照行は共有の開始・追加・解除を一体で保存する", async () => {
  const storage = createMemoryStorage();
  const owner = await storage.appOwner("filer");
  const files = storage.forOwner(owner);
  await files.write("/data/filer/a.txt", new Uint8Array([1]));
  await files.write("/data/filer/a.txt", new Uint8Array([2]));
  const share = await storage.filerShareOn("filer", owner, "/data/filer/a.txt", "/a.txt");
  let rows = await storage.filerShareList("filer", owner, "/data/filer");
  assertEquals(rows.length, 1);
  assertEquals("share" in rows[0].row && rows[0].row.share, share.id);
  assertEquals(await storage.shareFiles(share.id, "filer").read("/a.txt"), new Uint8Array([2]));
  await storage.filerShareReference("filer", owner, "/data/filer/b.txt", share.id, "/a.txt");
  await storage.gc();
  assertEquals(await storage.shareFiles(share.id, "filer").read("/a.txt"), new Uint8Array([2]));
  await assertRejects(() => storage.filerShareReference("other", owner, "/data/filer/x", share.id, "/a.txt"));
  await assertRejects(() => storage.filerShareReference("filer", owner, "/data/filer/b.txt", share.id, "/a.txt"));
  await storage.filerShareOff("filer", owner, "/data/filer/a.txt");
  rows = await storage.filerShareList("filer", owner, "/data/filer");
  assertEquals(rows.length, 2);
  assertEquals(rows.every(({ row }) => "hash" in row), true);
  assertEquals(await files.read("/data/filer/a.txt"), new Uint8Array([2]));
  assertEquals(await files.read("/data/filer/b.txt"), new Uint8Array([2]));
  assertEquals(await storage.shareFiles(share.id, "filer").read("/a.txt"), undefined);
  await storage.gc();
  assertEquals(await files.read("/data/filer/a.txt"), new Uint8Array([2]));
});

Deno.test("共有 ON の内容コピー失敗時は共有も元の行も変わらない", async () => {
  const content = createMemoryContentStore();
  const storage = createMemoryStorage({ content });
  const owner = await storage.appOwner("filer");
  await storage.forOwner(owner).write("/data/filer/a", new Uint8Array([7]));
  const broken = { ...content, write: (key: string, value: Uint8Array) => key.startsWith("shared/") ? Promise.reject(new Error("full")) : content.write(key, value) };
  // The failing store must be installed before the operation, so use a forwarding switch.
  let fail = false;
  const forwarded = { ...content, write: (key: string, value: Uint8Array) => fail ? broken.write(key, value) : content.write(key, value) };
  const second = createMemoryStorage({ content: forwarded });
  const secondOwner = await second.appOwner("other");
  await second.forOwner(secondOwner).write("/data/filer/a", new Uint8Array([7]));
  fail = true;
  await assertRejects(() => second.filerShareOn("other", secondOwner, "/data/filer/a", "/a"));
  assertEquals(await second.forOwner(secondOwner).read("/data/filer/a"), new Uint8Array([7]));
  assertEquals(await second.listShares("other"), []);
  assertEquals((await second.filerShareList("other", secondOwner, "/data/filer"))[0].row.name, "a");
});

Deno.test("読み取り専用の共有は参照できるが共有 OFF では変更されない", async () => {
  const storage = createMemoryStorage();
  const owner = await storage.appOwner("filer");
  const share = await storage.createShare("author", "資料");
  await storage.shareFiles(share.id, "author").write("/a", new Uint8Array([5]));
  await storage.inviteShare(share.id, "author", "filer", "read");
  await assertRejects(() => storage.filerShareReference("filer", owner, "/data/filer/a", share.id, "/a"));
  await storage.joinShare(share.id, "filer");
  await storage.filerShareReference("filer", owner, "/data/filer/a", share.id, "/a");
  await assertRejects(() => storage.filerShareOff("filer", owner, "/data/filer/a"));
  const rows = await storage.filerShareList("filer", owner, "/data/filer");
  assertEquals("share" in rows[0].row && rows[0].row.share, share.id);
  assertEquals(await storage.shareFiles(share.id, "author").read("/a"), new Uint8Array([5]));
  await assertRejects(() => storage.filerShareList("other", owner, "/data/filer"));
});

Deno.test("共有ファイルの名前変更と削除は参照も一括更新し失敗時は維持する", async () => {
  const storage = createMemoryStorage();
  const owner = await storage.appOwner("filer");
  const share = await storage.createShare("author", "資料");
  const files = storage.shareFiles(share.id, "author");
  await files.write("/a", new Uint8Array([1]));
  await files.write("/exists", new Uint8Array([2]));
  await storage.inviteShare(share.id, "author", "filer", "write");
  await storage.joinShare(share.id, "filer");
  await storage.filerShareReference("filer", owner, "/data/filer/a", share.id, "/a");
  await assertRejects(() => storage.filerShareRename("filer", owner, share.id, "/a", "/exists"));
  let rows = await storage.filerShareList("filer", owner, "/data/filer");
  assertEquals("share" in rows[0].row && rows[0].row.path, "/a");
  await assertRejects(() => storage.filerShareDelete("other", owner, share.id, "/a"));
  await storage.filerShareRename("filer", owner, share.id, "/a", "/b");
  rows = await storage.filerShareList("filer", owner, "/data/filer");
  assertEquals("share" in rows[0].row && rows[0].row.path, "/b");
  assertEquals(await files.read("/b"), new Uint8Array([1]));
  await storage.filerShareDelete("filer", owner, share.id, "/b");
  assertEquals(await storage.filerShareList("filer", owner, "/data/filer"), []);
  assertEquals(await files.read("/b"), undefined);
});

Deno.test("Filer の共有フォルダー名は本人だけに保存し退出時は参照を保持する", async () => {
  const content = createMemoryContentStore();
  let fail = false;
  const forwarded = { ...content, write: (key: string, value: Uint8Array) => fail && key.startsWith("_0/") ? Promise.reject(new Error("full")) : content.write(key, value) };
  const storage = createMemoryStorage({ content: forwarded });
  const owner = await storage.appOwner("filer");
  const share = await storage.createShare("author", "元の名前");
  const files = storage.shareFiles(share.id, "author");
  await files.write("/dir/a", new Uint8Array([1, 2]));
  await storage.inviteShare(share.id, "author", "filer", "read");
  await storage.joinShare(share.id, "filer");
  await storage.filerShareReference("filer", owner, "/data/filer/a", share.id, "/dir/a");
  await assertRejects(() => storage.filerShareFolderRename("other", owner, share.id, "別名"));
  assertThrows(() => storage.filerShareFolderRename("filer", owner, share.id, "a/b"));
  await storage.filerShareFolderRename("filer", owner, share.id, "別名");
  assertEquals((await storage.getShare(share.id))!.members.filer.label, "別名");
  assertEquals((await storage.getShare(share.id))!.name, "元の名前");
  assertEquals((await storage.getShare(share.id))!.members.author.label, undefined);
  fail = true;
  await assertRejects(() => storage.filerShareFolderLeave("filer", owner, share.id), Error, "full");
  assertEquals((await storage.getShare(share.id))!.members.filer.state, "joined");
  assertEquals("share" in (await storage.filerShareList("filer", owner, "/data/filer"))[0].row, true);
  fail = false;
  await storage.filerShareFolderLeave("filer", owner, share.id);
  assertEquals((await storage.getShare(share.id))!.members.filer, undefined);
  assertEquals(await storage.forOwner(owner).read("/data/filer/a"), new Uint8Array([1, 2]));
  assertEquals(await files.read("/dir/a"), new Uint8Array([1, 2]));
});

Deno.test("共有サブフォルダーの名前変更・削除は共有と参照を一括更新する", async () => {
  const storage = createMemoryStorage();
  const owner = await storage.appOwner("filer");
  const share = await storage.createShare("author", "資料");
  const files = storage.shareFiles(share.id, "author");
  await files.write("/old/a", new Uint8Array([3]));
  await files.write("/old/deep/b", new Uint8Array([4]));
  await files.write("/target/a", new Uint8Array([5]));
  await storage.inviteShare(share.id, "author", "filer", "read");
  await storage.joinShare(share.id, "filer");
  await storage.filerShareReference("filer", owner, "/data/filer/a", share.id, "/old/a");
  await assertRejects(() => storage.filerShareSubfolderRename("filer", owner, share.id, "/old", "/new"));
  await storage.leaveShare(share.id, "filer");
  await storage.inviteShare(share.id, "author", "filer", "write");
  await storage.joinShare(share.id, "filer");
  await assertRejects(() => storage.filerShareSubfolderRename("filer", owner, share.id, "/old", "/target"));
  assertEquals(await files.read("/old/a"), new Uint8Array([3]));
  await storage.filerShareSubfolderRename("filer", owner, share.id, "/old", "/new");
  const rows = await storage.filerShareList("filer", owner, "/data/filer");
  assertEquals("share" in rows[0].row && rows[0].row.path, "/new/a");
  assertEquals(await files.read("/new/deep/b"), new Uint8Array([4]));
  await storage.filerShareSubfolderDelete("filer", owner, share.id, "/new");
  assertEquals(await storage.filerShareList("filer", owner, "/data/filer"), []);
  assertEquals(await files.read("/new/a"), undefined);
  assertEquals(await files.read("/target/a"), new Uint8Array([5]));
});

Deno.test("共有元が削除した参照は退出を妨げず、有効な参照は保持する", async () => {
  let now = 1_000;
  const storage = createMemoryStorage({ now: () => now });
  const owner = await storage.appOwner("filer");
  const share = await storage.createShare("author", "資料");
  const files = storage.shareFiles(share.id, "author");
  await files.write("/gone", new Uint8Array([1]));
  await files.write("/tombstone", new Uint8Array([2]));
  await files.write("/keep", new Uint8Array([3]));
  await storage.inviteShare(share.id, "author", "filer", "read");
  await storage.joinShare(share.id, "filer");
  for (const name of ["gone", "tombstone", "keep"]) await storage.filerShareReference("filer", owner, `/data/filer/${name}`, share.id, `/${name}`);
  await files.delete("/gone");
  now += 31 * 24 * 60 * 60 * 1000;
  await storage.gc(now);
  await files.delete("/tombstone");
  await storage.filerShareFolderLeave("filer", owner, share.id);
  assertEquals((await storage.getShare(share.id))!.members.filer, undefined);
  assertEquals(await storage.forOwner(owner).read("/data/filer/keep"), new Uint8Array([3]));
  assertEquals((await storage.filerShareList("filer", owner, "/data/filer")).map(row => row.path), ["/data/filer/keep"]);
  assertEquals(await files.read("/keep"), new Uint8Array([3]));
});
