import { View, UiCallback, column, row, grid, text, input, appIcon, show, theme, Theme, Scale, ComponentTheme, space, radius, fontSize, intString } from "../../src/parts.ts";

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
  return view.toneValue + "|" + view.dividerValue + "|" + flag(view.monoValue) + flag(view.smallValue) + flag(view.boldValue) + flag(view.truncateValue) +
    flag(view.centerValue) + flag(view.scrollValue) + flag(view.fillValue) + flag(view.collapseValue) + flag(view.wrapValue) + "|" +
    intString(view.widthValue) + "," + intString(view.heightValue) + "," + intString(view.minHeightValue) + "|" +
    intString(view.selectedValue) + "," + intString(view.toggleValue) + "|" + view.placeholderValue;
}

export function looks(): string {
  const all = row([]).tone("card").divider("left").divider("top").divider("left").divider("middle").mono().small().bold().truncate()
    .center().scroll().fill().collapse().wrap().width(240).height(-3).minHeight(420).selected(true).toggle(false).placeholder("なし");
  const reset = text("x").tone("primary").tone("unknown").width(Infinity).selected(false);
  return lookString(all) + ";" + lookString(reset) + ";" + lookString(text("default"));
}
