// deno-lint-ignore-file no-import-prefix no-namespace verbatim-module-syntax
import { Api, Why } from "jsr:@binette/replique-app@^0.1";
import { rebuild } from "jsr:@binette/replique-ui@^0.1";

/** この機能が要求するホスト ABI の版。各 external の module 名とテストで一致を確かめる */
export const ABI_VERSION = "0.1";

namespace hostCadreNotifications {
  // @ts-ignore: decorator
  @external("binette:cadre@0.1", "clock")
  export declare function clock(): string;
  // @ts-ignore: decorator
  @external("binette:cadre@0.1", "notificationTime")
  export declare function notificationTime(i: i32): string;
  // @ts-ignore: decorator
  @external("binette:cadre@0.1", "notificationPopup")
  export declare function notificationPopup(i: i32): bool;
  // @ts-ignore: decorator
  @external("binette:cadre@0.1", "notificationAppIndex")
  export declare function notificationAppIndex(i: i32): i32;
  // @ts-ignore: decorator
  @external("binette:cadre@0.1", "notificationName")
  export declare function notificationName(i: i32): string;
  // @ts-ignore: decorator
  @external("binette:cadre@0.1", "notificationKeep")
  export declare function notificationKeep(id: i32, keep: bool): void;
  // @ts-ignore: decorator
  @external("binette:cadre@0.1", "unread")
  export declare function unread(i: i32): i32;
  // @ts-ignore: decorator
  @external("binette:cadre@0.1", "unreadTotal")
  export declare function unreadTotal(): i32;
  // @ts-ignore: decorator
  @external("binette:cadre@0.1", "notificationCount")
  export declare function notificationCount(): i32;
  // @ts-ignore: decorator
  @external("binette:cadre@0.1", "notificationId")
  export declare function notificationId(i: i32): i32;
  // @ts-ignore: decorator
  @external("binette:cadre@0.1", "notificationFrom")
  export declare function notificationFrom(i: i32): string;
  // @ts-ignore: decorator
  @external("binette:cadre@0.1", "notificationTitle")
  export declare function notificationTitle(i: i32): string;
  // @ts-ignore: decorator
  @external("binette:cadre@0.1", "notificationBody")
  export declare function notificationBody(i: i32): string;
  // @ts-ignore: decorator
  @external("binette:cadre@0.1", "notificationActionCount")
  export declare function notificationActionCount(i: i32): i32;
  // @ts-ignore: decorator
  @external("binette:cadre@0.1", "notificationActionId")
  export declare function notificationActionId(i: i32, action: i32): string;
  // @ts-ignore: decorator
  @external("binette:cadre@0.1", "notificationActionLabel")
  export declare function notificationActionLabel(i: i32, action: i32): string;
  // @ts-ignore: decorator
  @external("binette:cadre@0.1", "notificationActionPlaceholder")
  export declare function notificationActionPlaceholder(i: i32, action: i32): string;
  // @ts-ignore: decorator
  @external("binette:cadre@0.1", "notificationActionInput")
  export declare function notificationActionInput(i: i32, action: i32): bool;
  // @ts-ignore: decorator
  @external("binette:cadre@0.1", "notificationOpen")
  export declare function notificationOpen(id: i32): void;
  // @ts-ignore: decorator
  @external("binette:cadre@0.1", "notificationDismiss")
  export declare function notificationDismiss(id: i32): void;
  // @ts-ignore: decorator
  @external("binette:cadre@0.1", "notificationReply")
  export declare function notificationReply(id: i32, actionId: string, body: string): void;
}

/** `CadreApi.from(api)`。Cadre の役割に割り当てられたアプリにだけ届く */
export class CadreApi {
  /** 届いていれば API を、届いていなければ null を返す */
  static from(api: Api): CadreApi | null {
    return api.why("cadre") == Why.Granted ? new CadreApi() : null;
  }

  clock(): string { return hostCadreNotifications.clock(); }
  notificationTime(i: i32): string { return hostCadreNotifications.notificationTime(i); }
  notificationPopup(i: i32): bool { return hostCadreNotifications.notificationPopup(i); }
  notificationAppIndex(i: i32): i32 { return hostCadreNotifications.notificationAppIndex(i); }
  notificationName(i: i32): string { return hostCadreNotifications.notificationName(i); }
  notificationKeep(id: i32, keep: bool): void { hostCadreNotifications.notificationKeep(id, keep); }
  unread(i: i32): i32 { return hostCadreNotifications.unread(i); }
  unreadTotal(): i32 { return hostCadreNotifications.unreadTotal(); }

  /** User notifications. Pass notificationId to operations rather than the list index. */
  notificationCount(): i32 { return hostCadreNotifications.notificationCount(); }
  notificationId(i: i32): i32 { return hostCadreNotifications.notificationId(i); }
  notificationFrom(i: i32): string { return hostCadreNotifications.notificationFrom(i); }
  notificationTitle(i: i32): string { return hostCadreNotifications.notificationTitle(i); }
  notificationBody(i: i32): string { return hostCadreNotifications.notificationBody(i); }
  notificationActionCount(i: i32): i32 { return hostCadreNotifications.notificationActionCount(i); }
  notificationActionId(i: i32, action: i32): string { return hostCadreNotifications.notificationActionId(i, action); }
  notificationActionLabel(i: i32, action: i32): string { return hostCadreNotifications.notificationActionLabel(i, action); }
  notificationActionPlaceholder(i: i32, action: i32): string { return hostCadreNotifications.notificationActionPlaceholder(i, action); }
  notificationActionInput(i: i32, action: i32): bool { return hostCadreNotifications.notificationActionInput(i, action); }
  notificationOpen(id: i32): void { hostCadreNotifications.notificationOpen(id); }
  notificationDismiss(id: i32): void { hostCadreNotifications.notificationDismiss(id); }
  notificationReply(id: i32, actionId: string, body: string): void { hostCadreNotifications.notificationReply(id, actionId, body); }

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
  /** 前面のアプリがフルスクリーンを求めているか。枠の出し入れは OS がするので、Cadre は枠を宣言するだけでよい */
  isFullscreen(): boolean { return cadreIsFullscreenImport() != 0; }
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

// @ts-ignore: decorator
@external("binette:cadre@0.1", "count")
declare function cadreCountImport(): i32;
// @ts-ignore: decorator
@external("binette:cadre@0.1", "name")
declare function cadreNameImport(i: i32): string;
// @ts-ignore: decorator
@external("binette:cadre@0.1", "isFront")
declare function cadreIsFrontImport(i: i32): i32;
// @ts-ignore: decorator
@external("binette:cadre@0.1", "isHome")
declare function cadreIsHomeImport(): i32;
// @ts-ignore: decorator
@external("binette:cadre@0.1", "isFullscreen")
declare function cadreIsFullscreenImport(): i32;
// @ts-ignore: decorator
@external("binette:cadre@0.1", "hasIcon")
declare function cadreHasIconImport(i: i32): i32;
// @ts-ignore: decorator
@external("binette:cadre@0.1", "appIndex")
declare function cadreAppIndexImport(i: i32): i32;
// @ts-ignore: decorator
@external("binette:cadre@0.1", "isInstalled")
declare function cadreIsInstalledImport(): i32;
// @ts-ignore: decorator
@external("binette:cadre@0.1", "installBusy")
declare function cadreInstallBusyImport(): i32;
// @ts-ignore: decorator
@external("binette:cadre@0.1", "install")
declare function cadreInstallImport(): void;
// @ts-ignore: decorator
@external("binette:cadre@0.1", "open")
declare function cadreOpenImport(i: i32): void;
// @ts-ignore: decorator
@external("binette:cadre@0.1", "close")
declare function cadreCloseImport(i: i32): void;
// @ts-ignore: decorator
@external("binette:cadre@0.1", "openHome")
declare function cadreOpenHomeImport(): void;
// @ts-ignore: decorator
@external("binette:cadre@0.1", "back")
declare function cadreBackImport(): void;
// @ts-ignore: decorator
@external("binette:cadre@0.1", "openSettings")
declare function cadreOpenSettingsImport(): void;
// @ts-ignore: decorator
@external("binette:cadre@0.1", "notify")
declare function cadreNotifyImport(text: string): void;

/** OS が Cadre の状態（起動中の一覧や前面）の更新を知らせる */
export function __bina_cadre_sync(): void {
  rebuild();
}
