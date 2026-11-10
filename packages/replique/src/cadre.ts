// deno-lint-ignore-file no-import-prefix no-unversioned-import no-namespace verbatim-module-syntax
import { Api, Why } from "jsr:@binette/replique/app";
import { rebuild } from "jsr:@binette/replique/ui";

namespace hostCadreNotifications {
  // @ts-ignore: decorator
  @external("binette", "cadre.notificationCount")
  export declare function notificationCount(): i32;
  // @ts-ignore: decorator
  @external("binette", "cadre.notificationId")
  export declare function notificationId(i: i32): i32;
  // @ts-ignore: decorator
  @external("binette", "cadre.notificationFrom")
  export declare function notificationFrom(i: i32): string;
  // @ts-ignore: decorator
  @external("binette", "cadre.notificationTitle")
  export declare function notificationTitle(i: i32): string;
  // @ts-ignore: decorator
  @external("binette", "cadre.notificationBody")
  export declare function notificationBody(i: i32): string;
  // @ts-ignore: decorator
  @external("binette", "cadre.notificationActionCount")
  export declare function notificationActionCount(i: i32): i32;
  // @ts-ignore: decorator
  @external("binette", "cadre.notificationActionId")
  export declare function notificationActionId(i: i32, action: i32): string;
  // @ts-ignore: decorator
  @external("binette", "cadre.notificationActionLabel")
  export declare function notificationActionLabel(i: i32, action: i32): string;
  // @ts-ignore: decorator
  @external("binette", "cadre.notificationActionPlaceholder")
  export declare function notificationActionPlaceholder(i: i32, action: i32): string;
  // @ts-ignore: decorator
  @external("binette", "cadre.notificationActionInput")
  export declare function notificationActionInput(i: i32, action: i32): bool;
  // @ts-ignore: decorator
  @external("binette", "cadre.notificationOpen")
  export declare function notificationOpen(id: i32): void;
  // @ts-ignore: decorator
  @external("binette", "cadre.notificationDismiss")
  export declare function notificationDismiss(id: i32): void;
  // @ts-ignore: decorator
  @external("binette", "cadre.notificationReply")
  export declare function notificationReply(id: i32, actionId: string, body: string): void;
}

/** `CadreApi.from(api)`。Cadre の役割に割り当てられたアプリにだけ届く */
export class CadreApi {
  /** 届いていれば API を、届いていなければ null を返す */
  static from(api: Api): CadreApi | null {
    return api.why("cadre") == Why.Granted ? new CadreApi() : null;
  }

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

/** OS が Cadre の状態（起動中の一覧や前面）の更新を知らせる */
export function __bina_cadre_sync(): void {
  rebuild();
}
