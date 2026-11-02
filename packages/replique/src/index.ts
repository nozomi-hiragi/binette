// deno-lint-ignore-file no-import-prefix no-unversioned-import no-namespace verbatim-module-syntax
/** アプリが Régie を呼ぶためのライブラリ（AssemblyScript）。 */
import { View, UiCallback } from "jsr:@binette/decor/as";
export { View, column, row, text, button, buttonOf, input, grid, appIcon, appArea, show, theme, space, radius, fontSize, Theme, Scale, ComponentTheme,
  spacer, separator, stack, checkbox, radio, slider, picker, segmented, tabs, progress, spinner, image, listTile, chip, badge, menuItem } from "jsr:@binette/decor/as";
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

// OS の呼び出しの入口。アプリは直接使わず、辞書 `Api` から取ったクラスを通す
namespace hostApps {
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

namespace hostOs {
  // @ts-ignore: decorator
  @external("binette", "os.get")
  export declare function get(name: string): i32;
  // @ts-ignore: decorator
  @external("binette", "os.set")
  export declare function set(name: string, value: i32): bool;
  // @ts-ignore: decorator
  @external("binette", "os.role")
  export declare function role(role: string): string;
  // @ts-ignore: decorator
  @external("binette", "os.candidateCount")
  export declare function candidateCount(role: string): i32;
  // @ts-ignore: decorator
  @external("binette", "os.candidateName")
  export declare function candidateName(role: string, i: i32): string;
  // @ts-ignore: decorator
  @external("binette", "os.candidateId")
  export declare function candidateId(role: string, i: i32): string;
  // @ts-ignore: decorator
  @external("binette", "os.assign")
  export declare function assign(role: string, i: i32): void;
  // @ts-ignore: decorator
  @external("binette", "os.launchCount")
  export declare function launchCount(): i32;
  // @ts-ignore: decorator
  @external("binette", "os.launchTime")
  export declare function launchTime(i: i32): f64;
  // @ts-ignore: decorator
  @external("binette", "os.launchName")
  export declare function launchName(i: i32): string;
  // @ts-ignore: decorator
  @external("binette", "os.updatePhase")
  export declare function updatePhase(): string;
  // @ts-ignore: decorator
  @external("binette", "os.updateCurrent")
  export declare function updateCurrent(): string;
  // @ts-ignore: decorator
  @external("binette", "os.updateNext")
  export declare function updateNext(): string;
  // @ts-ignore: decorator
  @external("binette", "os.openRecovery")
  export declare function openRecovery(): void;
  // @ts-ignore: decorator
  @external("binette", "os.checkUpdate")
  export declare function checkUpdate(): void;
  // @ts-ignore: decorator
  @external("binette", "os.updateAvailable")
  export declare function updateAvailable(): bool;
  // @ts-ignore: decorator
  @external("binette", "os.update")
  export declare function update(): void;
}

namespace hostStorage {
  // @ts-ignore: decorator
  @external("binette", "storage.has")
  export declare function has(name: string): bool;
  // @ts-ignore: decorator
  @external("binette", "storage.read")
  export declare function read(name: string): string | null;
  // @ts-ignore: decorator
  @external("binette", "storage.write")
  export declare function write(name: string, value: string): bool;
  // @ts-ignore: decorator
  @external("binette", "storage.remove")
  export declare function remove(name: string): void;
  // @ts-ignore: decorator
  @external("binette", "storage.count")
  export declare function count(): i32;
  // @ts-ignore: decorator
  @external("binette", "storage.name")
  export declare function name(i: i32): string;
}

// @ts-ignore: decorator
@external("binette", "api.why")
declare function whyImport(key: string): i32;

/** 辞書に載らなかった理由。Granted は、載っている */
export enum Why { Granted, NotGranted, NotAssigned }

/** `api.get<AppsApi>("apps")`。アプリの一覧と起動。ホーム（と Cadre）の役割を割り当てられたアプリに届く */
export class AppsApi {
  /** img に OS のアプリアイコンを入れる */
  icon(img: Element, i: i32): void { iconImport(img.handle, i); }
  count(): i32 { return hostApps.count(); }
  name(i: i32): string { return hostApps.name(i); }
  id(i: i32): string { return hostApps.id(i); }
  open(i: i32): void { hostApps.open(i); }
}

/** `api.get<OsApi>("os")`。OS の設定、役割の割り当て、起動の履歴、更新。設定アプリ（役割 settings）に届く */
export class OsApi {
  get(name: string): i32 { return hostOs.get(name); }
  /** 範囲外と知らない名前は false を返して保存しない */
  set(name: string, value: i32): bool { return hostOs.set(name, value); }
  /** 役割に割り当てたアプリの ID。無ければ空 */
  role(role: string): string { return hostOs.role(role); }
  /** 役割に選べるアプリの数。割り当てを変えられない役割は 0 */
  candidateCount(role: string): i32 { return hostOs.candidateCount(role); }
  candidateName(role: string, i: i32): string { return hostOs.candidateName(role, i); }
  candidateId(role: string, i: i32): string { return hostOs.candidateId(role, i); }
  /** 役割に割り当てるアプリを、候補の番号で選ぶ */
  assign(role: string, i: i32): void { hostOs.assign(role, i); }
  launchCount(): i32 { return hostOs.launchCount(); }
  launchTime(i: i32): f64 { return hostOs.launchTime(i); }
  launchName(i: i32): string { return hostOs.launchName(i); }
  /** 新しい版の `/system` があるか */
  updatePhase(): string { return hostOs.updatePhase(); }
  updateCurrent(): string { return hostOs.updateCurrent(); }
  updateNext(): string { return hostOs.updateNext(); }
  openRecovery(): void { hostOs.openRecovery(); }
  checkUpdate(): void { hostOs.checkUpdate(); }
  updateAvailable(): bool { return hostOs.updateAvailable(); }
  /** `/system` を新しい版に入れ替えて、再読み込みする */
  update(): void { hostOs.update(); }
}

/** `api.get<StorageApi>("storage")`。アプリごとのデータ（`/data/<id>/`）。名前は 1 つの部品で、中身は文字列。すべてのアプリに届く */
export class StorageApi {
  has(name: string): bool { return hostStorage.has(name); }
  /** 無ければ null */
  read(name: string): string | null { return hostStorage.read(name); }
  /** 名前が空か長すぎる（256 文字を超える）ときは false を返して保存しない */
  write(name: string, value: string): bool { return hostStorage.write(name, value); }
  remove(name: string): void { hostStorage.remove(name); }
  count(): i32 { return hostStorage.count(); }
  /** 名前の辞書順の i 番目 */
  name(i: i32): string { return hostStorage.name(i); }
}

/** `api.get<FsApi>("fs")`。ファイルの木。範囲の決め方が未決なので、キーだけ用意して今は誰にも届かない */
export class FsApi {}

/** `api.get<CadreApi>("cadre")`。Cadre の役割に割り当てられたアプリにだけ届く */
export class CadreApi {
  /** 起動中のアプリ（ホームを除く）の数 */
  count(): i32 { return cadreCountImport(); }
  /** running の別名 */
  running(): i32 { return this.count(); }
  /** i 番目のアプリの名前 */
  name(i: i32): string { return cadreNameImport(i); }
  /** i 番目のアプリが前面にあるか */
  isFront(i: i32): boolean { return cadreIsFrontImport(i) != 0; }
  /** ホームが前面にあるか */
  isHome(): boolean { return cadreIsHomeImport() != 0; }
  /** i 番目のアプリのアイコンがあるか */
  hasIcon(i: i32): boolean { return cadreHasIconImport(i) != 0; }
  /** i 番目のアプリに対応する apps 一覧の番号。appIcon に渡す */
  appIndex(i: i32): i32 { return cadreAppIndexImport(i); }
  /** インストール済みか */
  isInstalled(): boolean { return cadreIsInstalledImport() != 0; }
  /** インストールの確認を待っているか */
  installBusy(): boolean { return cadreInstallBusyImport() != 0; }
  /** インストールを案内する */
  install(): void { cadreInstallImport(); }
  /** i 番目のアプリを開く（前面にする） */
  open(i: i32): void { cadreOpenImport(i); }
  /** i 番目のアプリを閉じる */
  close(i: i32): void { cadreCloseImport(i); }
  /** ホームを開く */
  openHome(): void { cadreOpenHomeImport(); }
  /** openHome の別名 */
  home(): void { this.openHome(); }
  /** 戻る */
  back(): void { cadreBackImport(); }
  /** 設定の役割に割り当てられたアプリを開く */
  openSettings(): void { cadreOpenSettingsImport(); }
  /** 通知（案。枠のみ） */
  notify(text: string): void { cadreNotifyImport(text); }
}

/**
 * OS が `onCreate` で渡す API の辞書。キーで取り出す。
 * AS には動的な型がないので、キーと型引数が合う既知のクラス（`apps` は AppsApi、`os` は OsApi、`storage` は StorageApi、`fs` は FsApi、`cadre` は CadreApi）を返す
 */
export class Api {
  /** 届いていれば API を、キーが無いか型引数が合わないか、届いていなければ null を返す */
  get<T>(key: string): T | null {
    if (whyImport(key) != Why.Granted) return null;
    if (key == "apps" && idof<T>() == idof<AppsApi>()) return changetype<T>(new AppsApi());
    if (key == "os" && idof<T>() == idof<OsApi>()) return changetype<T>(new OsApi());
    if (key == "storage" && idof<T>() == idof<StorageApi>()) return changetype<T>(new StorageApi());
    if (key == "fs" && idof<T>() == idof<FsApi>()) return changetype<T>(new FsApi());
    if (key == "cadre" && idof<T>() == idof<CadreApi>()) return changetype<T>(new CadreApi());
    return null;
  }
  /** 取れない理由。権限がない（NotGranted）か、役割に割り当てられていない（NotAssigned）か。届いているなら Granted */
  why(key: string): Why { return whyImport(key); }
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
@external("binette", "cadre.count")
declare function cadreCountImport(): i32;
// @ts-ignore: decorator
@external("binette", "cadre.name")
declare function cadreNameImport(i: i32): string;
// @ts-ignore: decorator
@external("binette", "cadre.isFront")
declare function cadreIsFrontImport(i: i32): i32;
// @ts-ignore: decorator
@external("binette", "cadre.isHome")
declare function cadreIsHomeImport(): i32;
// @ts-ignore: decorator
@external("binette", "cadre.hasIcon")
declare function cadreHasIconImport(i: i32): i32;
// @ts-ignore: decorator
@external("binette", "cadre.appIndex")
declare function cadreAppIndexImport(i: i32): i32;
// @ts-ignore: decorator
@external("binette", "cadre.isInstalled")
declare function cadreIsInstalledImport(): i32;
// @ts-ignore: decorator
@external("binette", "cadre.installBusy")
declare function cadreInstallBusyImport(): i32;
// @ts-ignore: decorator
@external("binette", "cadre.install")
declare function cadreInstallImport(): void;
// @ts-ignore: decorator
@external("binette", "cadre.open")
declare function cadreOpenImport(i: i32): void;
// @ts-ignore: decorator
@external("binette", "cadre.close")
declare function cadreCloseImport(i: i32): void;
// @ts-ignore: decorator
@external("binette", "cadre.openHome")
declare function cadreOpenHomeImport(): void;
// @ts-ignore: decorator
@external("binette", "cadre.back")
declare function cadreBackImport(): void;
// @ts-ignore: decorator
@external("binette", "cadre.openSettings")
declare function cadreOpenSettingsImport(): void;
// @ts-ignore: decorator
@external("binette", "cadre.notify")
declare function cadreNotifyImport(text: string): void;

// @ts-ignore: decorator
@external("binette", "ui.render")
declare function renderUi(value: string): void;

class UiHandler {
  constructor(readonly callback: UiCallback | null, readonly arg: number, readonly textCallback: ((value: string) => void) | null,
    readonly numberCallback: ((value: f64) => void) | null, readonly checkCallback: ((checked: boolean) => void) | null, readonly indexed: boolean) {}
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
  if (callback !== null || view.textCallback !== null || view.numberCallback !== null || view.checkCallback !== null) {
    handler = uiHandlers.length;
    const indexed = view.kind == "picker" || view.kind == "segmented" || view.kind == "tabs";
    uiHandlers.push(new UiHandler(callback, view.argValue, view.textCallback, view.numberCallback, view.checkCallback, indexed));
  }
  let options = "[";
  for (let i = 0; i < view.optionsValue.length; i++) options += (i > 0 ? "," : "") + jsonString(view.optionsValue[i]);
  options += "]";
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
    ',"height":' + view.heightValue.toString() + ',"minHeight":' + view.minHeightValue.toString() + ',"wrap":' + (view.wrapValue ? "true" : "false") + ',"highlight":' + (view.highlightValue ? "true" : "false") + ',"tip":' + jsonString(view.tipValue) +
    ',"checked":' + (view.checkedValue ? "true" : "false") + ',"value":' + view.numberValue.toString() + ',"min":' + view.minValue.toString() +
    ',"max":' + view.maxValue.toString() + ',"step":' + view.stepValue.toString() + ',"options":' + options + ',"index":' + view.indexValue.toString() +
    ',"align":' + jsonString(view.alignValue) + '}';
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

/** Régie が値を返す部品の操作を届ける。slider は数、checkbox は 0 か 1、picker・segmented・tabs は番号。radio は arg(i) の値で呼ぶ */
export function __bina_ui_value(build: i32, handler: i32, value: f64): void {
  if (build != uiBuild || handler < 0 || handler >= uiHandlers.length) return;
  const entry = uiHandlers[handler];
  const numberCallback = entry.numberCallback;
  const checkCallback = entry.checkCallback;
  const callback = entry.callback;
  if (numberCallback !== null) numberCallback(value);
  else if (checkCallback !== null) checkCallback(value != 0);
  else if (callback !== null) callback.call(entry.indexed ? value : entry.arg);
  else return;
  rebuild();
}

/** アプリの大本。必要な知らせだけ上書きする */
export class App {
  build(): View | null { return null; }
  onCreate(_last: Last, _api: Api): void {}
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
    case State.Create: app.onCreate(new Last(a, b != 0, lastPageImport(), new DestroyReason(lastKindImport(), lastCauseImport())), new Api()); break;
    case State.Start: app.onStart(a); break;
    case State.Resume: app.onResume(); break;
    case State.Pause: app.onPause(); break;
    case State.Stop: app.onStop(); break;
    case State.Destroy: app.onDestroy(new DestroyReason(a, b)); break;
  }
  rebuild();
}

/** OS が Cadre の状態（起動中の一覧や前面）の更新を知らせる */
export function __bina_cadre_sync(): void {
  rebuild();
}
