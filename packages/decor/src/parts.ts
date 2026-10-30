/** 宣言的 UI の部品と修飾。Deno と asc の両方でそのままコンパイルする。
 *
 * - 型は number・boolean・string・クラス・配列だけ（i32・bool などは使わない）
 * - 数を文字列にするときは intString() を使う（AS の f64 の toString() は `3.0` になる）
 * - AS の組み込み（idof・changetype・ERROR・`<i32>` など）を使わない
 * - 外側の変数をつかむクロージャ、import type、オプショナルチェーン、スプレッドを使わない
 * - @ts-ignore を使わない
 */
/** 宣言的 UI の部品。修飾はこの部品を変更して返す。 */
export class View {
  children: Array<View> = [];
  themeValue: string = "";
  value: string = "";
  paddingValue: number = -100;
  gapValue: number = 0;
  growValue: boolean = false;
  keyValue: string = "";
  labelValue: string = "";
  enabledValue: boolean = true;
  argValue: number = 0;
  callback: UiCallback | null = null;
  textCallback: ((value: string) => void) | null = null;
  minWidthValue: number = 0;
  headingValue: number = 0;
  listValue: boolean = false;
  shownValue: boolean = true;
  appValue: number = -1;
  multilineValue: boolean = false;
  constructor(readonly kind: string) {}
  padding(n: number = space.md): View { this.paddingValue = n; return this; }
  gap(n: number = space.md): View { this.gapValue = n; return this; }
  minWidth(n: number): View { this.minWidthValue = n; return this; }
  grow(): View { this.growValue = true; return this; }
  /** 見出しにする。level は 1〜3（範囲外は丸める）。読み上げでも見出しになる */
  heading(level: number): View { this.headingValue = level < 1 ? 1 : level > 3 ? 3 : level; return this; }
  /** 子を並びとして扱う。読み上げでも一覧と項目になる */
  list(): View { this.listValue = true; return this; }
  key(s: string): View { this.keyValue = s; return this; }
  label(s: string): View { this.labelValue = s; return this; }
  enabled(b: boolean): View { this.enabledValue = b; return this; }
  /** 複数行の入力欄にする。 */
  multiline(): View { this.multilineValue = true; return this; }
  arg(i: number): View { this.argValue = i; return this; }
}
export abstract class UiCallback { abstract call(arg: number): void; }
/** 子を縦に並べる。 */
export function column(children: Array<View>): View { const v = new View("column"); v.children = children; return v; }
/** 子を格子に並べる。 */
export function grid(children: Array<View>): View { const v = new View("grid"); v.children = children; return v; }
/** 文字入力を作る。 */
export function input(value: string, onText: (value: string) => void): View { const v = new View("input"); v.value = value; v.textCallback = onText; return v; }
/** アプリのアイコンを描く。 */
export function appIcon(index: number): View { const v = new View("appIcon"); v.appValue = index; return v; }
/** 部品の表示を切り替える。 */
export function show(condition: boolean, view: View): View { view.shownValue = condition; return view; }
/** 子を横に並べる。 */
export function row(children: Array<View>): View { const v = new View("row"); v.children = children; return v; }
/** 文字を描く。 */
export function text(value: string): View { const v = new View("text"); v.value = value; return v; }
/** 名前付きの段。負の値は CSS 変数への参照を表す。 */
export class Scale {
  xs: number = -100;
  sm: number = -100;
  md: number = -100;
  lg: number = -100;
  xl: number = -100;
}
export const space: Scale = { xs: -1, sm: -2, md: -3, lg: -4, xl: -5 };
export const radius: Scale = { xs: -1, sm: -2, md: -3, lg: -4, xl: -5 };
export const fontSize: Scale = { xs: -1, sm: -2, md: -3, lg: -4, xl: -5 };
/** 部品の既定値。-100 は上書きしない。 */
export class ComponentTheme {
  padding: number = -100;
  radius: number = -100;
  fontSize: number = -100;
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
  let result = prefix + "-px:" + (token ? "0" : lengthString(Math.max(0, value))) + "px;";
  for (let i = 0; i < names.length; i++) result += prefix + "-" + names[i] + ":" + (token && value == -i - 1 ? "1" : "0") + ";";
  return result;
}
function scaleDeclarations(group: string, scale: Scale | null): string {
  if (scale === null) return "";
  const names = ["xs", "sm", "md", "lg", "xl"];
  const values = [scale.xs, scale.sm, scale.md, scale.lg, scale.xl];
  let result = "";
  for (let i = 0; i < values.length; i++) {
    if (values[i] != -100) result += "--bina-ui-" + group + "-" + names[i] + ":" + lengthString(values[i] < 0 ? 0 : values[i]) + "px;";
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
function lengthString(value: number): string {
  return value == Math.floor(value) ? intString(value) : value.toString();
}
/** 整数を文字列にする。小数は切り捨てる。AS の f64 の toString() と違い `.0` を付けない */
export function intString(value: number): string {
  if (value != value) return "NaN";
  if (value == Infinity) return "Infinity";
  if (value == -Infinity) return "-Infinity";
  let n = Math.floor(Math.abs(value));
  let result = "";
  const digits = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
  do {
    const d = n % 10;
    for (let i = 0; i < 10; i++) if (i == d) result = digits[i] + result;
    n = Math.floor(n / 10);
  } while (n > 0);
  return value < 0 ? "-" + result : result;
}
