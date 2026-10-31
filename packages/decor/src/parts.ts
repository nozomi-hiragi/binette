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
  /** ボタンの種類の名前。"" は既定 */
  variantValue: string = "";
  /** 文字の色の名前。"" は既定 */
  toneValue: string = "";
  /** 面の名前。"" は既定 */
  surfaceValue: string = "";
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
  /** 印の枠を付けるか。状態は表さない */
  highlightValue: boolean = false;
  /** checkbox・radio の状態 */
  checkedValue: boolean = false;
  /** slider の値、progress の割合（0〜1。負は不定） */
  numberValue: number = 0;
  /** slider の最小値と最大値 */
  minValue: number = 0;
  maxValue: number = 1;
  /** slider の刻み。0 は刻みなし（連続） */
  stepValue: number = 0;
  /** picker・segmented・tabs の選択肢 */
  optionsValue: Array<string> = [];
  /** picker・segmented・tabs の選択中の番号。-1 は選択なし */
  indexValue: number = -1;
  /** stack などの中での自分の位置の名前。"" は既定 */
  alignValue: string = "";
  /** slider の値を受け取る */
  numberCallback: ((value: number) => void) | null = null;
  /** checkbox の新しい状態を受け取る */
  checkCallback: ((checked: boolean) => void) | null = null;
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
  /** ボタンの種類を選ぶ（button・buttonOf に効く）。色の値は OS が決める。知らない名前は既定に戻す */
  variant(name: string): View { this.variantValue = variants.includes(name) ? name : ""; return this; }
  /** 文字の色を選ぶ（text に効く）。色の値は OS が決める。知らない名前は既定に戻す */
  tone(name: string): View { this.toneValue = tones.includes(name) ? name : ""; return this; }
  /** 面を選ぶ（column・row・grid に効く）。色の値は OS が決める。知らない名前は既定に戻す */
  surface(name: string): View { this.surfaceValue = surfaces.includes(name) ? name : ""; return this; }
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
  /** 選ばれている状態を表す。ボタンは押された状態、ほかの部品はアクセントの細い枠になる */
  selected(b: boolean): View { this.selectedValue = b ? 1 : 0; return this; }
  /** 部品の種類によらず、アクセントの細い枠で印を付ける。状態は変えず、読み上げにも出ない */
  highlight(b: boolean): View { this.highlightValue = b; return this; }
  /** ボタンを入・切のスイッチにする。ボタンの文字は見せず、読み上げの名前に使う */
  toggle(on: boolean): View { this.toggleValue = on ? 1 : 0; return this; }
  /** この部品の中だけをスクロールする */
  scroll(): View { this.scrollValue = true; return this; }
  /** 親の高さいっぱいに広げる */
  fill(): View { this.fillValue = true; return this; }
  /** 幅が狭いとき、子を縦に積んで全幅にする（row に付ける） */
  collapse(): View { this.collapseValue = true; return this; }
  arg(i: number): View { this.argValue = i; return this; }
  /** slider の刻み。0 以下と有限でない値は刻みなし（連続） */
  step(n: number): View { this.stepValue = n > 0 && n != Infinity ? n : 0; return this; }
  /** stack の中での位置を選ぶ（"topStart"・"top"・"topEnd"・"start"・"center"・"end"・"bottomStart"・"bottom"・"bottomEnd"）。
   * column の中では横、row の中では縦の成分だけが効く。知らない名前は既定に戻す */
  align(name: string): View { this.alignValue = alignments.includes(name) ? name : ""; return this; }
}
/** align に使える名前（位置） */
export const alignments: Array<string> = ["topStart", "top", "topEnd", "start", "center", "end", "bottomStart", "bottom", "bottomEnd"];
/** 有限の数ならそのまま、そうでなければ fallback を返す */
function finite(n: number, fallback: number): number { return n == n && n != Infinity && n != -Infinity ? n : fallback; }
/** variant に使える名前（ボタンの種類） */
export const variants: Array<string> = ["primary", "ghost", "subtle", "danger", "dashed"];
/** tone に使える名前（文字の色） */
export const tones: Array<string> = ["muted", "accent", "danger", "success"];
/** surface に使える名前（面） */
export const surfaces: Array<string> = ["surface", "sunken", "card", "dark", "field"];
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
/** row・column の中で余りの場所を埋める。 */
export function spacer(): View { return new View("spacer"); }
/** 区切り線。column の中では横線、row の中では縦線になる。修飾の divider(side) と区別するため separator と呼ぶ */
export function separator(): View { return new View("separator"); }
/** 子を重ねる。子の位置は align(name)、全体の中央ぞろえは center() で選ぶ */
export function stack(children: Array<View>): View { const v = new View("stack"); v.children = children; return v; }
/** チェックボックス。onChange は押したあとの状態を受け取る */
export function checkbox(checked: boolean, onChange: (checked: boolean) => void): View {
  const v = new View("checkbox"); v.checkedValue = checked; v.checkCallback = onChange; return v;
}
/** min から max までの値を選ぶスライダー。onChange は動かしている間も値を受け取る */
export function slider(value: number, min: number, max: number, onChange: (value: number) => void): View {
  const v = new View("slider");
  v.minValue = finite(min, 0);
  v.maxValue = finite(max, v.minValue + 1);
  v.numberValue = finite(value, v.minValue);
  v.numberCallback = onChange;
  return v;
}
/** 線形の進み具合。value は 0〜1 の割合で、負の値（と有限でない値）は終わりの分からない動きになる */
export function progress(value: number): View { const v = new View("progress"); v.numberValue = value >= 0 && value != Infinity ? (value > 1 ? 1 : value) : -1; return v; }
/** 円形の、終わりの分からない進み具合 */
export function spinner(): View { return new View("spinner"); }
/** 画像。src は PNG・JPEG・GIF・WebP の base64 の data URL だけを描き、ほかは描かない。label(s) が代替テキストになる */
export function image(src: string): View { const v = new View("image"); v.value = src; return v; }
/** 先頭・題・副題・末尾を持つ一行。副題が "" なら題だけにする */
export function listTile(title: string, subtitle: string = "", leading: View | null = null, trailing: View | null = null): View {
  const v = new View("listTile");
  const lines: Array<View> = [text(title)];
  if (subtitle.length > 0) lines.push(text(subtitle).small().tone("muted"));
  const children: Array<View> = [];
  if (leading !== null) children.push(leading);
  children.push(column(lines).grow());
  if (trailing !== null) children.push(trailing);
  v.children = children;
  v.gapValue = space.md;
  return v;
}
/** 小さな札。tone(name) で色を選ぶ */
export function chip(label: string): View { const v = new View("chip"); v.value = label; return v; }
/** 数などを示す小さな丸い印。tone(name) で色を選ぶ */
export function badge(value: string): View { const v = new View("badge"); v.value = value; return v; }
/** 選択肢を持つ部品を作る。picker・segmented・tabs の共通部分。番号は整数でなければ -1 にする */
export function choice(kind: string, options: Array<string>, index: number, callback: UiCallback): View {
  const v = new View(kind);
  v.optionsValue = options;
  v.indexValue = index == Math.floor(index) && index >= 0 && index < options.length ? index : -1;
  v.callback = callback;
  return v;
}
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
