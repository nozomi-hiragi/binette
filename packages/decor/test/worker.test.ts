import { assert, assertEquals } from "@std/assert";
import type { DomOp } from "@binette/core";
import { Window } from "happy-dom";
import { createUiDom } from "../src/index.ts";
// AS のアプリを Régie で組み立て、本物の Worker を経て描く。Régie はテストでだけ使う
import { type RegieWorker, startProcess } from "../../regie/src/index.ts";
import { buildApp } from "../../regie/src/build.ts";

const libraries = { "jsr:@binette/replique": await Deno.readTextFile(new URL("../../replique/src/index.ts", import.meta.url)) };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = performance.now() + 10000;
  while (!condition() && performance.now() < deadline) await sleep(5);
  assert(condition(), "待っても状態が変わりませんでした");
}
function realWorker(): RegieWorker {
  return new Worker(new URL("../../regie/src/worker-entry.ts", import.meta.url), { type: "module" });
}

Deno.test("AS の見た目の修飾は Worker を経てクラスと属性になり、状態の変化で付け外しされる", async () => {
  const code = `import { App, launch } from "jsr:@binette/replique";
import { View, button, column, input, row, text } from "jsr:@binette/replique/ui";
let on = false;
function flip(): void { on = !on; }
function typed(_s: string): void {}
class Demo extends App {
  build(): View {
    const header = row([text("デザイナー").bold(), text("保存しません").tone(on ? "" : "muted").small()]).divider("bottom").surface("surface");
    const stepper = row([button("−", flip).variant("subtle"), input("16", typed).mono().placeholder("なし"), button("＋", flip)]).surface("field").width(160);
    const body = row([column([button("木", flip).variant("ghost").selected(on).grow()]).scroll().fill().width(240), column([stepper]).fill().grow().center().surface("sunken")]).fill().collapse();
    const code = column([input("column([])", typed).multiline().mono().height(120)]).surface("dark").minHeight(130);
    return column([header, body, code, button("grow", flip).toggle(on).label("伸ばす"), button("印", flip).highlight(!on).key("mark")]).fill();
  }
}
launch(new Demo());`;
  const files: Record<string, string> = {
    "app.json": JSON.stringify({ id: "looks", name: "見た目", entry: { as: "main.ts" } }),
    "main.ts": code,
  };
  const built = await buildApp(path => Promise.resolve(files[path]!), { libraries });
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  const process = await startProcess(built.wasm, { createWorker: realWorker });
  const dom = createUiDom(host, process);
  const batches: DomOp[][] = [];
  try {
    process.attach(ops => { batches.push(ops); dom.apply(ops); });
    await process.begin();
    const toggle = host.querySelector('[role="switch"]') as HTMLButtonElement | null;
    assert(toggle);
    assertEquals([toggle.getAttribute("aria-checked"), toggle.getAttribute("aria-label"), toggle.textContent], ["false", "伸ばす", ""]);
    const root = host.querySelector(".bina-ui-column")!;
    assert(root.classList.contains("bina-ui-fill"));
    const muted = host.querySelector(".bina-ui-tone-muted")!;
    assert(muted.classList.contains("bina-ui-small"));
    assert(host.querySelector(".bina-ui-bold"));
    assert(host.querySelector(".bina-ui-surface-surface.bina-ui-divider-bottom"));
    const field = host.querySelector(".bina-ui-surface-field") as HTMLElement;
    assertEquals(field.style.getPropertyValue("--bina-ui-width"), "160px");
    assertEquals(host.querySelector("input")!.getAttribute("placeholder"), "なし");
    assert(host.querySelector("input")!.classList.contains("bina-ui-mono"));
    const tree = host.querySelector(".bina-ui-variant-ghost")!;
    assertEquals([tree.getAttribute("aria-pressed"), tree.classList.contains("bina-ui-selected")], ["false", false]);
    assert(host.querySelector(".bina-ui-collapse.bina-ui-fill"));
    const mark = host.querySelector('[data-bina-key="mark"]')!;
    assertEquals([mark.classList.contains("bina-ui-highlight"), mark.hasAttribute("aria-pressed")], [true, false]);
    assert(host.querySelector(".bina-ui-scroll.bina-ui-fill.bina-ui-width"));
    assert(host.querySelector(".bina-ui-surface-sunken.bina-ui-center.bina-ui-grow"));
    const textarea = host.querySelector("textarea")!;
    assertEquals(textarea.style.getPropertyValue("--bina-ui-height"), "120px");
    assertEquals((host.querySelector(".bina-ui-surface-dark") as HTMLElement).style.getPropertyValue("min-height"), "130px");

    toggle.click();
    await waitFor(() => toggle.getAttribute("aria-checked") === "true");
    assertEquals([tree.getAttribute("aria-pressed"), tree.classList.contains("bina-ui-selected")], ["true", true]);
    assertEquals([mark.classList.contains("bina-ui-highlight"), mark.hasAttribute("aria-pressed")], [false, false]);
    assertEquals(muted.classList.contains("bina-ui-tone-muted"), false);
    assert(muted.classList.contains("bina-ui-small"));
    assertEquals(host.querySelector('[role="switch"]'), toggle);
    assert(batches.flat().some(op => op.op === "ui-update" && op.toggle === true));
  } finally { process.stop(); dom.clear(); dom.stop(); await window.happyDOM.close(); }
});

Deno.test("AS のよくある部品は本物の Worker を経て描かれ、値を返す操作がアプリに届いて描き直される", async () => {
  const code = `import { App, launch } from "jsr:@binette/replique";
import { View, column, row, text, checkbox, radio, slider, picker, segmented, tabs, progress, spinner, spacer, separator, stack, image, listTile, chip, badge } from "jsr:@binette/replique/ui";
let on = false;
let size: i32 = 0;
let volume: f64 = 2;
let color: i32 = 0;
let view: i32 = 1;
let tab: i32 = 0;
let locked = false;
function check(value: bool): void { if (!locked) on = value; }
function choose(i: i32): void { size = i; }
function move(value: f64): void { if (!locked) volume = value; }
function paint(i: i32): void { color = i; }
function show(i: i32): void { view = i; locked = i == 2; }
function open(i: i32): void { tab = i; }
class Demo extends App {
  build(): View {
    const status = "on:" + (on ? "1" : "0") + " size:" + size.toString() + " volume:" + volume.toString() + " color:" + color.toString() + " view:" + view.toString() + " tab:" + tab.toString();
    return column([
      tabs(["概要", "詳細"], tab, open),
      text(status).key("status"),
      row([checkbox(on, check).label("通知"), spacer(), separator(), radio(size == 0, choose).arg(0).label("小"), radio(size == 1, choose).arg(1).label("大")]),
      slider(volume, 0, 10, move).step(0.5).label("音量"),
      picker(["赤", "青"], color, paint).label("色"),
      segmented(["日", "週", "月"], view, show),
      progress(volume / 10), spinner().label("待機"),
      stack([image("data:image/png;base64,iVBORw0KGgo=").label("絵"), badge("3").align("topEnd")]),
      listTile("題", "副題", chip("新").tone("accent"), null),
    ]);
  }
}
launch(new Demo());`;
  const files: Record<string, string> = {
    "app.json": JSON.stringify({ id: "components", name: "部品", entry: { as: "main.ts" } }),
    "main.ts": code,
  };
  const built = await buildApp(path => Promise.resolve(files[path]!), { libraries });
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.appendChild(host as never);
  const process = await startProcess(built.wasm, { createWorker: realWorker });
  const dom = createUiDom(host, process);
  const fire = (target: Element, type: string) => target.dispatchEvent(new window.Event(type, { bubbles: true }) as unknown as Event);
  const status = () => host.querySelector('[data-bina-key="status"]')!.textContent;
  try {
    process.attach(ops => dom.apply(ops));
    await process.begin();
    assertEquals(status(), "on:0 size:0 volume:2.0 color:0 view:1 tab:0");
    const box = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const radios = [...host.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    const range = host.querySelector('input[type="range"]') as HTMLInputElement;
    const select = host.querySelector("select")!;
    const segments = [...host.querySelector('[role="radiogroup"]')!.children] as HTMLButtonElement[];
    const tabItems = [...host.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
    assertEquals([box.getAttribute("aria-label"), radios[0]!.checked, range.value, range.step, select.selectedIndex], ["通知", true, "2", "0.5", 0]);
    assertEquals(segments.map(item => item.getAttribute("aria-checked")), ["false", "true", "false"]);
    assertEquals(host.querySelector('[role="progressbar"]')!.getAttribute("aria-valuenow"), "20");
    assertEquals(host.querySelector("img")!.getAttribute("alt"), "絵");
    assertEquals(host.querySelector(".bina-ui-separator")!.getAttribute("aria-orientation"), "vertical");
    assert(host.querySelector(".bina-ui-listTile .bina-ui-chip"));

    box.click();
    await waitFor(() => status().startsWith("on:1"));
    radios[1]!.click();
    await waitFor(() => status().includes("size:1"));
    assertEquals([radios[0]!.checked, radios[1]!.checked], [false, true]);
    range.value = "6.5";
    fire(range, "input");
    await waitFor(() => status().includes("volume:6.5"));
    assertEquals(host.querySelector('[role="progressbar"]')!.getAttribute("aria-valuenow"), "65");
    select.selectedIndex = 1;
    fire(select, "change");
    await waitFor(() => status().includes("color:1"));
    tabItems[1]!.click();
    await waitFor(() => status().endsWith("tab:1"));
    assertEquals(tabItems.map(item => item.getAttribute("aria-selected")), ["false", "true"]);
    segments[1]!.focus();
    segments[1]!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }) as unknown as Event);
    await waitFor(() => status().includes("view:2"));

    // view:2 のあいだアプリは checkbox と slider の値を受け付けない。DOM はアプリの値に戻る
    box.click();
    range.value = "1";
    fire(range, "input");
    await waitFor(() => box.checked && range.value === "6.5");
    assertEquals(status(), "on:1 size:1 volume:6.5 color:1 view:2 tab:1");
  } finally { process.stop(); dom.clear(); dom.stop(); await window.happyDOM.close(); }
});

Deno.test("AS の吹き出しとメニュー項目は Worker を往復し、選択した引数で描き直す", async () => {
  const files: Record<string, string> = {
    "app.json": JSON.stringify({ id: "menu", name: "メニュー", entry: { as: "main.ts" } }),
    "main.ts": `import { App, launch } from "jsr:@binette/replique";
import { View, button, column, menuItem, text } from "jsr:@binette/replique/ui";
let value: i32 = 0;
function choose(i: i32): void { value = i; }
class Demo extends App {
  build(): View { return column([button("設定", choose).tip("設定の操作").menu([menuItem("選ぶ", choose).arg(7)]), text(value.toString())]); }
}
launch(new Demo());`,
  };
  const built = await buildApp(path => Promise.resolve(files[path]!), { libraries });
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.append(host as never);
  const process = await startProcess(built.wasm, { createWorker: realWorker });
  const dom = createUiDom(host, process);
  try {
    process.attach(ops => dom.apply(ops));
    await process.begin();
    const button = host.querySelector("button")!;
    assertEquals(button.getAttribute("aria-haspopup"), "menu");
    button.focus();
    assertEquals(host.querySelector(".bina-ui-tip")?.textContent, "設定の操作");
    button.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, cancelable: true }) as unknown as Event);
    const item = host.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    assertEquals(item.textContent, "選ぶ");
    item.click();
    await waitFor(() => host.querySelector(".bina-ui-text")?.textContent === "7");
    assertEquals(host.querySelector<HTMLElement>(".bina-ui-menu")!.hidden, true);
    assertEquals(window.document.activeElement, button as never);
  } finally {
    dom.clear(); dom.stop(); process.stop(); await window.happyDOM.close();
  }
});
