import { App, document, Element, Event, Last, launch, os } from "jsr:@binette/replique";

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

class Settings extends App {
  private homeIndices: Map<Element, i32> = new Map<Element, i32>();
  private changes: Map<Element, i32> = new Map<Element, i32>();
  private homeButtons: Element[] = [];
  private values: Element[] = [];

  onCreate(_last: Last): void {
    document.getElementById("details").addEventListener("click", () => settings.showDetails());
    const homes = document.getElementById("homes");
    for (let i: i32 = 0; i < os.homeCount(); i++) {
      const button = document.createElement("button");
      this.homeIndices.set(button, i);
      this.homeButtons.push(button);
      button.addEventListener("click", (event: Event) => settings.chooseHome(event));
      homes.appendChild(button);
    }
    this.updateHomes();
    const debug = document.getElementById("debug");
    for (let i: i32 = 0; i < names.length; i++) {
      const row = document.createElement("div");
      row.className = "settings-row";
      const label = document.createElement("span");
      label.className = "settings-label";
      label.textContent = labels[i];
      row.appendChild(label);
      const value = document.createElement("span");
      value.className = "settings-value";
      this.values.push(value);
      row.appendChild(value);
      for (let direction: i32 = 0; direction < 2; direction++) {
        const button = document.createElement("button");
        button.textContent = direction == 0 ? "−" : "＋";
        this.changes.set(button, i * 2 + direction);
        button.addEventListener("click", (event: Event) => settings.change(event));
        row.appendChild(button);
      }
      debug.appendChild(row);
      this.updateValue(i);
    }
    const history = document.getElementById("history");
    for (let i: i32 = 0; i < os.launchCount(); i++) {
      const line = document.createElement("li");
      line.textContent = utc(os.launchTime(i)) + " " + os.launchName(i);
      history.appendChild(line);
    }
  }

  updateHomes(): void {
    for (let i: i32 = 0; i < this.homeButtons.length; i++) {
      this.homeButtons[i].textContent = os.homeName(i) + (os.homeId(i) == os.home() ? "（使用中）" : "");
    }
  }

  chooseHome(event: Event): void {
    if (!this.homeIndices.has(event.currentTarget)) return;
    os.setHome(this.homeIndices.get(event.currentTarget));
    this.updateHomes();
  }

  updateValue(i: i32): void {
    const value = os.get(names[i]);
    const seconds = value % 1000 == 0 ? (value / 1000).toString() : (<f64>value / 1000).toString();
    this.values[i].textContent = steps[i] == 1000 ? seconds + " 秒" : value.toString();
  }

  change(event: Event): void {
    if (!this.changes.has(event.currentTarget)) return;
    const change = this.changes.get(event.currentTarget);
    const i = change / 2;
    const value = os.get(names[i]);
    // i32 の上限を越える加算もしない
    const next = <i64>value + (change % 2 == 0 ? -steps[i] : steps[i]);
    if (next < minimums[i] || next > 2147483647) return;
    if (os.set(names[i], <i32>next)) this.updateValue(i);
  }

  showDetails(): void {
    document.getElementById("description").textContent = "ブラウザだけで動く、アプリの土台です。";
  }
}

const settings = new Settings();
launch(settings);
