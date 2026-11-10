// deno-lint-ignore-file no-namespace no-import-prefix no-unversioned-import verbatim-module-syntax
import { Api, Why } from "jsr:@binette/replique/app";

namespace hostOs {
  // @ts-ignore: decorator
  @external("binette", "os.notificationCount")
  export declare function notificationCount(): i32;
  // @ts-ignore: decorator
  @external("binette", "os.notificationName")
  export declare function notificationName(i: i32): string;
  // @ts-ignore: decorator
  @external("binette", "os.notificationId")
  export declare function notificationId(i: i32): string;
  // @ts-ignore: decorator
  @external("binette", "os.notificationMuted")
  export declare function notificationMuted(i: i32): bool;
  // @ts-ignore: decorator
  @external("binette", "os.setNotificationMuted")
  export declare function setNotificationMuted(i: i32, muted: bool): void;

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

/** `OsApi.from(api)`。OS の設定、役割の割り当て、起動の履歴、更新。設定アプリ（役割 settings）に届く */
export class OsApi {
  /** 届いていれば API を、届いていなければ null を返す */
  static from(api: Api): OsApi | null {
    return api.why("os") == Why.Granted ? new OsApi() : null;
  }

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
