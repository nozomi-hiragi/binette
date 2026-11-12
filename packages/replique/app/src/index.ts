// deno-lint-ignore-file no-import-prefix no-unversioned-import verbatim-module-syntax
import { View } from "jsr:@binette/decor/as";

/** この機能が要求するホスト ABI の版。各 external の module 名とテストで一致を確かめる */
export const ABI_VERSION = "0.1";

// @ts-ignore: decorator
@external("binette:app@0.1", "why")
declare function whyImport(key: string): i32;

// @ts-ignore: decorator
@external("binette:app@0.1", "sub")
declare function subImport(): string;

/** 辞書に載らなかった理由。Granted は、載っている */
export enum Why { Granted, NotGranted, NotAssigned }

/**
 * API dictionary supplied by the OS to onCreate, accessed by key.
 * Each feature retrieves its API through its static from(api) method.
 */
export class Api {
  /** 起動したサブアプリの識別子。親として開いたときは空文字列 */
  sub(): string { return subImport(); }
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
@external("binette:app@0.1", "page")
declare function pageImport(): string;
// @ts-ignore: decorator
@external("binette:app@0.1", "lastPage")
declare function lastPageImport(): string;
// @ts-ignore: decorator
@external("binette:app@0.1", "lastKind")
declare function lastKindImport(): DestroyKind;
// @ts-ignore: decorator
@external("binette:app@0.1", "lastCause")
declare function lastCauseImport(): DestroyCause;
// @ts-ignore: decorator
@external("binette:app@0.1", "finish")
declare function finishImport(): void;

export function jsonString(value: string): string {
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

// @ts-ignore: decorator
@external("binette:app@0.1", "osRef")
declare function osRefImport(): string;
// @ts-ignore: decorator
@external("binette:app@0.1", "osCommit")
declare function osCommitImport(): string;

// @ts-ignore: decorator
@external("binette:net@0.1", "text")
declare function netText(id: i32, field: string): string | null;
// @ts-ignore: decorator
@external("binette:net@0.1", "number")
declare function netNumber(id: i32, field: string, index: i32): i32;
// @ts-ignore: decorator
@external("binette:net@0.1", "copy")
declare function netCopy(id: i32, ptr: usize, length: i32): void;

/** net の応答ヘッダー。 */
export class ResponseHeaders {
  private contentType: string | null;
  private etag: string | null;
  private lastModified: string | null;
  constructor(id: i32) {
    this.contentType = netText(id, "content-type");
    this.etag = netText(id, "etag");
    this.lastModified = netText(id, "last-modified");
  }
  get(name: string): string | null {
    const key = name.toLowerCase();
    if (key == "content-type") return this.contentType;
    if (key == "etag") return this.etag;
    if (key == "last-modified") return this.lastModified;
    return null;
  }
}

/** 完了した net の応答。 */
export class Response {
  readonly status: i32;
  readonly statusText: string;
  readonly url: string;
  readonly type: string;
  readonly reason: string;
  readonly headers: ResponseHeaders;
  readonly redirected: bool = false;
  private body: ArrayBuffer;
  constructor(id: i32) {
    this.status = netNumber(id, "status", 0);
    this.statusText = netText(id, "statusText") || "";
    this.url = netText(id, "url") || "";
    this.type = netText(id, "type") || "";
    this.reason = netText(id, "reason") || "";
    this.headers = new ResponseHeaders(id);
    const length = netNumber(id, "length", 0);
    const bytes = new Uint8Array(length);
    netCopy(id, bytes.dataStart, length);
    this.body = bytes.buffer;
  }
  get ok(): bool { return this.status >= 200 && this.status <= 299; }
  text(): string { return String.UTF8.decode(this.body); }
  arrayBuffer(): ArrayBuffer { return this.body.slice(0); }
}

/** アプリの大本。必要な知らせだけ上書きする */
export class App {
  osRef(): string { return osRefImport(); }
  osCommit(): string { return osCommitImport(); }
  build(): View | null { return null; }
  onCreate(_last: Last, _api: Api): void {}
  onStart(_last: State): void {}
  onResume(): void {}
  /** Called when a letter arrives while the app is running. */
  onPigeon(): void {}
  onShare(): void {}
  onNet(_id: i32, _res: Response): void {}
  /**
   * 自分の予定の時刻が来た。画面なしで起こされたとき（onCreate は呼ばれない）も、開いているインスタンスでも呼ばれる。
   * 上限は 30 秒。返ったら結果は ok になる
   */
  onSchedule(_slot: i32, _api: Api): void {}
  onPause(): void {}
  onStop(): void {}
  onDestroy(_reason: DestroyReason): void {}
  get page(): string { return pageImport(); }
  finish(): void { finishImport(); }
}

// グローバルで持ち、アプリを GC から守る
export let application: App | null = null;
// onCreate を呼んだか。画面なしの起動では build を呼ばない
export let created = false;

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
    case State.Create: created = true; app.onCreate(new Last(a, b != 0, lastPageImport(), new DestroyReason(lastKindImport(), lastCauseImport())), new Api()); break;
    case State.Start: app.onStart(a); break;
    case State.Resume: app.onResume(); break;
    case State.Pause: app.onPause(); break;
    case State.Stop: app.onStop(); break;
    case State.Destroy: app.onDestroy(new DestroyReason(a, b)); break;
  }
  rebuild();
}

let rebuildHook: (() => void) | null = null;

export function setRebuild(callback: () => void): void {
  rebuildHook = callback;
}

export function rebuild(): void {
  const callback = rebuildHook;
  if (callback !== null) callback();
}
