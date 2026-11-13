// deno-lint-ignore-file no-import-prefix no-unversioned-import
import { Api, App, Last, OsApi, SchedulerApi } from "jsr:@binette/replique";
import { View, button, buttonOf, column, input, listTile, row, segmented, show, text } from "jsr:@binette/replique-ui@^0.1";

const names = ["stackSize", "stopDelay", "historyLimit", "callTimeout", "destroyTimeout", "homeRetryWindow"];
const labels = ["スタックできるアプリの数", "Stop までの時間", "起動の履歴の最大の行数", "呼び出しの時間切れ", "onDestroy の時間切れ", "Apps を出すまでの時間"];
const steps: i32[] = [1, 1000, 10, 1000, 1000, 1000];
const minimums: i32[] = [1, 0, 0, 1000, 1000, 0];

// 辞書から取った API。ボタンのコールバックは関数なので、グローバルで持つ
let osApi: OsApi | null = null;
let schedulerApi: SchedulerApi | null = null;
// 間隔の予定の − ＋ で選べる値（秒）
const intervals: i32[] = [60, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400];
let details = false;
// 開いている項目。-1 は未選択で、広い幅では先頭の項目を見せ、狭い幅では項目の一覧だけを見せる
let page: i32 = -1;
const pageTitles = ["見た目", "既定のアプリ", "通知", "定期実行", "Binette について", "デバッグ", "日付と時刻", "アプリ", "ネット"];
const pageKeys = ["open-appearance", "open-defaults", "open-notifications", "open-schedules", "open-about", "open-debug", "open-time", "open-apps", "open-net"];
let selectedApp = "";
let allowDraft = "";
let denyDraft = "";
function openPage(next: i32): void { page = next; selectedApp = ""; allowDraft = ""; denyDraft = ""; }
function backToTop(): void { page = -1; }
/** 項目の一覧の 1 行 */
function pageLink(index: i32, detail: string, current: i32): View {
  return buttonOf([listTile(pageTitles[index], detail, null, text("›").tone("muted").key("page-mark")).grow()], openPage)
    .arg(index).selected(index == current).label(pageTitles[index] + "を開く").key(pageKeys[index]);
}

// 見た目の番号と名前。色と絵は OS の入口のページが番号から決める
const accentNames = ["青", "緑", "紫", "桃", "橙", "灰"];
const wallpaperNames = ["なし", "そら", "あさやけ", "もり", "すみれ", "すな"];

function showDetails(): void { details = true; }
function chooseTheme(index: i32): void {
  const os = osApi;
  if (os != null) os.set("theme", index);
}
function chooseAccent(index: i32): void {
  const os = osApi;
  if (os != null) os.set("accent", index);
}
function chooseWallpaper(index: i32): void {
  const os = osApi;
  if (os != null) os.set("wallpaper", index);
}
function swatches(names: string[], current: i32, prefix: string, title: string, f: (index: i32) => void): View {
  const views: View[] = [];
  for (let i: i32 = 0; i < names.length; i++) {
    views.push(button("", f).arg(i).selected(i == current).label(title + " " + names[i] + (i == current ? "（使用中）" : "")).tip(names[i]).key(prefix + "-" + i.toString()));
  }
  return row(views).wrap().key(prefix + "-swatches");
}
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
  if (os != null) os.setAppMuted(os.appId(index), !os.appMuted(index));
}
function openApp(index: i32): void {
  const os = osApi;
  if (os != null) { selectedApp = os.appId(index); allowDraft = ""; denyDraft = ""; }
}
function backToApps(): void { selectedApp = ""; }
function editAllow(value: string): void { allowDraft = value; }
function editDeny(value: string): void { denyDraft = value; }
function netTarget(): string { return page == 8 ? "" : selectedApp; }
function approvePending(): void { if (osApi != null) osApi!.netDo("approvePending", selectedApp); }
function denyPending(): void { if (osApi != null) osApi!.netDo("denyPending", selectedApp); }
function addAllow(): void { const os = osApi; if (os != null) os.netDo("addAllow", netTarget(), allowDraft); }
function addDeny(): void { const os = osApi; if (os != null) os.netDo("addDeny", netTarget(), denyDraft); }
function removeAllow(i: i32): void {
  const os = osApi;
  if (os == null) return;
  const id = netTarget();
  const count = os.netCount("allow", id);
  os.netDo("removeAllow", id, i < count ? os.netUrl("allow", id, i) : os.netUrl("added", id, i - count));
}
function removeDeny(i: i32): void {
  const os = osApi;
  if (os != null) os.netDo("removeDeny", netTarget(), os.netUrl("deny", netTarget(), i));
}
function toggleNetQuiet(): void {
  const os = osApi;
  if (os != null) os.netQuiet(selectedApp, !os.netIsQuiet(selectedApp));
}
/** 通信先の一覧。アプリが足したものも allow の中で消せる。 */
function netViews(os: OsApi, id: string): View[] {
  const views: View[] = [];
  if (id.length > 0) {
    const pending: View[] = [];
    for (let i: i32 = 0; i < os.netCount("pending", id); i++) pending.push(text(os.netUrl("pending", id, i)).key("net-pending-" + i.toString()));
    views.push(show(pending.length > 0, column([text("確認待ちの要求 URL").heading(2), column(pending).surface("card").key("net-pending-list"), row([button("許可", approvePending).key("net-approve-pending"), button("拒否", denyPending).key("net-deny-pending")])]).key("net-pending-section")));
    const requests: View[] = [];
    for (let i: i32 = 0; i < os.netCount("request", id); i++) requests.push(text(os.netUrl("request", id, i)).key("net-request-" + i.toString()));
    views.push(column([text("要求 URL").heading(2), column(requests).surface("card").key("net-requests")]).key("net-request-section"));
  }
  const allow: View[] = [];
  const ownCount = os.netCount("allow", id);
  for (let i: i32 = 0; i < ownCount; i++) {
    const url = os.netUrl("allow", id, i);
    allow.push(listTile(url, "ユーザーが追加", null, button("消す", removeAllow).arg(i).variant("ghost").label(url + "を allow から消す").key("net-remove-allow-" + i.toString())).key("net-allow-" + i.toString()));
  }
  for (let i: i32 = 0; i < os.netCount("added", id); i++) {
    const url = os.netUrl("added", id, i);
    allow.push(listTile(url, "アプリが追加", null, button("消す", removeAllow).arg(ownCount + i).variant("ghost").label(url + "を allow から消す").key("net-remove-added-" + i.toString())).key("net-added-" + i.toString()));
  }
  views.push(column([
    text("allow").heading(2).key("net-allow-title"),
    show(id.length == 0, text("すべてのネットのアプリに許します").tone("muted").key("net-common-note")),
    column(allow).surface("card").key("net-allow-list"),
    row([input(allowDraft, editAllow).placeholder("https://…").label("allow に足す URL").grow().key("net-allow-input"), button("追加", addAllow).variant("subtle").label("allow に追加").key("net-add-allow")]).wrap(),
  ]).key("net-allow-section"));
  const deny: View[] = [];
  for (let i: i32 = 0; i < os.netCount("deny", id); i++) {
    const url = os.netUrl("deny", id, i);
    deny.push(listTile(url, "", null, button("消す", removeDeny).arg(i).variant("ghost").label(url + "を deny から消す").key("net-remove-deny-" + i.toString())).key("net-deny-" + i.toString()));
  }
  views.push(column([
    text("deny").heading(2).key("net-deny-title"),
    column(deny).surface("card").key("net-deny-list"),
    row([input(denyDraft, editDeny).placeholder("https://…").label("deny に足す URL").grow().key("net-deny-input"), button("追加", addDeny).variant("subtle").label("deny に追加").key("net-add-deny")]).wrap(),
  ]).key("net-deny-section"));
  if (id.length > 0) views.push(listTile("追加の通知を表に出す", "", null,
    button("追加の通知を表に出す", toggleNetQuiet).toggle(!os.netIsQuiet(id)).key("net-notify"),
  ).key("net-notify-row"));
  return views;
}
function showLetter(id: i32): void {
  const os = osApi;
  if (os != null) os.showLetter(id);
}
function openLetter(id: i32): void {
  const os = osApi;
  if (os != null) os.openLetter(id);
}
function deleteLetter(id: i32): void {
  const os = osApi;
  if (os != null) os.deleteLetter(id);
}
function openAllLetters(): void {
  const os = osApi;
  if (os != null) os.openAllLetters();
}
function deleteAllLetters(): void {
  const os = osApi;
  if (os != null) os.deleteAllLetters();
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

/** 役割に割り当てているアプリの名前。候補に無ければ空 */
function roleName(os: OsApi, role: string): string {
  const current = os.role(role);
  for (let i: i32 = 0; i < os.candidateCount(role); i++) if (os.candidateId(role, i) == current) return os.candidateName(role, i);
  return "";
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
    const letters: View[] = [];
    let unopened: i32 = 0;
    for (let i: i32 = 0; i < os.letterCount(); i++) {
      const id = os.letterId(i);
      const opened = os.letterOpened(i);
      const title = os.letterTitle(i);
      const body = os.letterBody(i);
      if (!opened) unopened++;
      const actions: View[] = [];
      if (!opened) actions.push(button("開封にする", openLetter).arg(id).variant("subtle").label(title + "を開封にする").key("letter-open"));
      actions.push(button("消す", deleteLetter).arg(id).variant("ghost").label(title + "を消す").key("letter-delete"));
      letters.push(column([
        row([
          text(opened ? "" : "●").small().tone("accent").label(opened ? "" : "未開封").key("letter-mark"),
          text(os.letterName(i)).small().tone("muted").grow().key("letter-from"),
          text(os.letterTime(i)).small().tone("muted").key("letter-time"),
        ]).key("letter-head"),
        buttonOf([
          show(title.length > 0, text(title).heading(3).key("letter-title")),
          show(body.length > 0, text(body).key("letter-body")),
        ], showLetter).arg(id).label((title.length > 0 ? title : body) + "の差出人を開く").key("letter-show"),
        row(actions).key("letter-actions"),
      ]).key("letter-" + id.toString()));
    }
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
      history.push(listTile(os.launchName(i), os.launchText(i)).key("launch-" + i.toString()));
    }
    // 定期実行が届いていないときは、その項目を出さない
    const current = page < 0 || (page == 3 && scheduler == null) ? 0 : page;
    const links: View[] = [
      pageLink(0, "テーマ・アクセント色・壁紙", current),
      pageLink(1, "ホーム: " + roleName(os, "home") + "・Cadre: " + roleName(os, "cadre"), current),
      pageLink(2, unopened > 0 ? "未開封 " + unopened.toString() + " 件" : "届いた通知", current),
    ];
    links.push(pageLink(7, "アプリごとの通知と通信先", current));
    links.push(pageLink(8, "全アプリ共通の通信先", current));
    if (scheduler != null) links.push(pageLink(3, schedules.length == 0 ? "予定はありません" : schedules.length.toString() + " 件の予定", current));
    const zone = os.timeZone();
    links.push(pageLink(6, zone, current));
    links.push(pageLink(4, status, current));
    links.push(pageLink(5, "動作の値と起動の履歴", current));
    const sections: View[] = [];
    if (current == 0) {
      sections.push(column([
        column([
          row([text("テーマ").grow(), segmented(["OS に合わせる", "ライト", "ダーク"], os.get("theme"), chooseTheme).label("テーマ").key("appearance-theme")]).wrap().key("appearance-theme-row"),
          row([text("アクセント色").grow(), swatches(accentNames, os.get("accent"), "accent", "アクセント色", chooseAccent)]).wrap().key("appearance-accent-row"),
          row([text("壁紙").grow(), swatches(wallpaperNames, os.get("wallpaper"), "wallpaper", "壁紙", chooseWallpaper)]).wrap().key("appearance-wallpaper-row"),
        ]).surface("card").key("appearance-card"),
      ]).key("appearance-section"));
    } else if (current == 1) {
      sections.push(column([text("ホーム").heading(2).key("home-title"), column(homes).surface("card").key("homes")]).key("home-section"));
      sections.push(column([text("Cadre").heading(2).key("cadre-title"), column(cadres).surface("card").key("cadres")]).key("cadre-section"));
    } else if (current == 2) {
      sections.push(column([
        row([
          text("届いた通知").heading(2).grow().key("letters-title"),
          show(unopened > 0, button("すべて開封にする", openAllLetters).variant("subtle").key("letters-open-all")),
          show(letters.length > 0, button("すべて消す", deleteAllLetters).variant("ghost").key("letters-delete-all")),
        ]).wrap().key("letters-head"),
        column([
          show(letters.length == 0, text("届いた通知はありません。").tone("muted").key("letters-empty")),
          column(letters).key("letters-list"),
        ]).surface("card").key("letters-card"),
        text("時刻は " + zone + " です。新しい方から 100 通まで残します。").small().tone("muted").key("letters-note"),
      ]).key("letters-section"));
    } else if (current == 3) {
      sections.push(column([
        column([
          show(schedules.length == 0, text("予定はありません。").tone("muted").key("schedules-empty")),
          column(schedules).key("schedules"),
        ]).surface("card").key("schedules-card"),
      ]).key("schedules-section"));
    } else if (current == 4) {
      sections.push(column([
        column([
          listTile("Binette", "仕様の版 0.2", text("B").key("about-icon"), button("詳しく", showDetails).variant("subtle").enabled(!details).key("details")),
          show(details, text("ブラウザだけで動く、アプリの土台です。").tone("muted").key("description")),
        ]).surface("card").key("about-card"),
      ]).key("about-section"));
      sections.push(column([
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
      ]).key("update-section"));
    } else if (current == 7) {
      if (selectedApp.length == 0) {
        const entries: View[] = [];
        for (let i: i32 = 0; i < os.appCount(); i++) entries.push(buttonOf([listTile(os.appName(i), os.appId(i)).grow()], openApp).arg(i).label(os.appName(i) + "の詳細を開く").key("app-" + os.appId(i)));
        sections.push(column(entries).surface("card").key("settings-apps"));
      } else {
        for (let i: i32 = 0; i < os.appCount(); i++) if (os.appId(i) == selectedApp) {
          sections.push(listTile(os.appName(i), selectedApp).key("app-summary"));
          if (os.appNotify(i)) sections.push(listTile("通知を許可", "", null,
            button("通知を許可", toggleNotification).arg(i).toggle(!os.appMuted(i)).key("app-notify"),
          ).key("app-notify-row"));
          if (os.appNet(i)) {
            const net = netViews(os, selectedApp);
            for (let j = 0; j < net.length; j++) sections.push(net[j]);
          }
        }
      }
    } else if (current == 8) {
      const net = netViews(os, "");
      for (let j = 0; j < net.length; j++) sections.push(net[j]);
    } else if (current == 6) {
      sections.push(column([
        column([
          listTile("タイムゾーン", "ブラウザの設定に合わせています。画面に出る日時は、すべてこのタイムゾーンで表します。", null, text(zone).key("time-zone-value")).key("time-zone"),
        ]).surface("card").key("time-card"),
      ]).key("time-section"));
    } else {
      sections.push(column([text("動作の値").heading(2).key("debug-title"), column(debug).surface("card").key("debug")]).key("debug-section"));
      sections.push(column([
        row([text("起動の履歴").heading(2).grow().key("history-title"), text(zone).small().tone("muted").key("history-zone")]),
        column([
          show(history.length == 0, text("起動の履歴はありません。").tone("muted").key("history-empty")),
          column(history).list().key("history"),
        ]).surface("card").key("history-card"),
      ]).key("history-section"));
    }
    const detail: View[] = [
      column([
        current == 7 && selectedApp.length > 0
          ? button("‹ アプリ", backToApps).variant("ghost").label("アプリの一覧に戻る").key("apps-back")
          : button("‹ 設定", backToTop).variant("ghost").label("設定の項目に戻る").key("settings-back"),
        text(pageTitles[current]).heading(1).key("settings-page-title"),
      ]).key("settings-page-header"),
    ];
    for (let i = 0; i < sections.length; i++) detail.push(sections[i]);
    // 広い幅は左に項目、右に中身。狭い幅は style.css が、未選択なら項目だけ、選んだあとは中身だけを見せる
    return column([
      row([
        column([
          column([text("設定").heading(1).key("settings-title")]).key("settings-header"),
          column(links).surface("card").label("設定の項目").key("settings-links-card"),
        ]).key("settings-menu"),
        column(detail).grow().key(page < 0 ? "settings-detail-idle" : "settings-detail"),
      ]).key("settings-split"),
    ]).key("settings-root");
  }
}

