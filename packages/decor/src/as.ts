/** 宣言的 UI の部品と修飾（AssemblyScript）。共通の部品は parts.ts にあり、ここはハンドラーの包み方だけを持つ。 */
import { View, UiCallback, column, row, grid, text, input, appIcon, appArea, show, Scale, space, radius, fontSize, Theme, ComponentTheme, theme, intString,
  spacer, separator, stack, checkbox, slider, progress, spinner, image, listTile, chip, badge, choice } from "./parts.ts";
export { View, UiCallback, column, row, grid, text, input, appIcon, appArea, show, Scale, space, radius, fontSize, Theme, ComponentTheme, theme, intString,
  spacer, separator, stack, checkbox, slider, progress, spinner, image, listTile, chip, badge };

class TypedUiCallback<T> extends UiCallback {
  constructor(private f: T) {
    super();
    // @ts-ignore: AssemblyScript の型・組み込み関数
    if (idof<T>() != idof<() => void>() && idof<T>() != idof<(i: i32) => void>()) ERROR("ハンドラーは () => void または (i32) => void です");
  }
  call(arg: number): void {
  // @ts-ignore: AssemblyScript の型・組み込み関数
    if (idof<T>() == idof<() => void>()) changetype<() => void>(this.f)();
  // @ts-ignore: AssemblyScript の型・組み込み関数
    else changetype<(i: i32) => void>(this.f)(<i32>arg);
  }
}
export function button<T>(label: string, f: T): View { const v = new View("button"); v.value = label; v.callback = new TypedUiCallback<T>(f); return v; }
export function buttonOf<T>(children: Array<View>, f: T): View { const v = new View("button"); v.children = children; v.callback = new TypedUiCallback<T>(f); return v; }
/** メニューの項目。menu() に渡す。押すと f を呼び、どの項目かは arg(i) で区別する。ハンドラーは button と同じ形 */
export function menuItem<T>(label: string, f: T): View { const v = new View("menuItem"); v.value = label; v.callback = new TypedUiCallback<T>(f); return v; }
/** ラジオボタン。押すと onSelect を呼ぶ。どの値かは arg(i) で区別する。ハンドラーは button と同じ形 */
export function radio<T>(selected: boolean, f: T): View { const v = new View("radio"); v.checkedValue = selected; v.callback = new TypedUiCallback<T>(f); return v; }
/** 選択肢から一つを選ぶ欄（ネイティブの select）。ハンドラーは選んだ番号を (i32) で受け取る */
export function picker<T>(options: Array<string>, index: number, f: T): View { return choice("picker", options, index, new TypedUiCallback<T>(f)); }
/** つながったボタンで一つを選ぶ。ハンドラーは選んだ番号を (i32) で受け取る */
export function segmented<T>(options: Array<string>, index: number, f: T): View { return choice("segmented", options, index, new TypedUiCallback<T>(f)); }
/** タブの見出しの並び。ハンドラーは選んだ番号を (i32) で受け取る。中身はアプリが番号で描き分ける */
export function tabs<T>(options: Array<string>, index: number, f: T): View { return choice("tabs", options, index, new TypedUiCallback<T>(f)); }
