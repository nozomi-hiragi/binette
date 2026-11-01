// deno-lint-ignore-file no-import-prefix no-unversioned-import
import { Api, App, Last, OsApi, launch } from "jsr:@binette/replique";
import { View, button, buttonOf, column, listTile, row, show, text } from "jsr:@binette/replique/ui";

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
let details = false;
let updating = false;
function showDetails(): void { details = true; }
function chooseHome(index: i32): void {
  const os = osApi;
  if (os == null) return;
  os.assign("home", index);
}
function chooseShell(index: i32): void {
  const os = osApi;
  if (os == null) return;
  os.assign("shell", index);
}
function update(): void {
  const os = osApi;
  if (os == null || updating) return;
  updating = true;
  os.update();
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

class Settings extends App {
  override onCreate(_last: Last, api: Api): void { osApi = api.get<OsApi>("os"); }

  override build(): View {
    const os = osApi;
    if (os == null) return column([text("設定を使えません。")]).padding(16).key("settings-unavailable");
    const available = os.updateAvailable() ? true : false;
    const homes: View[] = [];
    for (let i: i32 = 0; i < os.candidateCount("home"); i++) {
      const selected = os.candidateId("home", i) == os.role("home");
      homes.push(buttonOf([
        text(os.candidateName("home", i)).grow(),
        text(selected ? "✓" : "").tone("accent").key("selection-mark"),
      ], chooseHome).arg(i).selected(selected).label(os.candidateName("home", i) + (selected ? "（使用中）" : "をホームにする")).key("home-" + i.toString()));
    }
    const shells: View[] = [];
    for (let i: i32 = 0; i < os.candidateCount("shell"); i++) {
      const selected = os.candidateId("shell", i) == os.role("shell");
      shells.push(buttonOf([
        text(os.candidateName("shell", i)).grow(),
        text(selected ? "✓" : "").tone("accent").key("selection-mark"),
      ], chooseShell).arg(i).selected(selected).label(os.candidateName("shell", i) + (selected ? "（使用中）" : "をシェルにする")).key("shell-" + i.toString()));
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
          listTile("Binette", "仕様の版 0.2", text("B").key("about-icon"), button("詳しく", showDetails).variant("ghost").enabled(!details).key("details")),
          show(details, text("ブラウザだけで動く、アプリの土台です。").tone("muted").key("description")),
        ]).surface("card").key("about-card"),
      ]).key("about-section"),
      column([
        text("更新").heading(2).key("update-title"),
        column([
          show(available, listTile("ソフトウェア・アップデート", updating ? "更新しています。完了すると再読み込みします。" : "Binette の新しい版があります。", null,
            button(updating ? "更新中…" : "更新", update).variant("primary").enabled(!updating).key("update")).key("update-box")),
          show(!available, listTile("ソフトウェア・アップデート", "最新の版です。", null, text("✓").tone("success")).key("update-latest")),
        ]).surface("card").key("update-card"),
      ]).key("update-section"),
      column([text("ホーム").heading(2).key("home-title"), column(homes).surface("card").key("homes")]).key("home-section"),
      column([text("シェル").heading(2).key("shell-title"), column(shells).surface("card").key("shells")]).key("shell-section"),
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

launch(new Settings());
