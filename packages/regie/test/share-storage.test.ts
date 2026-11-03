import { assertEquals, assertRejects } from "@std/assert";
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
