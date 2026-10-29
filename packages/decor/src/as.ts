/** 宣言的 UI の部品と修飾（AssemblyScript）。 */
/** 宣言的 UI の部品。修飾はこの部品を変更して返す。 */
export class View {
  children: Array<View> = [];
  themeValue: string = "";
  value: string = "";
  // @ts-ignore: AssemblyScript の型・組み込み関数
  paddingValue: i32 = -100;
  // @ts-ignore: AssemblyScript の型・組み込み関数
  gapValue: i32 = 0;
  // @ts-ignore: AssemblyScript の型・組み込み関数
  growValue: bool = false;
  keyValue: string = "";
  labelValue: string = "";
  // @ts-ignore: AssemblyScript の型・組み込み関数
  enabledValue: bool = true;
  // @ts-ignore: AssemblyScript の型・組み込み関数
  argValue: i32 = 0;
  callback: UiCallback | null = null;
  textCallback: ((value: string) => void) | null = null;
  minWidthValue: number = 0;
  // @ts-ignore: AssemblyScript の型・組み込み関数
  headingValue: i32 = 0;
  // @ts-ignore: AssemblyScript の型・組み込み関数
  listValue: bool = false;
  shownValue: boolean = true;
  appValue: number = -1;
  constructor(readonly kind: string) {}
  // @ts-ignore: AssemblyScript の型・組み込み関数
  padding(n: i32 = space.md): View { this.paddingValue = n; return this; }
  // @ts-ignore: AssemblyScript の型・組み込み関数
  gap(n: i32 = space.md): View { this.gapValue = n; return this; }
  minWidth(n: number): View { this.minWidthValue = n; return this; }
  grow(): View { this.growValue = true; return this; }
  /** 見出しにする。level は 1〜3（範囲外は丸める）。読み上げでも見出しになる */
  // @ts-ignore: AssemblyScript の型・組み込み関数
  heading(level: i32): View { this.headingValue = level < 1 ? 1 : level > 3 ? 3 : level; return this; }
  /** 子を並びとして扱う。読み上げでも一覧と項目になる */
  list(): View { this.listValue = true; return this; }
  key(s: string): View { this.keyValue = s; return this; }
  label(s: string): View { this.labelValue = s; return this; }
  // @ts-ignore: AssemblyScript の型・組み込み関数
  enabled(b: bool): View { this.enabledValue = b; return this; }
  // @ts-ignore: AssemblyScript の型・組み込み関数
  arg(i: i32): View { this.argValue = i; return this; }
}

export abstract class UiCallback { abstract call(arg: number): void; }
class TypedUiCallback<T> extends UiCallback {
  constructor(private f: T) {
    super();
    // @ts-ignore: AssemblyScript のコンパイル時型検査
    if (idof<T>() != idof<() => void>() && idof<T>() != idof<(i: i32) => void>()) ERROR("ハンドラーは () => void または (i32) => void です");
  }
  call(arg: number): void {
  // @ts-ignore: AssemblyScript の型・組み込み関数
    if (idof<T>() == idof<() => void>()) changetype<() => void>(this.f)();
  // @ts-ignore: AssemblyScript の型・組み込み関数
    else changetype<(i: i32) => void>(this.f)(<i32>arg);
  }
}
export function column(children: Array<View>): View { const v = new View("column"); v.children = children; return v; }
export function grid(children: Array<View>): View { const v = new View("grid"); v.children = children; return v; }
export function input(value: string, onText: (value: string) => void): View { const v = new View("input"); v.value = value; v.textCallback = onText; return v; }
// @ts-ignore: AssemblyScript の整数型
export function appIcon(index: i32): View { const v = new View("appIcon"); v.appValue = index; return v; }
export function show(condition: boolean, view: View): View { view.shownValue = condition; return view; }
export function row(children: Array<View>): View { const v = new View("row"); v.children = children; return v; }
export function text(value: string): View { const v = new View("text"); v.value = value; return v; }
export function button<T>(label: string, f: T): View { const v = new View("button"); v.value = label; v.callback = new TypedUiCallback<T>(f); return v; }
export function buttonOf<T>(children: Array<View>, f: T): View { const v = new View("button"); v.children = children; v.callback = new TypedUiCallback<T>(f); return v; }

/** 名前付きの段。負の値は CSS 変数への参照を表す。 */
export class Scale {
  // @ts-ignore: AssemblyScript の整数型
  xs: i32 = -100;
  // @ts-ignore: AssemblyScript の整数型
  sm: i32 = -100;
  // @ts-ignore: AssemblyScript の整数型
  md: i32 = -100;
  // @ts-ignore: AssemblyScript の整数型
  lg: i32 = -100;
  // @ts-ignore: AssemblyScript の整数型
  xl: i32 = -100;
}
export const space: Scale = { xs: -1, sm: -2, md: -3, lg: -4, xl: -5 };
export const radius: Scale = { xs: -1, sm: -2, md: -3, lg: -4, xl: -5 };
export const fontSize: Scale = { xs: -1, sm: -2, md: -3, lg: -4, xl: -5 };
/** 部品の既定値。-100 は上書きしない。 */
export class ComponentTheme {
  // @ts-ignore: AssemblyScript の整数型
  padding: i32 = -100;
  // @ts-ignore: AssemblyScript の整数型
  radius: i32 = -100;
  // @ts-ignore: AssemblyScript の整数型
  fontSize: i32 = -100;
}
/** 部分木に適用するテーマ。省略した値は親から受け継ぐ。 */
export class Theme {
  space: Scale | null = null;
  radius: Scale | null = null;
  fontSize: Scale | null = null;
  button: ComponentTheme | null = null;
  input: ComponentTheme | null = null;
}
function componentLength(kind: string, field: string, value: number): string {
  const names = ["xs", "sm", "md", "lg", "xl"];
  const token = value >= -5 && value <= -1 && value == Math.floor(value);
  const prefix = "--bina-ui-" + kind + "-" + field;
  // @ts-ignore: AssemblyScript の整数型
  let result = prefix + "-px:" + (token ? "0" : i32(Math.max(0, value)).toString()) + "px;";
  for (let i = 0; i < names.length; i++) result += prefix + "-" + names[i] + ":" + (token && value == -i - 1 ? "1" : "0") + ";";
  return result;
}
function scaleDeclarations(group: string, scale: Scale | null): string {
  if (scale === null) return "";
  const names = ["xs", "sm", "md", "lg", "xl"];
  const values = [scale.xs, scale.sm, scale.md, scale.lg, scale.xl];
  let result = "";
  for (let i = 0; i < values.length; i++) {
    if (values[i] != -100) result += "--bina-ui-" + group + "-" + names[i] + ":" + (values[i] < 0 ? 0 : values[i]).toString() + "px;";
  }
  return result;
}
function componentDeclarations(kind: string, value: ComponentTheme | null): string {
  if (value === null) return "";
  let result = "";
  if (value.padding != -100) result += componentLength(kind, "padding", value.padding);
  if (value.radius != -100) result += componentLength(kind, "radius", value.radius);
  if (value.fontSize != -100) result += componentLength(kind, "font-size", value.fontSize);
  return result;
}
/** 要素を増やさず、この View を根とする部分木のテーマを設定する。 */
export function theme(config: Theme, view: View): View {
  view.themeValue = scaleDeclarations("space", config.space) + scaleDeclarations("radius", config.radius) +
    scaleDeclarations("font-size", config.fontSize) + componentDeclarations("button", config.button) + componentDeclarations("input", config.input) + view.themeValue;
  return view;
}
