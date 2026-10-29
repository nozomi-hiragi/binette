/** 宣言的 UI の部品と修飾（AssemblyScript）。 */
/** 宣言的 UI の部品。修飾はこの部品を変更して返す。 */
export class View {
  children: Array<View> = [];
  value: string = "";
  // @ts-ignore: AssemblyScript の型・組み込み関数
  paddingValue: i32 = 0;
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
  padding(n: i32): View { this.paddingValue = n; return this; }
  // @ts-ignore: AssemblyScript の型・組み込み関数
  gap(n: i32): View { this.gapValue = n; return this; }
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

