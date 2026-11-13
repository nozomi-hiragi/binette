import { assertEquals } from "@std/assert";
import { NotificationClock } from "../src/notification-clock.ts";

Deno.test("minute ticks and popup expiry follow the injected clock", () => {
  let now = 12_345;
  let next = 0;
  let changes = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const later = ((run: () => void, delay = 0) => { const id = ++next; timers.set(id, { at: now + delay, run }); return id; }) as typeof setTimeout;
  const cancel = ((id: number) => { timers.delete(id); }) as typeof clearTimeout;
  const advance = (ms: number) => {
    const end = now + ms;
    while (true) {
      const entry = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry || entry[1].at > end) break;
      timers.delete(entry[0]); now = entry[1].at; entry[1].run();
    }
    now = end;
  };
  const clock = new NotificationClock(() => { changes++; }, () => now, later, cancel);
  clock.arrive(1, false);
  advance(4_999); assertEquals(clock.isPopup(1), true);
  clock.keep(1, true); advance(10_000); assertEquals(clock.isPopup(1), true);
  clock.keep(1, false); advance(5_000); assertEquals(clock.isPopup(1), false);
  clock.arrive(2, false); clock.arrive(3, true); advance(20_000);
  assertEquals([clock.isPopup(2), clock.isPopup(3)], [false, true]);
  advance(7_656); assertEquals(changes, 2); // popup expiry and the tick at 60,000
  clock.remove(3); assertEquals(clock.isPopup(3), false);
  clock.stop(); assertEquals(timers.size, 0);
});
