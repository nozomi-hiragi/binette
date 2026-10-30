// deno-lint-ignore-file no-import-prefix no-unversioned-import no-namespace verbatim-module-syntax
/** アプリが Régie を呼ぶためのライブラリ（AssemblyScript）。 */
import { View, UiCallback } from "jsr:@binette/decor/as";
export { View, column, row, text, button, buttonOf, input, grid, appIcon, show, theme, space, radius, fontSize, Theme, Scale, ComponentTheme } from "jsr:@binette/decor/as";
// @ts-ignore: decorator
@external("binette", "dom.byId")
declare function byId(handle: i32, id: string): void;

// @ts-ignore: decorator
@external("binette", "dom.create")
declare function create(handle: i32, tag: string): void;

// @ts-ignore: decorator
@external("binette", "dom.text")
declare function domText(handle: i32, value: string): void;

// @ts-ignore: decorator
@external("binette", "dom.class")
declare function className(handle: i32, value: string): void;

// @ts-ignore: decorator
@external("binette", "dom.append")
declare function append(parent: i32, child: i32): void;

// @ts-ignore: decorator
@external("binette", "dom.remove")
declare function remove(handle: i32): void;

// @ts-ignore: decorator
@external("binette", "dom.listen")
declare function listen(handle: i32, type: string, listener: i32): void;

// @ts-ignore: decorator
@external("binette", "dom.unlisten")
declare function unlisten(handle: i32, type: string, listener: i32): void;

// @ts-ignore: decorator
@external("binette", "apps.icon")
declare function iconImport(handle: i32, app: i32): void;

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

/** ホームだけが使えるアプリの一覧と起動 */
export namespace apps {
  /** img に OS のアプリアイコンを入れる */
  export function icon(img: Element, i: i32): void { iconImport(img.handle, i); }
  // @ts-ignore: decorator
  @external("binette", "apps.count")
  export declare function count(): i32;
  // @ts-ignore: decorator
  @external("binette", "apps.name")
  export declare function name(i: i32): string;
  // @ts-ignore: decorator
  @external("binette", "apps.id")
  export declare function id(i: i32): string;
  // @ts-ignore: decorator
  @external("binette", "apps.open")
  export declare function open(i: i32): void;
}

/** システムの設定アプリだけが使える OS の設定と起動の履歴 */
export namespace os {
  // @ts-ignore: decorator
  @external("binette", "os.get")
  export declare function get(name: string): i32;
  // @ts-ignore: decorator
  @external("binette", "os.set")
  export declare function set(name: string, value: i32): bool;
  // @ts-ignore: decorator
  @external("binette", "os.home")
  export declare function home(): string;
  // @ts-ignore: decorator
  @external("binette", "os.homeCount")
  export declare function homeCount(): i32;
  // @ts-ignore: decorator
  @external("binette", "os.homeName")
  export declare function homeName(i: i32): string;
  // @ts-ignore: decorator
  @external("binette", "os.homeId")
  export declare function homeId(i: i32): string;
  // @ts-ignore: decorator
  @external("binette", "os.setHome")
  export declare function setHome(i: i32): void;
  // @ts-ignore: decorator
  @external("binette", "os.launchCount")
  export declare function launchCount(): i32;
  // @ts-ignore: decorator
  @external("binette", "os.launchTime")
  export declare function launchTime(i: i32): f64;
  // @ts-ignore: decorator
  @external("binette", "os.launchName")
  export declare function launchName(i: i32): string;
}

/** インスタンスの状態。None は前の記録が無いことを表す */
export enum State { None, Create, Start, Resume, Pause, Stop, Destroy }
export enum DestroyKind { User, System }
export enum DestroyCause { Os, App, Stack, Update, Uninstall }

/** インスタンスを捨てる理由 */
export class DestroyReason {
  constructor(readonly kind: DestroyKind, readonly cause: DestroyCause) {}
}

/** 前回の最後の記録 */
export class Last {
  constructor(readonly state: State, readonly done: boolean, readonly page: string, readonly reason: DestroyReason) {}
}

// @ts-ignore: decorator
@external("binette", "app.page")
declare function pageImport(): string;
// @ts-ignore: decorator
@external("binette", "app.lastPage")
declare function lastPageImport(): string;
// @ts-ignore: decorator
@external("binette", "app.lastKind")
declare function lastKindImport(): DestroyKind;
// @ts-ignore: decorator
@external("binette", "app.lastCause")
declare function lastCauseImport(): DestroyCause;
// @ts-ignore: decorator
@external("binette", "app.finish")
declare function finishImport(): void;

// @ts-ignore: decorator
@external("binette", "ui.render")
declare function renderUi(value: string): void;

class UiHandler {
  constructor(readonly callback: UiCallback | null, readonly arg: number, readonly textCallback: ((value: string) => void) | null) {}
}
let uiHandlers: Array<UiHandler> = [];
let uiBuild: i32 = 0;


function jsonString(value: string): string {
  let result = '\"';
  const hex = "0123456789abcdef";
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c == 34) result += '\\\"';
    else if (c == 92) result += '\\\\';
    else if (c < 32) result += "\\u00" + hex.charAt(c >> 4) + hex.charAt(c & 15);
    else result += value.charAt(i);
  }
  return result + '\"';
}

function serializeView(view: View): string {
  let handler: i32 = -1;
  const callback = view.callback;
  if (callback !== null || view.textCallback !== null) {
    handler = uiHandlers.length;
    uiHandlers.push(new UiHandler(callback, view.argValue, view.textCallback));
  }
  let children = "[";
  for (let i = 0; i < view.children.length; i++) {
    if (i > 0) children += ",";
    children += serializeView(view.children[i]);
  }
  children += "]";
  return '{"kind":' + jsonString(view.kind) + ',"children":' + children +
    ',"text":' + jsonString(view.value) + ',"padding":' + (view.paddingValue == -100 ? "null" : view.paddingValue.toString()) +
    ',"theme":' + jsonString(view.themeValue) + ',"gap":' + view.gapValue.toString() + ',"grow":' + (view.growValue ? "true" : "false") +
    ',"key":' + jsonString(view.keyValue) + ',"label":' + jsonString(view.labelValue) +
    ',"minWidth":' + view.minWidthValue.toString() + ',"heading":' + view.headingValue.toString() + ',"list":' + (view.listValue ? "true" : "false") + ',"shown":' + (view.shownValue ? "true" : "false") + ',"multiline":' + (view.multilineValue ? "true" : "false") + ',"app":' + view.appValue.toString() + ',"enabled":' + (view.enabledValue ? "true" : "false") + ',"handler":' + handler.toString() +
    ',"variant":' + jsonString(view.variantValue) + ',"tone":' + jsonString(view.toneValue) + ',"surface":' + jsonString(view.surfaceValue) + ',"divider":' + jsonString(view.dividerValue) + ',"mono":' + (view.monoValue ? "true" : "false") +
    ',"small":' + (view.smallValue ? "true" : "false") + ',"bold":' + (view.boldValue ? "true" : "false") + ',"truncate":' + (view.truncateValue ? "true" : "false") +
    ',"width":' + view.widthValue.toString() + ',"center":' + (view.centerValue ? "true" : "false") + ',"selected":' + view.selectedValue.toString() +
    ',"toggle":' + view.toggleValue.toString() + ',"scroll":' + (view.scrollValue ? "true" : "false") + ',"fill":' + (view.fillValue ? "true" : "false") +
    ',"collapse":' + (view.collapseValue ? "true" : "false") + ',"placeholder":' + jsonString(view.placeholderValue) +
    ',"height":' + view.heightValue.toString() + ',"minHeight":' + view.minHeightValue.toString() + ',"wrap":' + (view.wrapValue ? "true" : "false") + '}';
}

function rebuild(): void {
  const app = application;
  if (app === null) return;
  const view = app.build();
  if (view === null) return;
  if (uiBuild == 2147483647) throw new Error("UI の build 番号を使い切りました");
  uiBuild++;
  uiHandlers = [];
  const root = serializeView(view);
  renderUi('{"build":' + uiBuild.toString() + ',"root":' + root + '}');
}

/** Régie が宣言的 UI のイベントを届ける */
export function __bina_ui_event(build: i32, handler: i32): void {
  if (build != uiBuild || handler < 0 || handler >= uiHandlers.length) return;
  const entry = uiHandlers[handler];
  const callback = entry.callback;
  if (callback === null) return;
  callback.call(entry.arg);
  rebuild();
}

export function __bina_ui_text(build: i32, handler: i32, value: string): void {
  if (build != uiBuild || handler < 0 || handler >= uiHandlers.length) return;
  const callback = uiHandlers[handler].textCallback;
  if (callback === null) return;
  callback(value);
  rebuild();
}

/** アプリの大本。必要な知らせだけ上書きする */
export class App {
  build(): View | null { return null; }
  onCreate(_last: Last): void {}
  onStart(_last: State): void {}
  onResume(): void {}
  onPause(): void {}
  onStop(): void {}
  onDestroy(_reason: DestroyReason): void {}
  get page(): string { return pageImport(); }
  finish(): void { finishImport(); }
}

// グローバルで持ち、アプリを GC から守る
let application: App | null = null;

/** トップレベルで一回だけインスタンスを渡す */
export function launch(app: App): void {
  if (application !== null) throw new Error("launch は一回だけ呼べます。");
  application = app;
}

/** OS が状態を進める。launch が無いアプリには何もしない */
export function __bina_lifecycle(kind: i32, a: i32, b: i32): void {
  const app = application;
  if (app === null) return;
  switch (kind) {
    case State.Create: app.onCreate(new Last(a, b != 0, lastPageImport(), new DestroyReason(lastKindImport(), lastCauseImport()))); break;
    case State.Start: app.onStart(a); break;
    case State.Resume: app.onResume(); break;
    case State.Pause: app.onPause(); break;
    case State.Stop: app.onStop(); break;
    case State.Destroy: app.onDestroy(new DestroyReason(a, b)); break;
  }
  rebuild();
}
