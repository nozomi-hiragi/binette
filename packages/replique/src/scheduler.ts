// deno-lint-ignore-file no-namespace
namespace hostScheduler {
  // @ts-ignore: decorator
  @external("binette", "scheduler.text")
  export declare function text(query: string, i: i32): string;
  // @ts-ignore: decorator
  @external("binette", "scheduler.number")
  export declare function number(query: string, i: i32): f64;
  // @ts-ignore: decorator
  @external("binette", "scheduler.do")
  export declare function act(action: string, id: string, value: string, flag: bool): void;
}

/**
 * `api.get<SchedulerApi>("scheduler")`。OS とすべてのアプリの予定（定期実行）の一覧と操作。設定アプリにだけ届く。
 * 一覧は番号で数え、操作は予定の ID で指す。予定が変わると OS が `build()` をやり直させる。
 */
export class SchedulerApi {
  count(): i32 { return <i32>hostScheduler.number("count", 0); }
  id(i: i32): string { return hostScheduler.text("id", i); }
  /** `os` か完全なアプリ ID */
  owner(i: i32): string { return hostScheduler.text("owner", i); }
  /** 持ち主の表示名。OS は「OS」 */
  ownerName(i: i32): string { return hostScheduler.text("ownerName", i); }
  /** 表示名。無ければ空 */
  label(i: i32): string { return hostScheduler.text("label", i); }
  /** 予定の形の JSON（例 `{"every":1800}`） */
  rule(i: i32): string { return hostScheduler.text("rule", i); }
  /** 予定の形を読める文にしたもの（例「30 分ごと」「毎日 07:30」） */
  description(i: i32): string { return hostScheduler.text("description", i); }
  /** 間隔の予定なら秒、ほかは 0 */
  every(i: i32): i32 { return <i32>hostScheduler.number("every", i); }
  enabled(i: i32): bool { return hostScheduler.number("enabled", i) != 0; }
  running(i: i32): bool { return hostScheduler.number("running", i) != 0; }
  /** 次の実行（端末の時刻で「YYYY-MM-DD HH:MM」）。止めているときなどは空 */
  next(i: i32): string { return hostScheduler.text("nextText", i); }
  /** 前回の実行（端末の時刻）。まだなら空 */
  lastTime(i: i32): string { return hostScheduler.text("lastText", i); }
  /** `ok` か `error: …`。まだなら空 */
  lastResult(i: i32): string { return hostScheduler.text("lastResult", i); }
  /** 予定の形を変える（JSON） */
  update(id: string, rule: string): void { hostScheduler.act("update", id, rule, false); }
  setEnabled(id: string, on: bool): void { hostScheduler.act("setEnabled", id, "", on); }
  /** 止めていても今すぐ実行する */
  runNow(id: string): void { hostScheduler.act("runNow", id, "", false); }
}
