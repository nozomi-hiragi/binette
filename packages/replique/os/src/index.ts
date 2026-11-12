// deno-lint-ignore-file no-namespace no-import-prefix verbatim-module-syntax
import { Api, Why } from "jsr:@binette/replique-app@^0.1";

/** この機能が要求するホスト ABI の版。各 external の module 名とテストで一致を確かめる */
export const ABI_VERSION = "0.1";

namespace hostOs {
  // @ts-ignore: decorator
  @external("binette:os@0.1", "appCount")
  export declare function appCount(): i32;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "appName")
  export declare function appName(i: i32): string;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "appId")
  export declare function appId(i: i32): string;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "appNotify")
  export declare function appNotify(i: i32): bool;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "appNet")
  export declare function appNet(i: i32): bool;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "appMuted")
  export declare function appMuted(i: i32): bool;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "setAppMuted")
  export declare function setAppMuted(appId: string, muted: bool): void;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "netCount")
  export declare function netCount(list: string, appId: string): i32;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "netUrl")
  export declare function netUrl(list: string, appId: string, i: i32): string;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "netIsQuiet")
  export declare function netIsQuiet(appId: string): bool;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "netDo")
  export declare function netDo(action: string, appId: string, url: string): void;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "netQuiet")
  export declare function netQuiet(appId: string, on: bool): void;

  // @ts-ignore: decorator
  @external("binette:os@0.1", "notificationCount")
  export declare function notificationCount(): i32;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "notificationName")
  export declare function notificationName(i: i32): string;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "notificationId")
  export declare function notificationId(i: i32): string;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "notificationMuted")
  export declare function notificationMuted(i: i32): bool;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "setNotificationMuted")
  export declare function setNotificationMuted(i: i32, muted: bool): void;

  // @ts-ignore: decorator
  @external("binette:os@0.1", "get")
  export declare function get(name: string): i32;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "set")
  export declare function set(name: string, value: i32): bool;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "role")
  export declare function role(role: string): string;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "candidateCount")
  export declare function candidateCount(role: string): i32;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "candidateName")
  export declare function candidateName(role: string, i: i32): string;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "candidateId")
  export declare function candidateId(role: string, i: i32): string;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "assign")
  export declare function assign(role: string, i: i32): void;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "launchCount")
  export declare function launchCount(): i32;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "launchTime")
  export declare function launchTime(i: i32): f64;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "launchName")
  export declare function launchName(i: i32): string;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "launchText")
  export declare function launchText(i: i32): string;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "timeZone")
  export declare function timeZone(): string;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "letterCount")
  export declare function letterCount(): i32;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "letterId")
  export declare function letterId(i: i32): i32;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "letterFrom")
  export declare function letterFrom(i: i32): string;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "letterName")
  export declare function letterName(i: i32): string;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "letterTitle")
  export declare function letterTitle(i: i32): string;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "letterBody")
  export declare function letterBody(i: i32): string;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "letterTime")
  export declare function letterTime(i: i32): string;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "letterOpened")
  export declare function letterOpened(i: i32): bool;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "letterDo")
  export declare function letterDo(action: string, id: i32): void;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "updatePhase")
  export declare function updatePhase(): string;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "updateCurrent")
  export declare function updateCurrent(): string;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "updateNext")
  export declare function updateNext(): string;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "openRecovery")
  export declare function openRecovery(): void;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "checkUpdate")
  export declare function checkUpdate(): void;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "updateAvailable")
  export declare function updateAvailable(): bool;
  // @ts-ignore: decorator
  @external("binette:os@0.1", "update")
  export declare function update(): void;
}

/** `OsApi.from(api)`。OS の設定、役割の割り当て、起動の履歴、更新。設定アプリ（役割 settings）に届く */
export class OsApi {
  /** 届いていれば API を、届いていなければ null を返す */
  static from(api: Api): OsApi | null {
    return api.why("os") == Why.Granted ? new OsApi() : null;
  }

  /** 入っているアプリ。ID はサブアプリも含む完全な ID */
  appCount(): i32 { return hostOs.appCount(); }
  appName(i: i32): string { return hostOs.appName(i); }
  appId(i: i32): string { return hostOs.appId(i); }
  appNotify(i: i32): bool { return hostOs.appNotify(i); }
  appNet(i: i32): bool { return hostOs.appNet(i); }
  appMuted(i: i32): bool { return hostOs.appMuted(i); }
  setAppMuted(appId: string, muted: bool): void { hostOs.setAppMuted(appId, muted); }
  /** list は request・allow・added・deny。空の appId は全アプリ共通 */
  netCount(list: string, appId: string): i32 { return hostOs.netCount(list, appId); }
  netUrl(list: string, appId: string, i: i32): string { return hostOs.netUrl(list, appId, i); }
  netIsQuiet(appId: string): bool { return hostOs.netIsQuiet(appId); }
  /** addAllow・removeAllow・addDeny・removeDeny。URL の誤りは OS に表示する */
  netDo(action: string, appId: string, url: string): void { hostOs.netDo(action, appId, url); }
  netQuiet(appId: string, on: bool): void { hostOs.netQuiet(appId, on); }

  /** Per-app notification settings, indexed by the notificationCount list. */
  notificationCount(): i32 { return hostOs.notificationCount(); }
  notificationName(i: i32): string { return hostOs.notificationName(i); }
  notificationId(i: i32): string { return hostOs.notificationId(i); }
  notificationMuted(i: i32): bool { return hostOs.notificationMuted(i); }
  setNotificationMuted(i: i32, muted: bool): void { hostOs.setNotificationMuted(i, muted); }

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
  /** 起動の日時を、OS のタイムゾーンで「YYYY-MM-DD HH:MM:SS」にした文字列 */
  launchText(i: i32): string { return hostOs.launchText(i); }
  /** OS が時刻の表示に使うタイムゾーン（例 `Asia/Tokyo`）。今はブラウザの設定に従う */
  timeZone(): string { return hostOs.timeZone(); }
  /** Letters sent to the user, newest first. Pass letterId to the operations rather than the list index. */
  letterCount(): i32 { return hostOs.letterCount(); }
  letterId(i: i32): i32 { return hostOs.letterId(i); }
  /** The sender's app ID. */
  letterFrom(i: i32): string { return hostOs.letterFrom(i); }
  /** The sender's app name, or its ID when the app is gone. */
  letterName(i: i32): string { return hostOs.letterName(i); }
  letterTitle(i: i32): string { return hostOs.letterTitle(i); }
  letterBody(i: i32): string { return hostOs.letterBody(i); }
  /** Arrival time as "YYYY-MM-DD HH:MM" in the system time zone. */
  letterTime(i: i32): string { return hostOs.letterTime(i); }
  letterOpened(i: i32): bool { return hostOs.letterOpened(i); }
  /** Opens the sender's app. Pressing the letter counts as opening it. */
  showLetter(id: i32): void { hostOs.letterDo("show", id); }
  /** Forces a letter open, for one that stays unopened. */
  openLetter(id: i32): void { hostOs.letterDo("open", id); }
  openAllLetters(): void { hostOs.letterDo("openAll", 0); }
  deleteLetter(id: i32): void { hostOs.letterDo("delete", id); }
  deleteAllLetters(): void { hostOs.letterDo("deleteAll", 0); }
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
