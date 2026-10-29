import { App, launch, os } from "jsr:@binette/replique";
import { View, button, column, row, show, text } from "jsr:@binette/replique/ui";

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

let details = false;
function showDetails(): void { details = true; }
function chooseHome(index: i32): void { os.setHome(index); }
function change(change: i32): void {
  const i = change / 2;
  const value = os.get(names[i]);
  // i32 の上限を越える加算もしない
  const next = <i64>value + (change % 2 == 0 ? -steps[i] : steps[i]);
  if (next < minimums[i] || next > 2147483647) return;
  os.set(names[i], <i32>next);
}

class Settings extends App {
  build(): View {
    const homes: View[] = [];
    for (let i: i32 = 0; i < os.homeCount(); i++) {
      homes.push(button(os.homeName(i) + (os.homeId(i) == os.home() ? "（使用中）" : ""), chooseHome).arg(i).padding(12).key("home-" + i.toString()));
    }
    const debug: View[] = [];
    for (let i: i32 = 0; i < names.length; i++) {
      const value = os.get(names[i]);
      const seconds = value % 1000 == 0 ? (value / 1000).toString() : (<f64>value / 1000).toString();
      debug.push(row([
        text(labels[i]).grow(),
        text(steps[i] == 1000 ? seconds + " 秒" : value.toString()).key("settings-value-" + i.toString()),
        button("−", change).arg(i * 2).label(labels[i] + "を減らす"),
        button("＋", change).arg(i * 2 + 1).label(labels[i] + "を増やす"),
      ]).gap(8).key("settings-row-" + i.toString()));
    }
    const history: View[] = [];
    for (let i: i32 = 0; i < os.launchCount(); i++) {
      history.push(text(utc(os.launchTime(i)) + " " + os.launchName(i)).key("launch-" + i.toString()));
    }
    return column([
      text("設定").key("settings-title"),
      column([
        text("Binette について").key("about-title"), text("Binette — 仕様の版 0.2"),
        button("詳しく", showDetails).key("details"),
        column([show(details, text("ブラウザだけで動く、アプリの土台です。"))]).key("description"),
      ]).gap(8),
      column([text("ホーム").key("home-title"), column(homes).gap(8).key("homes")]).gap(8),
      column([text("デバッグ").key("debug-title"), column(debug).gap(8).key("debug")]).gap(8),
      column([text("起動の履歴").key("history-title"), text("日時は UTC です。"), column(history).gap(8).key("history")]).gap(8),
    ]).gap(16).padding(16).key("settings-root");
  }
}

launch(new Settings());
