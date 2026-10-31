import { View, UiCallback, column, row, grid, text, input, appIcon, show, theme, Theme, Scale, ComponentTheme, space, radius, fontSize, intString,
  spacer, separator, stack, checkbox, slider, progress, spinner, image, listTile, chip, badge, choice } from "../../src/parts.ts";

class Callback extends UiCallback {
  call(_arg: number): void {}
}
function edit(_value: string): void {}

export function tree(): View {
  const config = new Theme();
  const scale = new Scale();
  scale.xs = 0; scale.sm = -3; scale.md = 17; scale.lg = 20; scale.xl = 123456789;
  config.space = scale;
  config.radius = scale;
  config.fontSize = scale;
  const defaults = new ComponentTheme();
  defaults.padding = space.md; defaults.radius = radius.sm; defaults.fontSize = fontSize.lg;
  config.button = defaults;
  config.input = defaults;
  const inner = new Theme();
  const sizes = new Scale(); sizes.md = 19; inner.space = sizes;
  const button = new View("button"); button.callback = new Callback();
  return theme(config, theme(inner, column([
    row([text("title").heading(9), text("subtitle").heading(-2)]).list().gap(),
    grid([input("value", edit).enabled(false).label("edit"), appIcon(2)]).minWidth(42).grow(),
    show(false, button.arg(-7).key("action")),
  ]).padding().gap(0)));
}

export function integers(): string {
  return intString(0) + "," + intString(-0) + "," + intString(-42) + "," + intString(1234567890123) + "," + intString(9007199254740991);
}

export function nonFinite(): string {
  return intString(NaN) + "," + intString(Infinity) + "," + intString(-Infinity);
}

export function multiline(): string {
  const view = input("first\nsecond", edit).multiline();
  return view.kind + ":" + (view.multilineValue ? "true" : "false") + ":" + intString(view.appValue) + ":" + view.value;
}

function flag(value: boolean): string { return value ? "1" : "0"; }
function lookString(view: View): string {
  return view.variantValue + "|" + view.toneValue + "|" + view.surfaceValue + "|" + view.dividerValue + "|" + flag(view.monoValue) + flag(view.smallValue) + flag(view.boldValue) + flag(view.truncateValue) +
    flag(view.centerValue) + flag(view.scrollValue) + flag(view.fillValue) + flag(view.collapseValue) + flag(view.wrapValue) + "|" +
    intString(view.widthValue) + "," + intString(view.heightValue) + "," + intString(view.minHeightValue) + "|" +
    intString(view.selectedValue) + "," + intString(view.toggleValue) + "|" + view.placeholderValue + "|" + flag(view.highlightValue);
}

export function looks(): string {
  const all = row([]).variant("ghost").tone("muted").surface("card").divider("left").divider("top").divider("left").divider("middle").mono().small().bold().truncate()
    .center().scroll().fill().collapse().wrap().width(240).height(-3).minHeight(420).selected(true).toggle(false).placeholder("なし").highlight(true);
  const reset = text("x").variant("dashed").variant("unknown").tone("accent").tone("card").surface("dark").surface("primary").width(Infinity).selected(false).highlight(true).highlight(false);
  return lookString(all) + ";" + lookString(reset) + ";" + lookString(text("default"));
}

function checked(_value: boolean): void {}
function moved(_value: number): void {}
function partString(view: View): string {
  let options = "";
  for (let i = 0; i < view.optionsValue.length; i++) options += (i > 0 ? "/" : "") + view.optionsValue[i];
  let kinds = "";
  for (let i = 0; i < view.children.length; i++) kinds += (i > 0 ? "+" : "") + view.children[i].kind;
  return view.kind + ":" + view.value + ":" + flag(view.checkedValue) + ":" + view.numberValue.toString() + "," + view.minValue.toString() + "," + view.maxValue.toString() + "," + view.stepValue.toString() +
    ":" + options + ":" + intString(view.indexValue) + ":" + view.alignValue + ":" + kinds + ":" + intString(view.gapValue) +
    ":" + flag(view.numberCallback !== null) + flag(view.checkCallback !== null) + flag(view.callback !== null);
}

/** 新しい部品の値と、範囲外・有限でない値の扱い。数は小数を含むので toString の違いが出ないものだけを使う */
export function newParts(): string {
  const views = [
    spacer(), separator(), stack([text("下"), badge("3").align("topEnd"), text("x").align("middle")]).center(),
    checkbox(true, checked), slider(0.5, 0, 2, moved).step(0.25), slider(NaN, Infinity, NaN, moved).step(-1),
    progress(0.25), progress(-1), progress(7), progress(NaN), spinner(), image("data:image/png;base64,AAAA"),
    listTile("題", "副題", chip("札"), checkbox(false, checked)), listTile("題だけ"),
    chip("札").tone("accent"), badge("12"),
    choice("picker", ["一", "二"], 1, new Callback()), choice("tabs", ["一"], 1.5, new Callback()), choice("segmented", ["一", "二"], 2, new Callback()),
  ];
  let out = "";
  for (let i = 0; i < views.length; i++) out += (i > 0 ? "\n" : "") + partString(views[i]);
  const children = views[2].children;
  for (let i = 0; i < children.length; i++) out += "\n" + children[i].kind + "@" + children[i].alignValue;
  return out;
}
