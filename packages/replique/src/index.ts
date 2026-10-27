/** アプリが Régie を呼ぶためのライブラリ（AssemblyScript）。 */
// @ts-ignore: decorator
@external("binette", "dom.byId")
// @ts-ignore: AssemblyScript の整数型
declare function byId(handle: i32, id: string): void;

// @ts-ignore: decorator
@external("binette", "dom.create")
// @ts-ignore: AssemblyScript の整数型
declare function create(handle: i32, tag: string): void;

// @ts-ignore: decorator
@external("binette", "dom.text")
// @ts-ignore: AssemblyScript の整数型
declare function text(handle: i32, value: string): void;

// @ts-ignore: decorator
@external("binette", "dom.class")
// @ts-ignore: AssemblyScript の整数型
declare function className(handle: i32, value: string): void;

// @ts-ignore: decorator
@external("binette", "dom.append")
// @ts-ignore: AssemblyScript の整数型
declare function append(parent: i32, child: i32): void;

// @ts-ignore: decorator
@external("binette", "dom.remove")
// @ts-ignore: AssemblyScript の整数型
declare function remove(handle: i32): void;

// @ts-ignore: decorator
@external("binette", "dom.listen")
// @ts-ignore: AssemblyScript の整数型
declare function listen(handle: i32, type: string, listener: i32): void;

// @ts-ignore: decorator
@external("binette", "apps.icon")
// @ts-ignore: AssemblyScript の整数型
declare function iconImport(handle: i32, app: i32): void;

// @ts-ignore: AssemblyScript の整数型
let nextHandle: i32 = 1;
const elements = new Map<string, Element>();
const listeners = new Array<(event: Event) => void>();
const targets = new Array<Element>();
const types = new Array<string>();

/** リスナーを付けた要素とイベントの種類 */
export class Event {
  constructor(readonly type: string, readonly currentTarget: Element) {}
}

/** 番号で参照する要素。読み取り値はアプリが最後に書いた値 */
export class Element {
  private textValue: string = "";
  private classValue: string = "";
  // @ts-ignore: AssemblyScript の整数型
  readonly handle: i32;
  // @ts-ignore: AssemblyScript の整数型
  constructor(handle: i32) { this.handle = handle; }

  get textContent(): string { return this.textValue; }
  /** 子をすべて消して文字だけにする */
  set textContent(value: string) { this.textValue = value; text(this.handle, value); }
  get className(): string { return this.classValue; }
  set className(value: string) { this.classValue = value; className(this.handle, value); }
  appendChild(child: Element): Element { append(this.handle, child.handle); return child; }
  remove(): void { remove(this.handle); }
  addEventListener(type: string, listener: (event: Event) => void): void {
    const index = listeners.length;
    listeners.push(listener);
    targets.push(this);
    types.push(type);
    listen(this.handle, type, index);
  }
}

export namespace document {
  export function getElementById(id: string): Element {
    if (elements.has(id)) return elements.get(id)!;
    const element = new Element(nextHandle++);
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
// @ts-ignore: AssemblyScript の整数型
export function __bina_event(listener: i32): void {
  if (listener < 0 || listener >= listeners.length) return;
  listeners[listener](new Event(types[listener], targets[listener]));
}

/** ホームだけが使えるアプリの一覧と起動 */
export namespace apps {
  /** img に OS のアプリアイコンを入れる */
  // @ts-ignore: AssemblyScript の整数型
  export function icon(img: Element, i: i32): void { iconImport(img.handle, i); }
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

/** システムの設定アプリだけが使える OS の設定と起動の履歴 */
export namespace os {
  // @ts-ignore: decorator
  @external("binette", "os.get")
  // @ts-ignore: AssemblyScript の型
  export declare function get(name: string): i32;
  // @ts-ignore: decorator
  @external("binette", "os.set")
  // @ts-ignore: AssemblyScript の型
  export declare function set(name: string, value: i32): bool;
  // @ts-ignore: decorator
  @external("binette", "os.home")
  // @ts-ignore: AssemblyScript の型
  export declare function home(): string;
  // @ts-ignore: decorator
  @external("binette", "os.homeCount")
  // @ts-ignore: AssemblyScript の型
  export declare function homeCount(): i32;
  // @ts-ignore: decorator
  @external("binette", "os.homeName")
  // @ts-ignore: AssemblyScript の型
  export declare function homeName(i: i32): string;
  // @ts-ignore: decorator
  @external("binette", "os.homeId")
  // @ts-ignore: AssemblyScript の型
  export declare function homeId(i: i32): string;
  // @ts-ignore: decorator
  @external("binette", "os.setHome")
  // @ts-ignore: AssemblyScript の型
  export declare function setHome(i: i32): void;
  // @ts-ignore: decorator
  @external("binette", "os.launchCount")
  // @ts-ignore: AssemblyScript の型
  export declare function launchCount(): i32;
  // @ts-ignore: decorator
  @external("binette", "os.launchTime")
  // @ts-ignore: AssemblyScript の型
  export declare function launchTime(i: i32): f64;
  // @ts-ignore: decorator
  @external("binette", "os.launchName")
  // @ts-ignore: AssemblyScript の型
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

/** アプリの大本。必要な知らせだけ上書きする */
export class App {
  onCreate(last: Last): void {}
  onStart(last: State): void {}
  onResume(): void {}
  onPause(): void {}
  onStop(): void {}
  onDestroy(reason: DestroyReason): void {}
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
// @ts-ignore: AssemblyScript の整数型
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
}
