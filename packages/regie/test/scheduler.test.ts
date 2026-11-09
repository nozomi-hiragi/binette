import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { createMemoryAppStore, createScheduler, nextScheduleTime, parseScheduleRule, startSystem, type SavedSchedule } from "../src/index.ts";

const local = (year: number, month: number, day: number, hours = 0, minutes = 0) => new Date(year, month - 1, day, hours, minutes).getTime();
const minute = 60_000;

function memoryStore(initial: Record<string, SavedSchedule> = {}) {
  let saved = structuredClone(initial);
  let writes = 0;
  return {
    getSchedules: () => Promise.resolve(structuredClone(saved)),
    putSchedules: (value: Record<string, SavedSchedule>) => { saved = structuredClone(value); writes++; return Promise.resolve(); },
    get saved() { return saved; },
    get writes() { return writes; },
  };
}

const until = async (condition: () => boolean) => {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("待っても変わりませんでした");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

Deno.test("予定の形は決まった形だけを受け、every の下限を確かめる", () => {
  assertEquals(parseScheduleRule({ every: 900 }), { every: 900 });
  assertEquals(parseScheduleRule({ every: 60 }, 60), { every: 60 });
  assertEquals(parseScheduleRule({ at: "2026-11-10T09:00" }), { at: "2026-11-10T09:00" });
  assertEquals(parseScheduleRule({ daily: "07:30" }), { daily: "07:30" });
  assertEquals(parseScheduleRule({ weekly: { days: ["mon", "thu"], time: "07:30" } }), { weekly: { days: ["mon", "thu"], time: "07:30" } });
  assertEquals(parseScheduleRule({ monthly: { day: 31, time: "00:00" } }), { monthly: { day: 31, time: "00:00" } });
  for (const rule of [
    { every: 899 }, { every: 1.5 }, { at: "2026-02-30T09:00" }, { at: "2026-11-10 09:00" }, { daily: "24:00" }, { daily: "7:30" },
    { weekly: { days: [], time: "07:30" } }, { weekly: { days: ["mon", "mon"], time: "07:30" } }, { weekly: { days: ["月"], time: "07:30" } },
    { monthly: { day: 0, time: "00:00" } }, { monthly: { day: 1, time: "00:00", extra: 1 } }, { cron: "* * * * *" }, { every: 900, daily: "07:30" }, null,
  ]) assertThrows(() => parseScheduleRule(rule), Error);
});

Deno.test("次の時刻は前回のあとで最初に来る時刻をローカル時刻で出す", () => {
  const after = local(2026, 11, 9, 8, 0); // 月曜
  assertEquals(nextScheduleTime({ every: 1800 }, after), after + 30 * minute);
  assertEquals(nextScheduleTime({ daily: "07:30" }, after), local(2026, 11, 10, 7, 30));
  assertEquals(nextScheduleTime({ daily: "08:30" }, after), local(2026, 11, 9, 8, 30));
  assertEquals(nextScheduleTime({ daily: "08:00" }, after), local(2026, 11, 10, 8, 0));
  assertEquals(nextScheduleTime({ weekly: { days: ["mon"], time: "08:00" } }, after), local(2026, 11, 16, 8, 0));
  assertEquals(nextScheduleTime({ weekly: { days: ["sun", "thu"], time: "07:00" } }, after), local(2026, 11, 12, 7, 0));
  assertEquals(nextScheduleTime({ monthly: { day: 31, time: "00:00" } }, after), local(2026, 11, 30, 0, 0));
  assertEquals(nextScheduleTime({ monthly: { day: 9, time: "07:00" } }, after), local(2026, 12, 9, 7, 0));
  assertEquals(nextScheduleTime({ monthly: { day: 31, time: "00:00" } }, local(2027, 2, 1)), local(2027, 2, 28, 0, 0));
  assertEquals(nextScheduleTime({ at: "2026-11-10T09:00" }, after), local(2026, 11, 10, 9, 0));
  assertEquals(nextScheduleTime({ at: "2026-11-09T07:00" }, after), undefined);
});

Deno.test("登録してすぐには走らず、前回＋間隔を過ぎたら 1 回だけ実行して前回を更新する", async () => {
  let time = local(2026, 11, 9, 8, 0);
  const store = memoryStore();
  const scheduler = await createScheduler({ store, now: () => time, maxWait: 5 });
  let runs = 0;
  try {
    scheduler.register({ id: "os/update", owner: "os", label: "OS の更新確認", rule: { every: 1800 }, run: () => { runs++; } });
    scheduler.start();
    await new Promise(resolve => setTimeout(resolve, 30));
    assertEquals(runs, 0);
    assertEquals(scheduler.list()[0].next, time + 30 * minute);
    time += 3 * 60 * minute; // 何回分も過ぎた
    await until(() => runs === 1);
    await new Promise(resolve => setTimeout(resolve, 30));
    assertEquals(runs, 1);
    await until(() => store.saved["os/update"]?.last !== undefined);
    assertEquals(store.saved["os/update"].last, { time, result: "ok" });
    assertEquals(scheduler.list()[0].next, time + 30 * minute);
  } finally { scheduler.stop(); }
});

Deno.test("保存した予定は再起動しても残り、登録の初期値より強い", async () => {
  const registered = local(2026, 11, 9, 8, 0);
  const store = memoryStore({ "os/update": { owner: "os", rule: { daily: "07:30" }, enabled: false, registered, last: { time: registered, result: "ok" } } });
  const scheduler = await createScheduler({ store, now: () => registered + minute });
  try {
    scheduler.register({ id: "os/update", owner: "os", label: "OS の更新確認", rule: { every: 1800 }, run() {} });
    const [info] = scheduler.list();
    assertEquals(info.rule, { daily: "07:30" });
    assertEquals(info.enabled, false);
    assertEquals(info.next, undefined);
    assertEquals(info.label, "OS の更新確認");
    await scheduler.update("os/update", { enabled: true });
    assertEquals(scheduler.list()[0].next, local(2026, 11, 10, 7, 30));
    await assertRejects(() => scheduler.update("os/update", { rule: { every: 30 } }), Error, "60 以上");
    await scheduler.update("os/update", { rule: { every: 60 } });
    assertEquals(store.saved["os/update"].rule, { every: 60 });
  } finally { scheduler.stop(); }
});

Deno.test("今すぐ実行は止めていても動き、失敗は結果に残す。at は実行後に止まる", async () => {
  const time = local(2026, 11, 9, 8, 0);
  const store = memoryStore();
  const scheduler = await createScheduler({ store, now: () => time });
  let changes = 0;
  scheduler.subscribe(() => { changes++; });
  try {
    scheduler.register({ id: "os/fail", owner: "os", rule: { every: 60 }, run() { throw new Error("つながらない"); } });
    scheduler.register({ id: "os/once", owner: "os", rule: { at: "2026-11-10T09:00" }, run() {} });
    await scheduler.update("os/fail", { enabled: false });
    await scheduler.runNow("os/fail");
    assertEquals(scheduler.list().find(info => info.id === "os/fail")?.last, { time, result: "error: つながらない" });
    await scheduler.runNow("os/once");
    const once = scheduler.list().find(info => info.id === "os/once")!;
    assertEquals(once.enabled, false);
    assertEquals(once.next, undefined);
    assert(changes > 0);
    await assertRejects(() => scheduler.runNow("os/none"), Error, "ありません");
    assertThrows(() => scheduler.register({ id: "os/once", owner: "os", rule: { every: 60 }, run() {} }), Error, "もう登録");
  } finally { scheduler.stop(); }
});

Deno.test("実行は 1 つずつ順番に行う", async () => {
  let time = local(2026, 11, 9, 8, 0);
  const scheduler = await createScheduler({ store: memoryStore(), now: () => time, maxWait: 5 });
  const order: string[] = [];
  let active = 0;
  const job = (id: string) => ({ id, owner: "os", rule: { every: 60 }, async run() {
    active++; assertEquals(active, 1); order.push(id);
    await new Promise(resolve => setTimeout(resolve, 10)); active--;
  } });
  try {
    scheduler.register(job("os/a"));
    scheduler.register(job("os/b"));
    scheduler.start();
    time += 2 * minute;
    await until(() => order.length === 2);
    assertEquals(order.sort(), ["os/a", "os/b"]);
  } finally { scheduler.stop(); }
});

Deno.test("システムは os/catalogs を登録し、stop で外す。保存先は SystemStore", async () => {
  const store = createMemoryAppStore();
  const system = await startSystem({ apps: [], store, ui: { present: () => ({ remove() {} }), update() {}, report() {} } });
  try {
    const [info] = system.scheduler.list();
    assertEquals([info.id, info.owner, info.label, info.rule], ["os/catalogs", "os", "カタログの更新確認", { every: 1800 }]);
    await system.scheduler.runNow("os/catalogs");
    assertEquals((await store.system.getSchedules())["os/catalogs"].last?.result, "ok");
  } finally { system.stop(); }
  assertEquals(system.scheduler.list(), []);
});
