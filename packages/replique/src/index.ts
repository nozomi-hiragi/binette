/**
 * アプリが Régie を呼ぶためのライブラリ（AssemblyScript）。
 * 中身は WASM の import で、Régie が `binette` という名前で渡す。
 */

/** 画面の書き換え */
export namespace ui {
  /** `data-text="name"` の要素の文字を `value` に書き換える */
  // @ts-ignore: decorator
  @external("binette", "ui.text")
  export declare function text(name: string, value: string): void;
}
