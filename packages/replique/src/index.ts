/**
 * アプリが Régie を呼ぶためのライブラリ（AssemblyScript）。
 * 中身は WASM の import で、Régie が `binette` という名前で渡す。
 */

// @ts-ignore: decorator
@external("binette", "elem.text")
declare function setText(name: string, value: string): void;

/** アプリが最後に書いた文字。画面は Worker の外にあって読めないので、写しを手元に持つ */
const texts = new Map<string, string>();

/** HTML で `bina="name"` を付けた要素のまとまり。同じ名前の要素はまとめて変わる */
export class Elem {
  constructor(readonly name: string) {}

  /** このアプリが最後に書いた文字。まだ書いていなければ空文字列 */
  get text(): string {
    return texts.has(this.name) ? texts.get(this.name) : "";
  }

  /** 要素の文字を書き換える */
  set text(value: string) {
    texts.set(this.name, value);
    setText(this.name, value);
  }
}

/** `bina="name"` の要素のまとまりを返す */
export function elem(name: string): Elem {
  return new Elem(name);
}
