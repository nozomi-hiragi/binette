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
    return texts.has(this.name) ? texts.get(this.name)! : "";
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

// @ts-ignore: decorator
@external("binette", "list.add")
// @ts-ignore: AssemblyScript の整数型
declare function addRow(name: string): i32;
// @ts-ignore: decorator
@external("binette", "list.clear")
declare function clearRows(name: string): void;
// @ts-ignore: decorator
@external("binette", "item.text")
// @ts-ignore: AssemblyScript の整数型
declare function setItemText(list: string, row: i32, name: string, value: string): void;
// @ts-ignore: decorator
@external("binette", "item.icon")
// @ts-ignore: AssemblyScript の整数型
declare function setItemIcon(list: string, row: i32, app: i32): void;

/** 一覧の行の中の要素 */
export class ItemElem {
  // @ts-ignore: AssemblyScript の整数型
  constructor(readonly list: string, readonly row: i32, readonly name: string) {}

  /** 行の中の要素の文字を書き換える */
  set text(value: string) {
    setItemText(this.list, this.row, this.name, value);
  }
}

/** 一覧の行。番号は 0 から */
export class Item {
  // @ts-ignore: AssemblyScript の整数型
  constructor(readonly list: string, readonly row: i32) {}

  elem(name: string): ItemElem { return new ItemElem(this.list, this.row, name); }
  // @ts-ignore: AssemblyScript の整数型
  icon(app: i32): void { setItemIcon(this.list, this.row, app); }
}

/** HTML の template に対応する一覧 */
export class List {
  constructor(readonly name: string) {}

  add(): Item { return new Item(this.name, addRow(this.name)); }
  clear(): void { clearRows(this.name); }
}

export function list(name: string): List { return new List(name); }

/** ホームだけが使えるアプリの一覧と起動 */
export namespace apps {
  // @ts-ignore: decorator
  @external("binette", "apps.count")
  // @ts-ignore: AssemblyScript の整数型
  export declare function count(): i32;
  // @ts-ignore: decorator
  @external("binette", "apps.name")
  // @ts-ignore: AssemblyScript の整数型
  export declare function name(i: i32): string;
  // @ts-ignore: decorator
  @external("binette", "apps.id")
  // @ts-ignore: AssemblyScript の整数型
  export declare function id(i: i32): string;
  // @ts-ignore: decorator
  @external("binette", "apps.open")
  // @ts-ignore: AssemblyScript の整数型
  export declare function open(i: i32): void;
}
