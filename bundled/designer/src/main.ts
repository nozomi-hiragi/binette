// deno-lint-ignore-file no-import-prefix no-unversioned-import
import { App, launch } from "jsr:@binette/replique";
import { View, column, row, grid, text, button, buttonOf, input, space } from "jsr:@binette/replique/ui";
import { Node, Modifier, container, flag, numeric, applicable, summary, numberValue, validNumber, validModifierNumber, stepNumber, formatNumber, parse, write, example } from "./model.ts";

let root = changetype<Node>(parse(example).root);
let selected = root;
let code = write(root);
/** 読めないコードの位置と理由。空なら読める。 */
let codeError = "";
/** コード欄が木から書き出した式と違うか。 */
let codeDirty = false;
/** 木の操作とインスペクターの入力が受け付けられなかった理由。次の成功した変更で消す。 */
let treeNotice = "";
let inspectorNotice = "";
let nodes: Node[] = [];
const kinds = ["column", "row", "grid", "text", "button", "buttonOf", "input", "appIcon"];
const numbers = ["padding", "gap", "minWidth", "heading", "arg"];
const flags = ["grow", "list", "multiline", "enabled"];
/** 消す × の arg に使う修飾の名前。 */
const names = ["padding", "gap", "minWidth", "heading", "arg", "grow", "list", "multiline", "enabled", "key", "label"];
/** インスペクターのグループと、その中の修飾。 */
const groupTitles = ["余白", "サイズ", "文字", "識別", "そのほか"];
const groupItems = [["padding", "gap"], ["minWidth", "grow"], ["heading"], ["key", "label"], ["list", "enabled", "multiline", "arg"]];
const numberDrafts: string[] = ["", "", "", "", ""];
let valueDraft = "";
let callbackDraft = "() => {}";
/** 選んだときに決め、入力の途中で input と textarea が入れ替わらないようにする。 */
let valueMultiline = false;
let callbackMultiline = false;
function syncFields(): void {
  for (let i = 0; i < numbers.length; i++) {
    const name = numbers[i];
    const value = get(name);
    if (has(name) && value.length == 0 && (name == "padding" || name == "gap")) { numberDrafts[i] = "space.md"; continue; }
    numberDrafts[i] = value.length > 0 && validNumber(value) && !value.startsWith("space.") && !value.startsWith("radius.") && !value.startsWith("fontSize.") ? formatNumber(numberValue(value)) : value;
  }
  valueDraft = selected.value; callbackDraft = selected.callback;
  valueMultiline = selected.kind == "text" || selected.kind == "input" || selected.value.indexOf("\n") >= 0;
  callbackMultiline = selected.callback.indexOf("\n") >= 0;
}
function noop(): void {}
function noText(_value: string): void {}
function changed(): void { code = write(root); codeError = ""; codeDirty = false; treeNotice = ""; inspectorNotice = ""; }
function findParent(tree: Node, child: Node): Node | null {
  for (let i = 0; i < tree.children.length; i++) {
    if (tree.children[i] == child) return tree;
    const found = findParent(tree.children[i], child);
    if (found !== null) return found;
  }
  return null;
}
function addTarget(): Node | null { return container(selected.kind) ? selected : findParent(root, selected); }
function choose(index: i32): void {
  if (index >= 0 && index < nodes.length) { selected = nodes[index]; syncFields(); treeNotice = ""; inspectorNotice = ""; }
}
function add(index: i32): void {
  const target = addTarget();
  if (target === null) { treeNotice = "子を追加するには column・row・grid・buttonOf を選んでください。"; return; }
  // 読み込みと同じ上限で書き出せる木を保つ。
  const next = new Node(kinds[index]);
  next.value = next.kind == "appIcon" ? "0" : next.kind == "input" ? "入力" : "文字";
  if (next.kind == "input") next.callback = "(value: string) => {}";
  target.children.push(next);
  const checked = parse(write(root));
  if (checked.root === null) { target.children.pop(); treeNotice = checked.error; return; }
  selected = next; syncFields(); changed();
}
function remove(): void {
  const parent = findParent(root, selected);
  if (parent === null) { treeNotice = "根の部品は削除できません。見本に戻すと最初の状態になります。"; return; }
  parent.children.splice(parent.children.indexOf(selected), 1); selected = parent; syncFields(); changed();
}
function move(delta: i32): void {
  const parent = findParent(root, selected);
  if (parent === null) return;
  const index = parent.children.indexOf(selected), next = index + delta;
  if (next < 0 || next >= parent.children.length) return;
  const other = parent.children[next]; parent.children[next] = selected; parent.children[index] = other; changed();
}
function position(line: i32, column: i32, reason: string): string { return line.toString() + " 行 " + column.toString() + " 列: " + reason; }
/** 入力のたびに読めるかを確かめ、反映する前に位置と理由を見せる。 */
function editCode(value: string): void {
  code = value;
  const result = parse(value);
  codeError = result.root === null ? position(result.line, result.column, result.error) : "";
  codeDirty = value != write(root);
}
function load(): void {
  const result = parse(code);
  if (result.root === null) { codeError = position(result.line, result.column, result.error); return; }
  root = changetype<Node>(result.root); selected = root; syncFields(); changed();
}
function sample(): void { root = changetype<Node>(parse(example).root); selected = root; syncFields(); changed(); }
function editValue(value: string): void {
  valueDraft = value;
  if (selected.kind == "appIcon" && !validNumber(value)) { inspectorNotice = "アイコン番号は有限の数値で指定してください。"; return; }
  selected.value = value; changed();
}
function editCallback(value: string): void {
  callbackDraft = value;
  const old = selected.callback; selected.callback = value;
  const result = parse(write(root));
  if (result.root === null) { selected.callback = old; inspectorNotice = "コールバック: " + result.error; return; }
  changed();
}
function get(name: string, fallback: string = ""): string {
  for (let i = selected.modifiers.length - 1; i >= 0; i--) if (selected.modifiers[i].name == name) return selected.modifiers[i].value;
  return fallback;
}
function has(name: string): boolean {
  for (let i = 0; i < selected.modifiers.length; i++) if (selected.modifiers[i].name == name) return true;
  return false;
}
function set(name: string, value: string, active: boolean = true): void {
  for (let i = selected.modifiers.length - 1; i >= 0; i--) if (selected.modifiers[i].name == name) selected.modifiers.splice(i, 1);
  if (active) selected.modifiers.push(new Modifier(name, value));
  changed();
}
// 空の key・label は意味が無いので、修飾ごと外す。
function editKey(value: string): void { set("key", value, value.length > 0); }
function editLabel(value: string): void { set("label", value, value.length > 0); }
function editNumber(index: i32, value: string): void {
  numberDrafts[index] = value;
  const name = numbers[index];
  if (value.length == 0) { inspectorNotice = name + " の数値を入力してください。修飾を外すには × を押してください。"; return; }
  if (!validModifierNumber(name, value)) {
    inspectorNotice = name == "heading" || name == "arg" ? name + " は整数を入力してください。" : name + " は有限の数値か space.md などの段の名前を入力してください。";
    return;
  }
  set(name, value);
}
function editPadding(value: string): void { editNumber(0, value); }
function editGap(value: string): void { editNumber(1, value); }
function editMinWidth(value: string): void { editNumber(2, value); }
function editHeading(value: string): void { editNumber(3, value); }
function editArg(value: string): void { editNumber(4, value); }
function step(arg: i32): void {
  const index = arg / 2, delta = arg % 2 == 0 ? -1 : 1;
  const name = numbers[index];
  const next = stepNumber(name, get(name), delta, has(name));
  if (!validModifierNumber(name, next)) { inspectorNotice = name + " の数値が大きすぎます。"; return; }
  set(name, next); numberDrafts[index] = next;
}
function clearModifier(index: i32): void {
  const name = names[index];
  set(name, "", false);
  const n = numbers.indexOf(name);
  if (n >= 0) numberDrafts[n] = "";
}
function toggle(index: i32): void {
  const name = flags[index];
  if (name == "enabled") set(name, get(name, "true") == "true" ? "false" : "true");
  else set(name, "", !has(name));
}
function treeRows(node: Node, depth: i32, rows: View[]): void {
  const index = nodes.length; nodes.push(node);
  const value = summary(node);
  const parts: View[] = [];
  if (depth > 0) parts.push(text("").width(depth * 16));
  parts.push(text(node.kind).mono().small().tone("accent"));
  if (value.length > 0) parts.push(text(value).small().tone("muted").truncate());
  rows.push(buttonOf([row(parts).gap(space.sm)], choose).arg(index).variant("ghost").grow().selected(node == selected)
    .label("部品を選択 " + node.kind + (value.length > 0 ? " " + value : "")));
  for (let i = 0; i < node.children.length; i++) treeRows(node.children[i], depth + 1, rows);
}
/** コールバックとホーム専用の appIcon は代替表示にし、木から View を構築する。 */
function preview(node: Node): View {
  const children: View[] = [];
  for (let i = 0; i < node.children.length; i++) children.push(preview(node.children[i]));
  let view = text(node.value);
  if (node.kind == "column") view = column(children);
  else if (node.kind == "row") view = row(children);
  else if (node.kind == "grid") view = grid(children);
  else if (node.kind == "button") view = button(node.value, noop);
  else if (node.kind == "buttonOf") view = buttonOf(children, noop);
  else if (node.kind == "input") view = input(node.value, noText);
  // 通常アプリではホームのアイコンを取得できないため、木とコードだけに保持する。
  else if (node.kind == "appIcon") view = text("appIcon(" + node.value + ") · ホーム専用のためプレビューできません。");
  for (let i = 0; i < node.modifiers.length; i++) {
    const m = node.modifiers[i];
    const value = numeric(m.name) ? m.value.length == 0 ? -3 : numberValue(m.value) : 0;
    if (m.name == "padding") view.padding(value);
    else if (m.name == "gap") view.gap(value);
    else if (m.name == "minWidth") view.minWidth(value);
    else if (m.name == "heading") view.heading(value);
    else if (m.name == "arg") view.arg(value);
    else if (m.name == "grow") view.grow();
    else if (m.name == "list") view.list();
    else if (m.name == "multiline") view.multiline();
    else if (m.name == "enabled") view.enabled(m.value == "true");
    else if (m.name == "key") view.key(m.value);
    else if (m.name == "label") view.label(m.value);
  }
  // 選んでいる部品に枠だけの印を付ける（押した状態や aria は変えず、アプリの見た目のままにする）。
  // 根の印はカードの角丸とぶつかるので出さない。根を選んでいることは構造の木で分かる。
  if (node == selected && node != root) view.highlight(true);
  return view;
}
/** 区画とグループの見出し。 */
function caption(value: string): View { return text(value).small().bold().tone("muted"); }
/** 受け付けられなかった操作の理由。 */
function warning(value: string): View { return text(value).small().tone("danger"); }
/** 「ラベル列＋入力＋消す ×」の 1 行。入力は × の列の手前まで伸ばし、× が無い行もその場所を空けて右端を揃える。 */
function property(name: string, control: View, clear: View | null): View {
  return row([text(name).width(76).small().tone("muted"), control.grow(), clear === null ? text("").width(24) : clear]).gap(space.sm).minHeight(32);
}
function clearButton(name: string): View { return button("×", clearModifier).arg(names.indexOf(name)).variant("ghost").small().width(24).label(name + " の修飾を削除"); }
/** 入力欄の枠。中の input は枠なしになる。 */
function field(view: View): View { return row([view.small().padding(space.xs)]).surface("field"); }
/** − 値 ＋ が一体になった数値の入力。 */
function stepper(index: i32): View {
  const name = numbers[index];
  let value = input(numberDrafts[index], editPadding);
  if (index == 1) value = input(numberDrafts[index], editGap);
  else if (index == 2) value = input(numberDrafts[index], editMinWidth);
  else if (index == 3) value = input(numberDrafts[index], editHeading);
  else if (index == 4) value = input(numberDrafts[index], editArg);
  return row([
    button("−", step).arg(index * 2).width(28).label(name + " を減らす"),
    value.mono().small().padding(space.xs).placeholder("—").label(name + " の数値"),
    button("＋", step).arg(index * 2 + 1).width(28).label(name + " を増やす"),
  ]).surface("field");
}
function modifierRow(name: string): View {
  const n = numbers.indexOf(name), f = flags.indexOf(name);
  if (n >= 0) return property(name, stepper(n), has(name) ? clearButton(name) : null);
  if (f >= 0) {
    const active = flag(name) ? has(name) : get(name, "true") == "true";
    // grow・list・multiline は切ると修飾が外れる。enabled だけは明示の値を消せるようにする。
    return property(name, row([button(name, toggle).arg(f).toggle(active).label(name + " を切り替える")]), name == "enabled" && has(name) ? clearButton(name) : null);
  }
  const value = name == "key" ? input(get(name), editKey).placeholder("なし") : input(get(name), editLabel).placeholder("読み上げ用");
  return property(name, field(value.label(name)), has(name) ? clearButton(name) : null);
}
function group(title: string, rows: View[]): View {
  const children: View[] = [caption(title)];
  for (let i = 0; i < rows.length; i++) children.push(rows[i]);
  return column(children).gap(space.xs).padding(space.md).divider("top");
}
function inspector(): View {
  const heading: View[] = [
    caption("インスペクター"),
    row([text(selected.kind).mono().bold(), text(container(selected.kind) ? selected.children.length.toString() + " 個の子" : "").small().tone("muted")]).gap(space.sm),
  ];
  if (inspectorNotice.length > 0) heading.push(warning(inspectorNotice));
  const sections: View[] = [column(heading).gap(space.sm).padding(space.md)];
  const content: View[] = [];
  if (!container(selected.kind)) {
    const value = input(valueDraft, editValue).label("部品の文字または番号");
    content.push(property(selected.kind == "appIcon" ? "番号" : "文字", field(valueMultiline ? value.multiline().height(64) : value), null));
  }
  if (selected.kind == "button" || selected.kind == "buttonOf" || selected.kind == "input") {
    const value = input(callbackDraft, editCallback).mono().label("コールバック式");
    content.push(property("コールバック", field(callbackMultiline ? value.multiline().height(64) : value), null));
  }
  if (content.length > 0) sections.push(group("内容", content));
  for (let g = 0; g < groupTitles.length; g++) {
    const rows: View[] = [];
    const items = groupItems[g];
    // 効かない修飾は出さない。ただしコードで付けた修飾は消せるように出す。
    for (let i = 0; i < items.length; i++) if (applicable(selected.kind, items[i]) || has(items[i])) rows.push(modifierRow(items[i]));
    if (rows.length > 0) sections.push(group(groupTitles[g], rows));
  }
  return column(sections).surface("surface").divider("left").width(300).fill().scroll().key("inspector-" + nodes.indexOf(selected).toString());
}
function structure(): View {
  nodes = []; const rows: View[] = []; treeRows(root, 0, rows);
  const target = addTarget();
  const chips: View[] = [];
  for (let i = 0; i < kinds.length; i++) chips.push(button(kinds[i], add).arg(i).variant("dashed").mono().small().label(kinds[i] + " を追加").enabled(target !== null));
  const parent = findParent(root, selected);
  const index = parent === null ? -1 : parent.children.indexOf(selected);
  const body: View[] = [caption("構造").padding(space.xs), column(rows), caption("追加").padding(space.xs), row(chips).wrap().gap(space.xs).padding(space.xs)];
  if (target === null) body.push(text("子を追加するには column・row・grid・buttonOf を選んでください。").small().tone("muted").padding(space.xs));
  if (treeNotice.length > 0) body.push(warning(treeNotice).padding(space.xs));
  return column([
    column(body).gap(space.xs).padding(space.sm).fill().scroll(),
    row([
      button("↑", move).arg(-1).variant("ghost").label("選択した部品を上へ移動").enabled(index > 0),
      button("↓", move).arg(1).variant("ghost").label("選択した部品を下へ移動").enabled(parent !== null && index < parent.children.length - 1),
      text("").grow(),
      button("削除", remove).variant("danger").small().label("選択した部品を削除").enabled(parent !== null),
    ]).gap(space.xs).padding(space.sm).divider("top"),
  ]).surface("surface").divider("right").width(240).fill();
}
function codeStatus(): View {
  if (codeError.length > 0) return text("● " + codeError).small().tone("danger");
  return codeDirty ? text("● 未反映の変更があります").small().tone("muted") : text("● 木と一致").small().tone("success");
}
class Designer extends App {
  override build(): View {
    const tree = structure();
    return column([
      row([
        text("デザイナー").bold(), text("見た目だけ・保存しません").small().tone("muted").grow(),
        button("見本に戻す", sample).variant("ghost").small(),
      ]).gap(space.md).padding(space.md).surface("surface").divider("bottom"),
      row([
        tree,
        column([column([preview(root)]).surface("card").width(360).minHeight(420).padding(space.sm)])
          .surface("sunken").center().padding(space.xl).fill().grow().scroll().label("プレビュー"),
        inspector(),
      ]).fill().collapse(),
      column([
        // 狭い画面で長いエラーに押されて折り返さないよう、見出しとボタンは幅を固定する（全角 1 文字 = 1em）。
        row([text("コード").small().tone("muted").width(40), codeStatus().grow(), button("コードから反映", load).variant("ghost").small().width(112).enabled(codeDirty)]).gap(space.sm),
        input(code, editCode).multiline().mono().small().padding(space.xs).height(136).label("Décor のコード").key("designer-code"),
      ]).gap(space.xs).padding(space.md).surface("dark").divider("top"),
    ]).fill();
  }
}
syncFields();
launch(new Designer());
