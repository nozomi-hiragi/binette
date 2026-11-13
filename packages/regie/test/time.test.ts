import { assertEquals } from "@std/assert";
import { formatClock, formatDate, formatNotificationTime, formatTime, systemTimeZone } from "../src/time.ts";

Deno.test("formatTime は指定したタイムゾーンの日時を返す", () => {
  const time = Date.UTC(2026, 10, 11, 20, 5, 9);
  assertEquals(formatTime(time, { timeZone: "UTC" }), "2026-11-11 20:05");
  assertEquals(formatTime(time, { timeZone: "Asia/Tokyo" }), "2026-11-12 05:05");
  assertEquals(formatTime(time, { timeZone: "America/New_York", seconds: true }), "2026-11-11 15:05:09");
  assertEquals(formatTime(Date.UTC(2026, 0, 1, 0, 0, 0), { timeZone: "UTC", seconds: true }), "2026-01-01 00:00:00");
  assertEquals(formatTime(-1, { timeZone: "UTC", seconds: true }), "1969-12-31 23:59:59");
  assertEquals(formatTime(Number.NaN), "");
});

Deno.test("formatDate は指定したタイムゾーンの日付を返す", () => {
  const time = Date.UTC(2026, 0, 4, 20, 0);
  assertEquals(formatDate(time, "UTC"), "2026/1/4");
  assertEquals(formatDate(time, "Asia/Tokyo"), "2026/1/5");
});

Deno.test("既定のタイムゾーンは実行環境の設定に従う", () => {
  assertEquals(systemTimeZone(), Intl.DateTimeFormat().resolvedOptions().timeZone);
  const time = Date.UTC(2026, 5, 1, 12, 0);
  assertEquals(formatTime(time), formatTime(time, { timeZone: systemTimeZone() }));
});

Deno.test("notification times change format at each boundary", () => {
  const now = Date.UTC(2026, 10, 13, 12, 0);
  assertEquals(formatClock(now, "Asia/Tokyo"), "21:00");
  assertEquals(formatNotificationTime(now - 59_999, now, "UTC"), "たった今");
  assertEquals(formatNotificationTime(now - 60_000, now, "UTC"), "1 分前");
  assertEquals(formatNotificationTime(now - 3_599_999, now, "UTC"), "59 分前");
  assertEquals(formatNotificationTime(now - 3_600_000, now, "UTC"), "1 時間前");
  assertEquals(formatNotificationTime(now - 86_399_999, now, "UTC"), "23 時間前");
  assertEquals(formatNotificationTime(now - 86_400_000, now, "Asia/Tokyo"), "11-12 21:00");
  assertEquals(formatNotificationTime(now + 1, now, "UTC"), "たった今");
});
