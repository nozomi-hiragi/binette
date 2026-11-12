import { assertEquals } from "@std/assert";
import { createMemoryPigeonStore, PIGEON_HISTORY_LIMIT, PIGEON_INBOX_LIMIT, type PigeonLetter } from "../src/index.ts";

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

Deno.test("ユーザー宛ての手紙は時刻と開封の印つきで残し、新しい方から上限まで保つ", async () => {
  const store = createMemoryPigeonStore();
  const letter = (body: number): PigeonLetter => ({ id: 0, from: "sender", to: "user", kind: "chat", title: "題", body: String(body) });
  for (let i = 0; i < PIGEON_HISTORY_LIMIT + 5; i++) await store.record(letter(i), 1000 + i);
  const saved = await store.history();
  assertEquals(saved.length, PIGEON_HISTORY_LIMIT);
  assertEquals([saved[0]!.body, saved[0]!.time, saved[0]!.opened], ["5", 1005, false]);
  assertEquals(new Set(saved.map(letter => letter.id)).size, PIGEON_HISTORY_LIMIT);
  saved[0]!.body = "変更";
  assertEquals((await store.history())[0]!.body, "5");
  await store.open([saved[0]!.id, saved[1]!.id, -1]);
  assertEquals((await store.history()).filter(letter => letter.opened).map(letter => letter.body), ["5", "6"]);
  await store.forget([saved[0]!.id]);
  assertEquals((await store.history())[0]!.body, "6");
  assertEquals(await store.read("user"), []);
  await store.forget();
  assertEquals(await store.history(), []);
});
