// deno-lint-ignore-file no-import-prefix no-unversioned-import
import { App, launch } from "jsr:@binette/replique";
import { View, column, row, grid, text, button, buttonOf, input, theme, Theme, ComponentTheme } from "jsr:@binette/replique/ui";
import { Node, Modifier, container, flag, numeric, numberValue, validNumber, validModifierNumber, stepNumber, formatNumber, parse, write, example } from "./model.ts";

let root = changetype<Node>(parse(example).root);
let selected = root;
let code = write(root);
let notice = "見本を読み込みました。下の欄には部品の式を入力します。";
let nodes: Node[] = [];
const kinds = ["column", "row", "grid", "text", "button", "buttonOf", "input", "appIcon"];
const numbers = ["padding", "gap", "minWidth", "heading", "arg"];
const flags = ["grow", "list", "multiline", "enabled"];
const numberDrafts: string[] = ["", "", "", "", ""];
let valueDraft = "";
let callbackDraft = "() => {}";
function syncFields(): void {
  for (let i = 0; i < numbers.length; i++) {
    const name = numbers[i];
    const value = get(name);
    if (has(name) && value.length == 0 && (name == "padding" || name == "gap")) { numberDrafts[i] = "space.md"; continue; }
    numberDrafts[i] = value.length > 0 && validNumber(value) && !value.startsWith("space.") && !value.startsWith("radius.") && !value.startsWith("fontSize.") ? formatNumber(numberValue(value)) : value;
  }
  valueDraft = selected.value; callbackDraft = selected.callback;
}
function noop(): void {}
function noText(_value: string): void {}
function changed(): void { code = write(root); notice = "木の変更をコードに反映しました。"; }
function findParent(tree: Node, child: Node): Node | null {
  for (let i = 0; i < tree.children.length; i++) {
    if (tree.children[i] == child) return tree;
    const found = findParent(tree.children[i], child);
    if (found !== null) return found;
  }
  return null;
}
function choose(index: i32): void { if (index >= 0 && index < nodes.length) { selected = nodes[index]; syncFields(); } }
function add(index: i32): void {
  const target: Node | null = container(selected.kind) ? selected : findParent(root, selected);
  if (target === null) { notice = "子を追加するには column・row・grid・buttonOf を選んでください。"; return; }
  // 読み込みと同じ上限で書き出せる木を保つ。
  const next = new Node(kinds[index]);
  next.value = next.kind == "appIcon" ? "0" : next.kind == "input" ? "入力" : "文字";
  if (next.kind == "input") next.callback = "(value: string) => {}";
  target.children.push(next);
  const checked = parse(write(root));
  if (checked.root === null) { target.children.pop(); notice = checked.error; return; }
  selected = next; syncFields(); changed();
}
function remove(): void {
  const parent = findParent(root, selected);
  if (parent === null) { notice = "根の部品は削除できません。見本で最初に戻せます。"; return; }
  parent.children.splice(parent.children.indexOf(selected), 1); selected = parent; syncFields(); changed();
}
function move(delta: i32): void {
  const parent = findParent(root, selected);
  if (parent === null) return;
  const index = parent.children.indexOf(selected), next = index + delta;
  if (next < 0 || next >= parent.children.length) return;
  const other = parent.children[next]; parent.children[next] = selected; parent.children[index] = other; changed();
}
function editCode(value: string): void { code = value; }
function load(): void {
  const result = parse(code);
  if (result.root === null) { notice = result.line.toString() + "行 " + result.column.toString() + "列: " + result.error; return; }
  root = changetype<Node>(result.root); selected = root; syncFields(); changed(); notice = "コードを読み込みました。";
}
function sample(): void { root = changetype<Node>(parse(example).root); selected = root; syncFields(); changed(); }
function editValue(value: string): void {
  valueDraft = value;
  if (selected.kind == "appIcon" && !validNumber(value)) { notice = "アイコン番号は有限の数値で指定してください。"; return; }
  selected.value = value; changed();
}
function editCallback(value: string): void {
  callbackDraft = value;
  const old = selected.callback; selected.callback = value;
  const result = parse(write(root));
  if (result.root === null) { selected.callback = old; notice = "コールバック: " + result.error; return; }
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
function editKey(value: string): void { set("key", value); }
function editLabel(value: string): void { set("label", value); }
function editNumber(index: i32, value: string): void {
  numberDrafts[index] = value;
  const name = numbers[index];
  if (value.length == 0) { notice = "数値を入力してください。修飾を外すには「消す」を押してください。"; return; }
  if (!validModifierNumber(name, value)) {
    notice = name == "heading" || name == "arg" ? name + " は整数を入力してください。" : "有限の数値か space.md などの段の名前を入力してください。";
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
  if (!validModifierNumber(name, next)) { notice = "数値が大きすぎます。"; return; }
  set(name, next); numberDrafts[index] = next;
}
function clearNumber(index: i32): void { set(numbers[index], "", false); numberDrafts[index] = ""; }
function toggle(index: i32): void {
  const name = flags[index];
  if (name == "enabled") set(name, get(name, "true") == "true" ? "false" : "true");
  else set(name, "", !has(name));
}
function treeRows(node: Node, depth: i32, rows: View[]): void {
  const index = nodes.length; nodes.push(node);
  let indent = ""; for (let i = 0; i < depth; i++) indent += "　";
  let item = button(indent + (node == selected ? "● " : "○ ") + node.kind + (container(node.kind) ? "" : " · " + node.value), choose).arg(index).label("部品を選択 " + node.kind);
  if (node != selected) {
    const config = new Theme();
    const style = new ComponentTheme(); style.padding = 2; style.radius = 0; style.fontSize = 14;
    config.button = style; item = theme(config, item);
  } else item.padding(8);
  rows.push(item);
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
  return view;
}
class Designer extends App {
  override build(): View {
    nodes = []; const rows: View[] = []; treeRows(root, 0, rows);
    const additions: View[] = [];
    for (let i = 0; i < kinds.length; i++) additions.push(button("＋ " + kinds[i], add).arg(i).label(kinds[i] + " を追加"));
    const inspector: View[] = [text("インスペクター · " + selected.kind).heading(2)];
    if (!container(selected.kind)) inspector.push(column([text(selected.kind == "appIcon" ? "アイコン番号" : "文字"), input(valueDraft, editValue).multiline().label("部品の文字または番号")]).gap(4));
    if (selected.kind == "button" || selected.kind == "buttonOf" || selected.kind == "input") inspector.push(column([text("コールバック式（保存のみ）"), input(callbackDraft, editCallback).multiline().label("コールバック式")]).gap(4));
    inspector.push(row([text("key"), input(get("key"), editKey).label("key").grow()]).gap(4));
    inspector.push(row([text("label"), input(get("label"), editLabel).label("label").grow()]).gap(4));
    for (let i = 0; i < numbers.length; i++) {
      const name = numbers[i];
      let field = input(numberDrafts[i], editPadding);
      if (i == 1) field = input(numberDrafts[i], editGap);
      else if (i == 2) field = input(numberDrafts[i], editMinWidth);
      else if (i == 3) field = input(numberDrafts[i], editHeading);
      else if (i == 4) field = input(numberDrafts[i], editArg);
      inspector.push(row([text(name), field.label(name + " の数値"),
        button("−", step).arg(i * 2).label(name + " を減らす"), button("＋", step).arg(i * 2 + 1).label(name + " を増やす"),
        button("消す", clearNumber).arg(i).label(name + " の修飾を削除")]).gap(4));
    }
    for (let i = 0; i < flags.length; i++) {
      const name = flags[i];
      const active = flag(name) ? has(name) : get(name, "true") == "true";
      inspector.push(row([text(name), button(active ? "true" : "false", toggle).arg(i).label(name + " を切り替える")]).gap(4));
    }
    return column([
      row([text("Décor デザイナー").heading(1).grow(), button("見本に戻す", sample)]).gap(8),
      text("保存は行いません。コールバックはプレビューで実行しません。木を編集すると下のコードも更新されます。"),
      row([
        column([text("部品の木").heading(2), column(rows).gap(4), row([button("削除", remove), button("↑", move).arg(-1).label("選択した部品を上へ移動"), button("↓", move).arg(1).label("選択した部品を下へ移動")]).gap(4), text("部品を追加"), column(additions).gap(4)]).minWidth(180).gap(8),
        column([text("プレビュー").heading(2), preview(root)]).grow().minWidth(220).gap(12).label("プレビュー"),
        column(inspector).minWidth(220).gap(8).key("inspector-" + nodes.indexOf(selected).toString()),
      ]).gap(20),
      text("Décor の部品の式").heading(2),
      input(code, editCode).multiline().label("Décor のコード").key("designer-code"),
      button("コードを読み込む", load), text(notice).label("操作の結果"),
    ]).padding(16).gap(12);
  }
}
syncFields();
launch(new Designer());
