/** 宣言的 UI の部品と修飾（AssemblyScript）。共通の部品は parts.ts にあり、ここはハンドラーの包み方だけを持つ。 */
import { View, UiCallback, column, row, grid, text, input, appIcon, show, Scale, space, radius, fontSize, Theme, ComponentTheme, theme, intString } from "./parts.ts";
export { View, UiCallback, column, row, grid, text, input, appIcon, show, Scale, space, radius, fontSize, Theme, ComponentTheme, theme, intString };

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
