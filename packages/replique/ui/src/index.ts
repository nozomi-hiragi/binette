// deno-lint-ignore-file no-import-prefix no-unversioned-import verbatim-module-syntax
import { View, UiCallback } from "jsr:@binette/decor/as";
import { application, jsonString, setRebuild } from "jsr:@binette/replique-app@^0.1";
export { View, column, row, text, button, buttonOf, input, markdown, filePick, grid, appIcon, appArea, show, theme, space, radius, fontSize, Theme, Scale, ComponentTheme,
  spacer, separator, stack, checkbox, radio, slider, picker, segmented, tabs, progress, spinner, image, listTile, chip, badge, menuItem } from "jsr:@binette/decor/as";

/** この機能が要求するホスト ABI の版。各 external の module 名とテストで一致を確かめる */
export const ABI_VERSION = "0.1";

// @ts-ignore: decorator
@external("binette:ui@0.1", "render")
declare function renderUi(value: string): void;

class UiHandler {
  constructor(readonly callback: UiCallback | null, readonly arg: number, readonly textCallback: ((value: string) => void) | null,
    readonly numberCallback: ((value: f64) => void) | null, readonly checkCallback: ((checked: boolean) => void) | null, readonly indexed: boolean) {}
}
let uiHandlers: Array<UiHandler> = [];
let uiBuild: i32 = 0;

function serializeView(view: View): string {
  let handler: i32 = -1;
  const callback = view.callback;
  if (callback !== null || view.textCallback !== null || view.numberCallback !== null || view.checkCallback !== null) {
    handler = uiHandlers.length;
    const indexed = view.kind == "picker" || view.kind == "segmented" || view.kind == "tabs";
    uiHandlers.push(new UiHandler(callback, view.argValue, view.textCallback, view.numberCallback, view.checkCallback, indexed));
  }
  let options = "[";
  for (let i = 0; i < view.optionsValue.length; i++) options += (i > 0 ? "," : "") + jsonString(view.optionsValue[i]);
  options += "]";
  let children = "[";
  for (let i = 0; i < view.children.length; i++) {
    if (i > 0) children += ",";
    children += serializeView(view.children[i]);
  }
  children += "]";
  return '{"kind":' + jsonString(view.kind) + ',"children":' + children +
    ',"base":' + jsonString(view.baseValue) + ',"anchor":' + jsonString(view.anchorValue) + ',"text":' + jsonString(view.value) + ',"padding":' + (view.paddingValue == -100 ? "null" : view.paddingValue.toString()) +
    ',"theme":' + jsonString(view.themeValue) + ',"gap":' + view.gapValue.toString() + ',"grow":' + (view.growValue ? "true" : "false") +
    ',"key":' + jsonString(view.keyValue) + ',"label":' + jsonString(view.labelValue) +
    ',"minWidth":' + view.minWidthValue.toString() + ',"heading":' + view.headingValue.toString() + ',"list":' + (view.listValue ? "true" : "false") + ',"shown":' + (view.shownValue ? "true" : "false") + ',"multiline":' + (view.multilineValue ? "true" : "false") + ',"app":' + view.appValue.toString() + ',"enabled":' + (view.enabledValue ? "true" : "false") + ',"handler":' + handler.toString() +
    ',"variant":' + jsonString(view.variantValue) + ',"tone":' + jsonString(view.toneValue) + ',"surface":' + jsonString(view.surfaceValue) + ',"divider":' + jsonString(view.dividerValue) + ',"mono":' + (view.monoValue ? "true" : "false") +
    ',"small":' + (view.smallValue ? "true" : "false") + ',"bold":' + (view.boldValue ? "true" : "false") + ',"truncate":' + (view.truncateValue ? "true" : "false") +
    ',"width":' + view.widthValue.toString() + ',"center":' + (view.centerValue ? "true" : "false") + ',"selected":' + view.selectedValue.toString() +
    ',"toggle":' + view.toggleValue.toString() + ',"scroll":' + (view.scrollValue ? "true" : "false") + ',"fill":' + (view.fillValue ? "true" : "false") +
    ',"collapse":' + (view.collapseValue ? "true" : "false") + ',"placeholder":' + jsonString(view.placeholderValue) +
    ',"height":' + view.heightValue.toString() + ',"minHeight":' + view.minHeightValue.toString() + ',"wrap":' + (view.wrapValue ? "true" : "false") + ',"highlight":' + (view.highlightValue ? "true" : "false") + ',"tip":' + jsonString(view.tipValue) +
    ',"checked":' + (view.checkedValue ? "true" : "false") + ',"value":' + view.numberValue.toString() + ',"min":' + view.minValue.toString() +
    ',"max":' + view.maxValue.toString() + ',"step":' + view.stepValue.toString() + ',"options":' + options + ',"index":' + view.indexValue.toString() +
    ',"align":' + jsonString(view.alignValue) + '}';
}

export function rebuild(): void {
  const app = application;
  if (app === null) return;
  const view = app.build();
  if (view === null) return;
  if (uiBuild == 2147483647) throw new Error("UI の build 番号を使い切りました");
  uiBuild++;
  uiHandlers = [];
  const root = serializeView(view);
  renderUi('{"build":' + uiBuild.toString() + ',"root":' + root + '}');
}

/** Régie が宣言的 UI のイベントを届ける */
export function __bina_ui_event(build: i32, handler: i32): void {
  if (build != uiBuild || handler < 0 || handler >= uiHandlers.length) return;
  const entry = uiHandlers[handler];
  const callback = entry.callback;
  if (callback === null) return;
  callback.call(entry.arg);
  rebuild();
}

export function __bina_ui_text(build: i32, handler: i32, value: string): void {
  if (build != uiBuild || handler < 0 || handler >= uiHandlers.length) return;
  const callback = uiHandlers[handler].textCallback;
  if (callback === null) return;
  callback(value);
  rebuild();
}

/** Régie が値を返す部品の操作を届ける。slider は数、checkbox は 0 か 1、picker・segmented・tabs は番号。radio は arg(i) の値で呼ぶ */
export function __bina_ui_value(build: i32, handler: i32, value: f64): void {
  if (build != uiBuild || handler < 0 || handler >= uiHandlers.length) return;
  const entry = uiHandlers[handler];
  const numberCallback = entry.numberCallback;
  const checkCallback = entry.checkCallback;
  const callback = entry.callback;
  if (numberCallback !== null) numberCallback(value);
  else if (checkCallback !== null) checkCallback(value != 0);
  else if (callback !== null) callback.call(entry.indexed ? value : entry.arg);
  else return;
  rebuild();
}

setRebuild(rebuild);
