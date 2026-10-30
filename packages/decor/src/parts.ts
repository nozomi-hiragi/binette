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
  /** 役割の色・面の名前。"" は既定 */
  toneValue: string = "";
  /** 区切り線を引く辺を空白で区切った並び。"" は無し */
  dividerValue: string = "";
  monoValue: boolean = false;
  smallValue: boolean = false;
  boldValue: boolean = false;
  truncateValue: boolean = false;
  /** 固定の幅（px）。0 は指定なし */
  widthValue: number = 0;
  centerValue: boolean = false;
  /** 選ばれている状態。-1 は指定なし、0 は選ばれていない、1 は選ばれている */
  selectedValue: number = -1;
  /** スイッチの状態。-1 はスイッチでない、0 は切、1 は入 */
  toggleValue: number = -1;
  scrollValue: boolean = false;
  fillValue: boolean = false;
  collapseValue: boolean = false;
  /** 入力欄の placeholder。"" は無し */
  placeholderValue: string = "";
  /** 固定の高さ（px）。0 は指定なし */
  heightValue: number = 0;
  /** 最小の高さ（px）。0 は指定なし */
  minHeightValue: number = 0;
  wrapValue: boolean = false;
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
  /** 役割の色・面を選ぶ。値は OS が決める。知らない名前は既定に戻す */
  tone(name: string): View { this.toneValue = tones.includes(name) ? name : ""; return this; }
  /** 辺（"top"・"right"・"bottom"・"left"）に 1px の区切り線を引く。複数の辺は複数回呼ぶ */
  divider(side: string): View {
    if (!dividerSides.includes(side)) return this;
    const current = " " + this.dividerValue + " ";
    let result = "";
    for (let i = 0; i < dividerSides.length; i++) {
      const name = dividerSides[i];
      if (name == side || current.indexOf(" " + name + " ") >= 0) result += (result.length > 0 ? " " : "") + name;
    }
    this.dividerValue = result;
    return this;
  }
  /** 等幅の字体にする */
  mono(): View { this.monoValue = true; return this; }
  /** 小さめの文字にする */
  small(): View { this.smallValue = true; return this; }
  /** 太字にする */
  bold(): View { this.boldValue = true; return this; }
  /** 1 行に収め、はみ出しは「…」にする */
  truncate(): View { this.truncateValue = true; return this; }
  /** 固定の幅（px）にし、flex で縮めない。0 以下と有限でない値は指定なし */
  width(n: number): View { this.widthValue = n > 0 && n != Infinity ? n : 0; return this; }
  /** 固定の高さ（px）にし、flex で縮めない。0 以下と有限でない値は指定なし */
  height(n: number): View { this.heightValue = n > 0 && n != Infinity ? n : 0; return this; }
  /** 最小の高さ（px）。0 以下と有限でない値は指定なし */
  minHeight(n: number): View { this.minHeightValue = n > 0 && n != Infinity ? n : 0; return this; }
  /** 入力欄が空のときに見せる文字 */
  placeholder(s: string): View { this.placeholderValue = s; return this; }
  /** row の子を折り返して並べる */
  wrap(): View { this.wrapValue = true; return this; }
  /** 子を縦横の中央に置く */
  center(): View { this.centerValue = true; return this; }
  /** 選ばれている状態を表す。ボタンは押された状態、ほかの部品はアクセントの枠線になる */
  selected(b: boolean): View { this.selectedValue = b ? 1 : 0; return this; }
  /** ボタンを入・切のスイッチにする。ボタンの文字は見せず、読み上げの名前に使う */
  toggle(on: boolean): View { this.toggleValue = on ? 1 : 0; return this; }
  /** この部品の中だけをスクロールする */
  scroll(): View { this.scrollValue = true; return this; }
  /** 親の高さいっぱいに広げる */
  fill(): View { this.fillValue = true; return this; }
  /** 幅が狭いとき、子を縦に積んで全幅にする（row に付ける） */
  collapse(): View { this.collapseValue = true; return this; }
  arg(i: number): View { this.argValue = i; return this; }
}
/** tone に使える名前。button・text・column などで意味が分かれる */
export const tones: Array<string> = ["primary", "ghost", "subtle", "danger", "dashed", "muted", "accent", "success", "surface", "sunken", "card", "dark", "field"];
/** divider に使える辺 */
export const dividerSides: Array<string> = ["top", "right", "bottom", "left"];
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
