// deno-lint-ignore-file no-namespace no-import-prefix verbatim-module-syntax
import { Api, Why } from "jsr:@binette/replique-app@^0.1";

/** この機能が要求するホスト ABI の版。各 external の module 名とテストで一致を確かめる */
export const ABI_VERSION = "0.1";

namespace hostManager {
  // @ts-ignore: decorator
  @external("binette:manager@0.1", "text")
  export declare function text(query: string, key: string, i: i32): string;
  // @ts-ignore: decorator
  @external("binette:manager@0.1", "number")
  export declare function number(query: string, key: string, i: i32): f64;
  // @ts-ignore: decorator
  @external("binette:manager@0.1", "do")
  export declare function act(action: string, a: string, b: string, flag: bool): void;
}

/**
 * `AppManagerApi.from(api)`。提供リスト（repo）の登録、アプリのインストール・更新・削除、自動更新。
 * 役割 apps-manager に割り当てたアプリにだけ届く。アプリは完全な ID で指す。
 * 操作はすぐ戻り、状態が変わると OS が `build()` をやり直させる。
 */
export class AppManagerApi {
  /** 届いていれば API を、届いていなければ null を返す */
  static from(api: Api): AppManagerApi | null {
    return api.why("manager") == Why.Granted ? new AppManagerApi() : null;
  }

  repoCount(): i32 { return <i32>hostManager.number("repoCount", "", 0); }
  repoUrl(i: i32): string { return hostManager.text("repoUrl", "", i); }
  repoName(i: i32): string { return hostManager.text("repoName", "", i); }
  repoHost(i: i32): string { return hostManager.text("repoHost", "", i); }
  /** 既定の提供リストは消せない */
  repoRemovable(i: i32): bool { return hostManager.number("repoRemovable", "", i) != 0; }
  /** 空、`loading`、`error: 理由` */
  repoState(i: i32): string { return hostManager.text("repoState", "", i); }
  addRepo(url: string): void { hostManager.act("addRepo", url, "", false); }
  removeRepo(url: string): void { hostManager.act("removeRepo", url, "", false); }
  /** url を省くと全リスト */
  checkUpdates(url: string = ""): void { hostManager.act("checkUpdates", url, "", false); }

  /** カタログのアプリの数。url を省くと全リスト */
  appCount(url: string = ""): i32 { return <i32>hostManager.number("appCount", url, 0); }
  appId(url: string, i: i32): string { return hostManager.text("appId", url, i); }
  /** 入っているアプリ（本体なし・データありも含む） */
  installedCount(): i32 { return <i32>hostManager.number("installedCount", "", 0); }
  installedId(i: i32): string { return hostManager.text("installedId", "", i); }
  /** 更新があるアプリ。url を省くと全リスト */
  updateCount(url: string = ""): i32 { return <i32>hostManager.number("updateCount", url, 0); }
  updateId(url: string, i: i32): string { return hostManager.text("updateId", url, i); }

  /** 提供リストの URL。埋め込みは空 */
  list(id: string): string { return hostManager.text("list", id, 0); }
  name(id: string): string { return hostManager.text("name", id, 0); }
  /** アイコンの URL。無ければ空 */
  icon(id: string): string { return hostManager.text("icon", id, 0); }
  description(id: string): string { return hostManager.text("description", id, 0); }
  /** カタログの版 */
  version(id: string): string { return hostManager.text("version", id, 0); }
  /** 入っている版。入っていなければ空 */
  installedVersion(id: string): string { return hostManager.text("installedVersion", id, 0); }
  /** カタログの ABI 要求が現在の OS に合うか。要求のない旧リストは true */
  compatible(id: string): bool { return hostManager.number("compatible", id, 0) != 0; }
  compatibilityError(id: string): string { return hostManager.text("compatibilityError", id, 0); }
  /** 保存した WASM が今の OS の ABI に合わない場合の案内。問題がなければ空 */
  installedError(id: string): string { return hostManager.text("installedError", id, 0); }
  /** 本体だけを消して同じ ID を入れ直す。アプリのデータを引き継ぐ */
  reinstall(id: string): void { hostManager.act("reinstall", id, "", false); }
  /** 本体を消してデータだけが残っている */
  removed(id: string): bool { return hostManager.number("removed", id, 0) != 0; }
  removable(id: string): bool { return hostManager.number("removable", id, 0) != 0; }
  /** none・installed・update・waiting・fetching・building・saving・prepared・failed */
  state(id: string): string { return hostManager.text("state", id, 0); }
  error(id: string): string { return hostManager.text("error", id, 0); }
  /** 取ったファイルの数とバイト数 */
  files(id: string): i32 { return <i32>hostManager.number("files", id, 0); }
  bytes(id: string): f64 { return hostManager.number("bytes", id, 0); }

  /** 詳細を取りに行く。届いたら detailsReady が true になる */
  details(id: string): void { hostManager.act("details", id, "", false); }
  detailsReady(id: string): bool { return hostManager.number("detailReady", id, 0) != 0; }
  detailsError(id: string): string { return hostManager.text("detailError", id, 0); }
  /** 提供リストの表示名 */
  listName(id: string): string { return hostManager.text("detailListName", id, 0); }
  permissionCount(id: string): i32 { return <i32>hostManager.number("permissionCount", id, 0); }
  permissionName(id: string, i: i32): string { return hostManager.text("permissionName", id, i); }
  permissionReason(id: string, i: i32): string { return hostManager.text("permissionReason", id, i); }
  /** 更新で増える権限 */
  addedCount(id: string): i32 { return <i32>hostManager.number("addedCount", id, 0); }
  addedName(id: string, i: i32): string { return hostManager.text("addedName", id, i); }
  roleCount(id: string): i32 { return <i32>hostManager.number("roleCount", id, 0); }
  roleName(id: string, i: i32): string { return hostManager.text("roleName", id, i); }
  /** 改ざん検出のハッシュがカタログにあるか */
  integrity(id: string): bool { return hostManager.number("integrity", id, 0) != 0; }

  /** 入れる。入っていれば更新する。権限は OS が確かめる */
  install(id: string): void { hostManager.act("install", id, "", false); }
  /** withData が false なら本体だけを消し、データを残す */
  uninstall(id: string, withData: bool): void { hostManager.act("uninstall", id, "", withData); }
  cancel(id: string): void { hostManager.act("cancel", id, "", false); }
  /** 準備済みの更新を入れる（動いていれば終了させてから） */
  apply(id: string): void { hostManager.act("apply", id, "", false); }

  /** 自動更新がオンとして扱われるか（リストごと・全体の上書きを含む） */
  autoUpdates(id: string): bool { return hostManager.number("auto", id, 0) != 0; }
  autoUpdateAll(): bool { return hostManager.number("autoAll", "", 0) != 0; }
  autoUpdateRepo(url: string): bool { return hostManager.number("autoList", url, 0) != 0; }
  /** アプリごとの設定。既定はオン */
  autoUpdateApp(id: string): bool { return hostManager.number("autoApp", id, 0) != 0; }
  setAutoUpdateAll(value: bool): void { hostManager.act("setAutoUpdate", "all", "", value); }
  setAutoUpdateRepo(url: string, value: bool): void { hostManager.act("setAutoUpdate", "list", url, value); }
  setAutoUpdateApp(id: string, value: bool): void { hostManager.act("setAutoUpdate", "app", id, value); }
}
