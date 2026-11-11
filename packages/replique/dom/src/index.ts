// deno-lint-ignore-file no-import-prefix no-namespace
import { rebuild } from "jsr:@binette/replique-ui@^0.1";

/** この機能が要求するホスト ABI の版。各 external の module 名とテストで一致を確かめる */
export const ABI_VERSION = "0.1";

// @ts-ignore: decorator
@external("binette:dom@0.1", "byId")
declare function byId(handle: i32, id: string): void;

// @ts-ignore: decorator
@external("binette:dom@0.1", "create")
declare function create(handle: i32, tag: string): void;

// @ts-ignore: decorator
@external("binette:dom@0.1", "text")
declare function domText(handle: i32, value: string): void;

// @ts-ignore: decorator
@external("binette:dom@0.1", "class")
declare function className(handle: i32, value: string): void;

// @ts-ignore: decorator
@external("binette:dom@0.1", "append")
declare function append(parent: i32, child: i32): void;

// @ts-ignore: decorator
@external("binette:dom@0.1", "remove")
declare function remove(handle: i32): void;

// @ts-ignore: decorator
@external("binette:dom@0.1", "listen")
declare function listen(handle: i32, type: string, listener: i32): void;

// @ts-ignore: decorator
@external("binette:dom@0.1", "unlisten")
declare function unlisten(handle: i32, type: string, listener: i32): void;

let nextHandle: i32 = 1;
const elements = new Map<string, Element>();
let nextListener: i32 = 0;
const listeners = new Map<i32, Listener>();

class Listener {
  constructor(readonly type: string, readonly target: Element, readonly callback: (event: Event) => void) {}
}

/** リスナーを付けた要素とイベントの種類 */
export class Event {
  constructor(readonly type: string, readonly currentTarget: Element) {}
}

/** 番号で参照する要素。読み取り値はアプリが最後に書いた値 */
export class Element {
  private textValue: string = "";
  private classValue: string = "";
  private parent: Element | null = null;
  private children: Array<Element> = [];
  private listenerIds: Array<i32> = [];
  private released: boolean = false;
  private id: string;
  readonly handle: i32;
  constructor(handle: i32, id: string = "") { this.handle = handle; this.id = id; }

  private detach(): void {
    const parent = this.parent;
    if (parent !== null) {
      const index = parent.children.indexOf(this);
      if (index >= 0) parent.children.splice(index, 1);
      this.parent = null;
    }
  }

  private release(): void {
    if (this.released) return;
    while (this.children.length > 0) this.children[this.children.length - 1].release();
    for (let i = 0; i < this.listenerIds.length; i++) listeners.delete(this.listenerIds[i]);
    this.listenerIds = [];
    if (elements.has(this.id) && elements.get(this.id) === this) elements.delete(this.id);
    this.detach();
    this.released = true;
  }

  get textContent(): string { return this.textValue; }
  /** 子をすべて消して文字だけにする */
  set textContent(value: string) {
    if (this.released) return;
    while (this.children.length > 0) this.children[this.children.length - 1].release();
    this.textValue = value;
    domText(this.handle, value);
  }
  get className(): string { return this.classValue; }
  set className(value: string) {
    if (this.released) return;
    this.classValue = value;
    className(this.handle, value);
  }
  appendChild(child: Element): Element {
    if (this.released || child.released) return child;
    if (this === child) return child;
    let ancestor: Element | null = this.parent;
    while (ancestor !== null) {
      if (ancestor === child) return child;
      ancestor = ancestor.parent;
    }
    child.detach();
    child.parent = this;
    this.children.push(child);
    append(this.handle, child.handle);
    return child;
  }
  remove(): void {
    if (this.released) return;
    this.release();
    remove(this.handle);
  }
  addEventListener(type: string, listener: (event: Event) => void): void {
    if (this.released) return;
    if (nextListener == 2147483647) throw new Error("リスナー番号を使い切りました");
    const index = nextListener++;
    listeners.set(index, new Listener(type, this, listener));
    this.listenerIds.push(index);
    listen(this.handle, type, index);
  }
  removeEventListener(type: string, listener: (event: Event) => void): void {
    if (this.released) return;
    for (let i = 0; i < this.listenerIds.length; i++) {
      const index = this.listenerIds[i];
      const entry = listeners.get(index)!;
      if (entry.type === type && entry.callback === listener) {
        listeners.delete(index);
        this.listenerIds.splice(i, 1);
        unlisten(this.handle, type, index);
        return;
      }
    }
  }
}

export namespace document {
  export function getElementById(id: string): Element {
    if (elements.has(id)) return elements.get(id)!;
    const element = new Element(nextHandle++, id);
    elements.set(id, element);
    byId(element.handle, id);
    return element;
  }
  export function createElement(tag: string): Element {
    const element = new Element(nextHandle++);
    create(element.handle, tag);
    return element;
  }
}

/** Régie がイベントのときに呼ぶ */
export function __bina_event(listener: i32): void {
  if (!listeners.has(listener)) return;
  const entry = listeners.get(listener)!;
  entry.callback(new Event(entry.type, entry.target));
  rebuild();
}

/** テスト用に保持中のリスナー数を返す */
export function __bina_listener_count(): i32 { return listeners.size; }

/** テスト用に ID で保持中の要素数を返す */
export function __bina_element_count(): i32 { return elements.size; }
