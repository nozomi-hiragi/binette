// deno-lint-ignore-file no-import-prefix no-unversioned-import
import { Api, App, Last, OsApi, SchedulerApi } from "jsr:@binette/replique";
import { View, button, buttonOf, column, listTile, row, show, text } from "jsr:@binette/replique-ui@^0.1";

const names = ["stackSize", "stopDelay", "historyLimit", "callTimeout", "destroyTimeout", "homeRetryWindow"];
const labels = ["スタックできるアプリの数", "Stop までの時間", "起動の履歴の最大の行数", "呼び出しの時間切れ", "onDestroy の時間切れ", "Apps を出すまでの時間"];
const steps: i32[] = [1, 1000, 10, 1000, 1000, 1000];
const minimums: i32[] = [1, 0, 0, 1000, 1000, 0];

function pad(value: i64, width: i32 = 2): string {
  let result = value.toString();
  while (result.length < width) result = "0" + result;
  return result;
}

// Unix epoch の日数をグレゴリオ暦に直す。負の日時とうるう年も扱う
function utc(time: f64): string {
  const seconds = <i64>Math.floor(time / 1000);
  const days = <i64>Math.floor(<f64>seconds / 86400);
  const within = seconds - days * 86400;
  const z = days + 719468;
  const era = (z >= 0 ? z : z - 146096) / 146097;
  const doe = z - era * 146097;
  const yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  let year = yoe + era * 400;
  const doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const mp = (5 * doy + 2) / 153;
  const day = doy - (153 * mp + 2) / 5 + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  if (month <= 2) year++;
  return pad(year, 4) + "-" + pad(month) + "-" + pad(day) + " " + pad(within / 3600) + ":" + pad(within / 60 % 60) + ":" + pad(within % 60);
}

// 辞書から取った API。ボタンのコールバックは関数なので、グローバルで持つ
let osApi: OsApi | null = null;
let schedulerApi: SchedulerApi | null = null;
// 間隔の予定の − ＋ で選べる値（秒）
const intervals: i32[] = [60, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400];
let details = false;

function showDetails(): void { details = true; }
function chooseHome(index: i32): void {
  const os = osApi;
  if (os == null) return;
  os.assign("home", index);
}
function chooseCadre(index: i32): void {
  const os = osApi;
  if (os == null) return;
  os.assign("cadre", index);
}
function update(): void {
  const os = osApi;
  if (os == null) return;
  os.update();
}
function openRecovery(): void {
  const os = osApi;
  if (os != null) os.openRecovery();
}
function checkUpdate(): void {
  const os = osApi;
  if (os != null) os.checkUpdate();
}
function toggleNotification(index: i32): void {
  const os = osApi;
  if (os != null) os.setNotificationMuted(index, !os.notificationMuted(index));
}
function change(change: i32): void {
  const os = osApi;
  if (os == null) return;
  const i = change / 2;
  const value = os.get(names[i]);
  // i32 の上限を越える加算もしない
  const next = <i64>value + (change % 2 == 0 ? -steps[i] : steps[i]);
  if (next < minimums[i] || next > 2147483647) return;
  os.set(names[i], <i32>next);
}

function minimumEvery(owner: string): i32 { return owner == "os" ? 60 : 900; }
// 今の間隔から、表の 1 つ下（-1）か上（+1）の値。無ければ 0
function stepEvery(current: i32, owner: string, direction: i32): i32 {
  if (direction < 0) {
    for (let k = intervals.length - 1; k >= 0; k--) if (intervals[k] < current && intervals[k] >= minimumEvery(owner)) return intervals[k];
  } else {
    for (let k = 0; k < intervals.length; k++) if (intervals[k] > current) return intervals[k];
  }
  return 0;
}
function changeEvery(change: i32): void {
  const s = schedulerApi;
  if (s == null) return;
  const i = change / 2;
  if (i >= s.count()) return;
  const next = stepEvery(s.every(i), s.owner(i), change % 2 == 0 ? -1 : 1);
  if (next > 0) s.update(s.id(i), "{\"every\":" + next.toString() + "}");
}
function toggleSchedule(i: i32): void {
  const s = schedulerApi;
  if (s != null && i < s.count()) s.setEnabled(s.id(i), !s.enabled(i));
}
function runSchedule(i: i32): void {
  const s = schedulerApi;
  if (s != null && i < s.count()) s.runNow(s.id(i));
}
function scheduleView(s: SchedulerApi, i: i32): View {
  const label = s.label(i);
  const title = s.owner(i) == "os" ? label : s.ownerName(i) + (label.length > 0 ? "　" + label : "");
  const enabled = s.enabled(i);
  const running = s.running(i);
  const next = s.next(i);
  const last = s.lastTime(i);
  const result = s.lastResult(i);
  let detail = s.description(i);
  if (!enabled) detail += "・止めています";
  else if (running) detail += "・実行中…";
  else if (next.length > 0) detail += "・次 " + next;
  const lastLine = last.length > 0 ? "前回 " + last + "（" + (result == "ok" ? "成功" : result) + "）" : "まだ実行していません";
  const every = s.every(i);
  const owner = s.owner(i);
  const controls: View[] = [];
  if (every > 0) controls.push(row([
    button("−", changeEvery).arg(i * 2).enabled(stepEvery(every, owner, -1) > 0).label(title + "の間隔を短くする"),
    text(s.description(i)).key("schedule-every"),
    button("＋", changeEvery).arg(i * 2 + 1).enabled(stepEvery(every, owner, 1) > 0).label(title + "の間隔を長くする"),
  ]).key("stepper"));
  controls.push(button(enabled ? "止める" : "再開する", toggleSchedule).arg(i).variant("subtle").label(title + "を" + (enabled ? "止める" : "再開する")).key("schedule-toggle"));
  controls.push(button("今すぐ実行", runSchedule).arg(i).variant("subtle").enabled(!running).label(title + "を今すぐ実行する").key("schedule-run"));
  return column([
    listTile(title, detail).key("schedule-summary"),
    text(lastLine).small().tone(result.startsWith("error") ? "danger" : "muted").key("schedule-last"),
    row(controls).key("schedule-controls"),
  ]).key("schedule-" + s.id(i));
}

export class Settings extends App {
  override onCreate(_last: Last, api: Api): void {
    osApi = OsApi.from(api);
    schedulerApi = SchedulerApi.from(api);
  }

  override build(): View {
    const os = osApi;
    if (os == null) return column([text("設定を使えません。")]).padding(16).key("settings-unavailable");
    const available = os.updateAvailable() ? true : false;
    const phase = os.updatePhase();
    const updating = phase == "applying";
    const checking = phase == "checking";
    const downloading = phase == "downloading";
    const next = os.updateNext();
    let status = "最新の版です。";
    if (phase == "check-failed") status = "確認に失敗";
    else if (phase == "download-failed") status = "ダウンロードに失敗";
    else if (phase == "apply-failed") status = "更新に失敗";
    else if (updating) status = "更新しています。完了すると再読み込みします。";
    else if (checking) status = "確認しています…";
    else if (downloading) status = "ダウンロード中…";
    else if (available) status = "Binette の新しい版があります。";
    const homes: View[] = [];
    for (let i: i32 = 0; i < os.candidateCount("home"); i++) {
      const selected = os.candidateId("home", i) == os.role("home");
      homes.push(buttonOf([
        text(os.candidateName("home", i)).grow(),
        text(selected ? "✓" : "").tone("accent").key("selection-mark"),
      ], chooseHome).arg(i).selected(selected).label(os.candidateName("home", i) + (selected ? "（使用中）" : "をホームにする")).key("home-" + i.toString()));
    }
    const cadres: View[] = [];
    for (let i: i32 = 0; i < os.candidateCount("cadre"); i++) {
      const selected = os.candidateId("cadre", i) == os.role("cadre");
      cadres.push(buttonOf([
        text(os.candidateName("cadre", i)).grow(),
        text(selected ? "✓" : "").tone("accent").key("selection-mark"),
      ], chooseCadre).arg(i).selected(selected).label(os.candidateName("cadre", i) + (selected ? "（使用中）" : "を Cadre にする")).key("cadre-" + i.toString()));
    }
    const notifications: View[] = [];
    for (let i: i32 = 0; i < os.notificationCount(); i++) {
      const name = os.notificationName(i);
      const muted = os.notificationMuted(i);
      notifications.push(listTile(name, muted ? "通知を停止中" : "通知を許可", null,
        button(muted ? "許可する" : "停止する", toggleNotification).arg(i).variant("subtle")
          .label(name + "の通知を" + (muted ? "許可する" : "停止する")),
      ).key("notification-setting-" + os.notificationId(i)));
    }
    const debug: View[] = [];
    for (let i: i32 = 0; i < names.length; i++) {
      const value = os.get(names[i]);
      const seconds = value % 1000 == 0 ? (value / 1000).toString() : (<f64>value / 1000).toString();
      debug.push(row([
        text(labels[i]).grow().key("debug-label"),
        row([
          row([
            button("−", change).arg(i * 2).enabled(<i64>value - steps[i] >= minimums[i]).label(labels[i] + "を減らす"),
            text(steps[i] == 1000 ? seconds + " 秒" : value.toString()).key("settings-value-" + i.toString()),
            button("＋", change).arg(i * 2 + 1).enabled(<i64>value + steps[i] <= 2147483647).label(labels[i] + "を増やす"),
          ]).key("stepper"),
        ]).key("debug-controls"),
      ]).key("settings-row-" + i.toString()));
    }
    const schedules: View[] = [];
    const scheduler = schedulerApi;
    if (scheduler != null) for (let i: i32 = 0; i < scheduler.count(); i++) schedules.push(scheduleView(scheduler, i));
    const history: View[] = [];
    for (let i: i32 = 0; i < os.launchCount(); i++) {
      history.push(listTile(os.launchName(i), utc(os.launchTime(i))).key("launch-" + i.toString()));
    }
    return column([
      column([
        text("設定").heading(1).key("settings-title"),
      ]).key("settings-header"),
      column([
        text("Binette について").heading(2).key("about-title"),
        column([
          listTile("Binette", "仕様の版 0.2", text("B").key("about-icon"), button("詳しく", showDetails).variant("subtle").enabled(!details).key("details")),
          show(details, text("ブラウザだけで動く、アプリの土台です。").tone("muted").key("description")),
        ]).surface("card").key("about-card"),
      ]).key("about-section"),
      column([
        text("更新").heading(2).key("update-title"),
        column([
          listTile("ソフトウェア・アップデート", status).key("update-status"),
          text(os.updateCurrent() + (next.length > 0 ? " → " + next : "")).small().tone("muted").key("update-version"),
          row([
            show(available || updating, button(updating ? "更新中…" : "更新", update).variant("primary").enabled(available && !updating).key("update")),
            button(phase == "download-failed" ? "再試行" : "今すぐ確認", checkUpdate).variant("subtle").enabled(!checking && !downloading && !updating).key("check-update"),
            button("復旧画面を開く", openRecovery).variant("subtle").key("open-recovery"),
          ]).key("update-actions"),
        ]).surface("card").key("update-card"),
      ]).key("update-section"),
      column([text("ホーム").heading(2).key("home-title"), column(homes).surface("card").key("homes")]).key("home-section"),
      column([text("Cadre").heading(2).key("cadre-title"), column(cadres).surface("card").key("cadres")]).key("cadre-section"),
      column([text("通知").heading(2), column(notifications).surface("card").key("notifications-card")]).key("notifications-section"),
      show(scheduler != null, column([
        text("定期実行").heading(2).key("schedules-title"),
        column([
          show(schedules.length == 0, text("予定はありません。").tone("muted").key("schedules-empty")),
          column(schedules).key("schedules"),
        ]).surface("card").key("schedules-card"),
      ]).key("schedules-section")),
      column([text("デバッグ").heading(2).key("debug-title"), column(debug).surface("card").key("debug")]).key("debug-section"),
      column([
        row([text("起動の履歴").heading(2).grow().key("history-title"), text("UTC").small().tone("muted")]),
        column([
          show(history.length == 0, text("起動の履歴はありません。").tone("muted").key("history-empty")),
          column(history).list().key("history"),
        ]).surface("card").key("history-card"),
      ]).key("history-section"),
    ]).key("settings-root");
  }
}

