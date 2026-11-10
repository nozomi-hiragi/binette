// deno-lint-ignore-file no-import-prefix no-unversioned-import no-namespace
import { Api, application, created } from "jsr:@binette/replique/app";
import { rebuild } from "jsr:@binette/replique/ui";

namespace hostSchedule {
  // @ts-ignore: decorator
  @external("binette", "schedule.text")
  export declare function text(query: string, slot: i32): string;
  // @ts-ignore: decorator
  @external("binette", "schedule.number")
  export declare function number(query: string, slot: i32): f64;
  // @ts-ignore: decorator
  @external("binette", "schedule.do")
  export declare function act(action: string, slot: i32, rule: string, label: string): bool;
}

/**
 * `api.get<ScheduleApi>("schedule")`。自分の予定（定期実行）。app.json の permissions に `schedule` を書いたアプリにだけ届く。
 * 予定は枠番号（0 から）で指す。今の枠は 0 だけで、枠の外の番号には何もせず false を返す。
 * 予定の形は JSON の文字列（例 `{"every":1800}`、`{"daily":"07:30"}`）。`every` は 900 秒以上。
 * 予定の時刻が来ると、OS が `App.onSchedule(slot, api)` を呼ぶ。
 */
export class ScheduleApi {
  /** 枠の数 */
  count(): i32 { return <i32>hostSchedule.number("count", 0); }
  /** その枠が空いているときだけ登録する。すでにあるか、形が正しくなければ何もせず false。起動のたびに呼んでも、ユーザーが変えた値は消えない */
  register(slot: i32, rule: string, label: string = ""): bool { return hostSchedule.act("register", slot, rule, label); }
  /** その枠に予定があるときだけ形を変える */
  update(slot: i32, rule: string): bool { return hostSchedule.act("update", slot, rule, ""); }
  remove(slot: i32): bool { return hostSchedule.act("remove", slot, "", ""); }
  /** 止めていても今すぐ実行する */
  runNow(slot: i32): bool { return hostSchedule.act("runNow", slot, "", ""); }
  exists(slot: i32): bool { return hostSchedule.number("exists", slot) != 0; }
  /** 予定の形の JSON。無ければ空 */
  rule(slot: i32): string { return hostSchedule.text("rule", slot); }
  label(slot: i32): string { return hostSchedule.text("label", slot); }
  enabled(slot: i32): bool { return hostSchedule.number("enabled", slot) != 0; }
  /** 前回の実行（Unix epoch ミリ秒）。まだなら 0 */
  lastTime(slot: i32): f64 { return hostSchedule.number("lastTime", slot); }
  /** `ok` か `error: …`。まだなら空 */
  lastResult(slot: i32): string { return hostSchedule.text("lastResult", slot); }
}

/** OS が予定の実行を知らせる。画面なしの起動では描かない */
export function __bina_schedule(slot: i32): void {
  const app = application;
  if (app === null) return;
  app.onSchedule(slot, new Api());
  if (created) rebuild();
}
