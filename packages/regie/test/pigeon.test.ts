import { assertEquals } from "@std/assert";
import { createMemoryPigeonStore, PIGEON_INBOX_LIMIT, type PigeonLetter } from "../src/index.ts";

Deno.test("受信欄はアプリで分離し、古い順に上限を適用して ID で消す", async () => {
  const store = createMemoryPigeonStore();
  const letter = (id: number): PigeonLetter => ({ id, from: "sender", to: "receiver", kind: "open", title: "題", body: String(id) });
  await Promise.all(Array.from({ length: 105 }, (_, id) => store.append("receiver", letter(id))));
  assertEquals((await store.read("receiver")).length, PIGEON_INBOX_LIMIT);
  assertEquals((await store.read("receiver"))[0]!.id, 6);
  const snapshot = await store.read("receiver");
  snapshot[0]!.body = "変更";
  assertEquals((await store.read("receiver"))[0]!.body, "5");
  await store.done("receiver", 6);
  assertEquals((await store.read("receiver")).some(letter => letter.id === 6), false);
  assertEquals(await store.read("other"), []);
  await store.mute("receiver", true);
  assertEquals(await store.muted("receiver"), true);
  assertEquals(await store.muted("other"), false);
});
