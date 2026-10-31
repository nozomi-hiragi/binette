import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import type { DomOp } from "@binette/core";
import { Window } from "happy-dom";
import { appIcon, badge, checkbox, chip, column, createUiDiffer, createUiDom, image, listTile, mount, picker, progress, radio, row, segmented, separator, slider, spacer, spinner, stack, tabs, text,
  type UiNode } from "../src/index.ts";

/** happy-dom の要素を DOM の型として扱う。 */
function setup() {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.appendChild(host as never);
  const key = (target: Element, name: string) => target.dispatchEvent(new window.KeyboardEvent("keydown", { key: name, bubbles: true }) as unknown as Event);
  const fire = (target: Element, type: string) => target.dispatchEvent(new window.Event(type, { bubbles: true }) as unknown as Event);
  return { window, host, key, fire };
}

Deno.test("よくある部品は意味の合う要素・role・aria になり、余りを埋める部品と区切り線と重ねる部品を描く", async () => {
  const { window, host } = setup();
  const root = mount(host);
  try {
    root.render(column([
      row([text("左"), spacer(), separator(), text("右")]),
      separator(),
      stack([text("下"), badge("3").align("topEnd").label("未読 3 件")]).center(),
      progress(0.42), progress(-1).label("読み込み中"), spinner().label("待っています"),
      image("data:image/png;base64,iVBORw0KGgo=").label("写真").width(48).height(48),
      listTile("題", "副題", chip("新").tone("accent"), badge("2")),
    ]));
    const spacerNode = host.querySelector(".bina-ui-spacer")!;
    assertEquals(spacerNode.tagName, "DIV");
    const [vertical, horizontal] = [...host.querySelectorAll(".bina-ui-separator")];
    assertEquals([vertical!.tagName, vertical!.getAttribute("aria-orientation"), horizontal!.getAttribute("aria-orientation")], ["HR", "vertical", null]);
    const stackNode = host.querySelector(".bina-ui-stack")!;
    assert(stackNode.classList.contains("bina-ui-center"));
    const mark = stackNode.querySelector(".bina-ui-badge")!;
    assertEquals([mark.textContent, mark.getAttribute("aria-label"), mark.classList.contains("bina-ui-align-topEnd")], ["3", "未読 3 件", true]);
    const [determinate, indeterminate, circle] = [...host.querySelectorAll('[role="progressbar"]')] as HTMLElement[];
    assertEquals([determinate!.getAttribute("aria-valuenow"), determinate!.getAttribute("aria-valuemax"), determinate!.style.getPropertyValue("--bina-ui-progress")], ["42", "100", "42%"]);
    assertEquals([indeterminate!.hasAttribute("aria-valuenow"), indeterminate!.classList.contains("bina-ui-indeterminate"), indeterminate!.getAttribute("aria-label")], [false, true, "読み込み中"]);
    assertEquals([circle!.className, circle!.getAttribute("aria-label")], ["bina-ui-spinner", "待っています"]);
    const picture = host.querySelector("img.bina-ui-image")!;
    assertEquals([picture.getAttribute("src"), picture.getAttribute("alt"), picture.hasAttribute("aria-label")], ["data:image/png;base64,iVBORw0KGgo=", "写真", false]);
    const tile = host.querySelector(".bina-ui-listTile")!;
    assertEquals([...tile.children].map(child => child.className.split(" ")[0]), ["bina-ui-chip", "bina-ui-column", "bina-ui-badge"]);
    assertEquals(tile.querySelector(".bina-ui-column")!.textContent, "題副題");
    assert(tile.querySelector(".bina-ui-tone-muted.bina-ui-small"));
    assert(tile.querySelector(".bina-ui-chip.bina-ui-tone-accent"));
    assertEquals((tile as HTMLElement).style.getPropertyValue("--bina-ui-gap"), "var(--bina-ui-space-md, var(--bina-ui-default-space-md))");
    assert((tile as HTMLElement).style.getPropertyValue("--bina-ui-padding").includes("space-sm"));

    // 描き直しで値を変え、外部の URL と SVG の画像は描かない
    root.render(column([progress(1), image("https://example.com/a.png"), image("data:image/svg+xml;base64,PHN2Zz4=")]));
    assertEquals(host.querySelector('[role="progressbar"]')!.getAttribute("aria-valuenow"), "100");
    assertEquals([...host.querySelectorAll("img")].map(node => node.hasAttribute("src")), [false, false]);
  } finally { root.unmount(); await window.happyDOM.close(); }
});

Deno.test("checkbox・radio・slider・picker は値を返し、描き直しでアプリの値に戻る", async () => {
  const { window, host, fire } = setup();
  const root = mount(host);
  const events: string[] = [];
  let on = false;
  let level = 2;
  let size = 0;
  let accept = true;
  const draw = () => column([
    checkbox(on, value => { events.push("check:" + value); if (accept) on = value; }).label("通知"),
    radio(size === 0, i => { events.push("radio:" + i); size = i; }).arg(0).label("小"),
    radio(size === 1, i => { events.push("radio:" + i); size = i; }).arg(1).label("大"),
    slider(level, 0, 10, value => { events.push("slider:" + value); if (accept) level = value; }).step(0.5).label("音量"),
    picker(["赤", "青", "緑"], 1, i => { events.push("picker:" + i); }).label("色"),
    checkbox(true, () => { events.push("disabled"); }).enabled(false),
  ]);
  try {
    root.render(draw());
    const [box, small, large, , disabled] = [...host.querySelectorAll("input")] as HTMLInputElement[];
    const range = host.querySelector('input[type="range"]') as HTMLInputElement;
    const select = host.querySelector("select")!;
    assertEquals([box!.type, box!.checked, box!.getAttribute("aria-label"), box!.hasAttribute("role")], ["checkbox", false, "通知", false]);
    assertEquals([small!.type, small!.checked, large!.checked], ["radio", true, false]);
    assertEquals([range.min, range.max, range.step, range.value], ["0", "10", "0.5", "2"]);
    assertEquals([[...select.options].map(option => option.textContent), select.selectedIndex], [["赤", "青", "緑"], 1]);
    assertEquals(disabled!.disabled, true);

    box!.click();
    large!.click();
    range.value = "7.5";
    fire(range, "input");
    select.selectedIndex = 2;
    fire(select, "change");
    disabled!.click();
    assertEquals(events, ["check:true", "radio:1", "slider:7.5", "picker:2"]);
    root.render(draw());
    assertEquals([box!.checked, small!.checked, large!.checked, range.value], [true, false, true, "7.5"]);
    // picker の値はアプリが変えていないので、描き直しで元の番号に戻る
    assertEquals(select.selectedIndex, 1);

    // アプリが受け付けなかった値は、次の描き直しで戻る
    accept = false;
    box!.click();
    range.value = "1";
    fire(range, "input");
    assertEquals([box!.checked, range.value], [false, "1"]);
    root.render(draw());
    assertEquals([box!.checked, range.value], [true, "7.5"]);
    // 選ばれているラジオをもう一度押しても何も届かない
    events.length = 0;
    large!.click();
    assertEquals(events, []);
  } finally { root.unmount(); await window.happyDOM.close(); }
});

Deno.test("segmented と tabs は矢印・Home・End で選び、Tab で入るのは選択中の 1 つだけ", async () => {
  const { window, host, key } = setup();
  const root = mount(host);
  let view = 0;
  let tab = 0;
  const picked: string[] = [];
  const draw = (options = ["日", "週", "月"]) => column([
    segmented(options, view, i => { picked.push("seg:" + i); view = i; }).label("表示"),
    tabs(["概要", "詳細", "履歴"], tab, i => { picked.push("tab:" + i); tab = i; }),
  ]);
  try {
    root.render(draw());
    const group = host.querySelector('[role="radiogroup"]')!;
    const list = host.querySelector('[role="tablist"]')!;
    const segments = [...group.children] as HTMLButtonElement[];
    const tabItems = [...list.children] as HTMLButtonElement[];
    assertEquals(group.getAttribute("aria-label"), "表示");
    assertEquals(segments.map(item => [item.getAttribute("role"), item.getAttribute("aria-checked"), item.getAttribute("tabindex"), item.type]),
      [["radio", "true", "0", "button"], ["radio", "false", "-1", "button"], ["radio", "false", "-1", "button"]]);
    assertEquals(tabItems.map(item => [item.getAttribute("role"), item.getAttribute("aria-selected")]), [["tab", "true"], ["tab", "false"], ["tab", "false"]]);
    assert(segments.every(item => item.classList.contains("bina-ui-option")));

    segments[0]!.focus();
    key(segments[0]!, "ArrowRight");
    assertEquals(window.document.activeElement, segments[1] as never);
    key(segments[1]!, "ArrowLeft");
    key(segments[0]!, "ArrowLeft");
    assertEquals(window.document.activeElement, segments[2] as never);
    tabItems[1]!.click();
    tabItems[1]!.focus();
    key(tabItems[1]!, "End");
    key(tabItems[2]!, "Home");
    assertEquals(picked, ["seg:1", "seg:0", "seg:2", "tab:1", "tab:2", "tab:0"]);
    root.render(draw());
    assertEquals([segments[2]!.getAttribute("aria-checked"), segments[2]!.getAttribute("tabindex"), segments[0]!.getAttribute("tabindex")], ["true", "0", "-1"]);
    // 選択肢が同じなら要素を使い続け、変わったときだけ作り直す
    root.render(draw());
    assertStrictEquals(group.children[0], segments[0]);
    root.render(draw(["日", "週"]));
    assertEquals([...group.children].map(item => item.textContent), ["日", "週"]);
    assertEquals([...group.children].map(item => item.getAttribute("aria-checked")), ["false", "false"]);
    assertEquals(group.children[0]!.getAttribute("tabindex"), "0");
  } finally { root.unmount(); await window.happyDOM.close(); }
});

Deno.test("無効の選択肢は押しても矢印でも選ばず、古い版の描き直しは新しい操作を戻さない", async () => {
  const { window, host, key } = setup();
  const values: [number, number, number][] = [];
  const dom = createUiDom(host, { dispatchUi() {}, dispatchUiText() {}, dispatchUiValue(handle, value, version) { values.push([handle, value, version]); } });
  const ops: DomOp[] = [];
  const ui = createUiDiffer(op => ops.push(op));
  const node = (index: number, enabled = true): UiNode => ({ kind: "segmented", children: [], text: "", padding: null, gap: 0, grow: false, key: "", label: "", enabled, handler: 0,
    minWidth: 0, heading: 0, list: false, shown: true, app: -1, multiline: false, options: ["一", "二", "三"], index });
  try {
    ui.render(node(0), 1);
    dom.apply(ops.splice(0));
    const items = [...host.querySelectorAll("button")] as HTMLButtonElement[];
    items[1]!.click();
    items[1]!.focus();
    key(items[1]!, "ArrowRight");
    assertEquals(values, [[1, 1, 1], [1, 2, 2]]);
    // 版 1 の描き直しは版 2 の操作より古いので、選択を戻さない
    ui.inputVersions.set(1, 1);
    ui.render(node(1), 2);
    dom.apply(ops.splice(0));
    assertEquals(items.map(item => item.getAttribute("aria-checked")), ["false", "false", "true"]);
    ui.inputVersions.set(1, 2);
    ui.render(node(0), 3);
    dom.apply(ops.splice(0));
    assertEquals(items.map(item => item.getAttribute("aria-checked")), ["true", "false", "false"]);
    ui.render(node(0, false), 4);
    dom.apply(ops.splice(0));
    assert(items.every(item => item.disabled));
    items[2]!.click();
    key(items[0]!, "End");
    assertEquals(values.length, 2);
  } finally { dom.clear(); dom.stop(); await window.happyDOM.close(); }
});

Deno.test("値を返す部品は描き直しのたびに値と版を送り、ほかの部品は変わったときだけ送る", () => {
  const ops: DomOp[] = [];
  const ui = createUiDiffer(op => ops.push(op));
  const base = { children: [], text: "", padding: null, gap: 0, grow: false, key: "", label: "", enabled: true, handler: -1, minWidth: 0, heading: 0, list: false, shown: true, app: -1, multiline: false };
  const tree = (options: string[]): UiNode => ({ ...base, kind: "column", children: [
    { ...base, kind: "checkbox", checked: true, handler: 0 }, { ...base, kind: "slider", value: 3, min: 0, max: 5, step: 0, handler: 1 },
    { ...base, kind: "tabs", options, index: 0, handler: 2 }, { ...base, kind: "progress", value: 0.5 }, { ...base, kind: "chip", text: "札", align: "end" },
  ] });
  ui.render(tree(["一", "二"]), 1);
  const first = ops.splice(0).filter(op => op.op === "ui-update");
  assertEquals(first.map(op => op.op === "ui-update" ? [op.checked, op.value, op.min, op.max, op.step, op.options, op.index, op.align] : []).slice(1), [
    [true, undefined, undefined, undefined, undefined, undefined, undefined, undefined],
    [undefined, 3, 0, 5, 0, undefined, undefined, undefined],
    [undefined, undefined, undefined, undefined, undefined, ["一", "二"], 0, undefined],
    [undefined, 0.5, undefined, undefined, undefined, undefined, undefined, undefined],
    [undefined, undefined, undefined, undefined, undefined, undefined, undefined, "end"],
  ]);
  ui.render(tree(["一", "二"]), 2);
  assertEquals(ops.splice(0).map(op => op.op === "ui-update" ? op.handle : -1), [2, 3, 4]);
  ui.render(tree(["一", "三"]), 3);
  assertEquals(ops.splice(0).filter(op => op.op === "ui-update" && op.options?.[1] === "三").length, 1);
});

Deno.test("TS の mount に apps を渡すと appIcon がその SVG を描き、渡さなければ src を持たない", async () => {
  const { window, host } = setup();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>';
  const apps: { icon?: string }[] = [{ icon: svg }, {}];
  const root = mount(host, { apps });
  const other = window.document.createElement("div") as unknown as HTMLElement;
  host.after(other as never);
  const plain = mount(other);
  try {
    root.render(row([appIcon(0), appIcon(1)]));
    const images = host.querySelectorAll("img");
    assertEquals(images[0]!.getAttribute("src"), `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    assertEquals(images[1]!.hasAttribute("src"), false);
    // 後から足したアイコンも、次の描画で使う
    apps.push({ icon: svg });
    root.render(row([appIcon(0), appIcon(1), appIcon(2)]));
    assertEquals(host.querySelectorAll("img")[2]!.getAttribute("src"), images[0]!.getAttribute("src"));
    plain.render(appIcon(0));
    assertEquals(other.querySelector("img")!.hasAttribute("src"), false);
  } finally { root.unmount(); plain.unmount(); await window.happyDOM.close(); }
});
