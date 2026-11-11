// deno-lint-ignore-file no-import-prefix no-namespace verbatim-module-syntax
import { Api, Why } from "jsr:@binette/replique-app@^0.1";
import { Element } from "jsr:@binette/replique-dom@^0.1";

/** この機能が要求するホスト ABI の版。各 external の module 名とテストで一致を確かめる */
export const ABI_VERSION = "0.1";

// @ts-ignore: decorator
@external("binette:apps@0.1", "icon")
declare function iconImport(handle: i32, app: i32): void;

// OS の呼び出しの入口。アプリは直接使わず、辞書 `Api` から取ったクラスを通す
namespace hostApps {
  // @ts-ignore: decorator
  @external("binette:apps@0.1", "count")
  export declare function count(): i32;
  // @ts-ignore: decorator
  @external("binette:apps@0.1", "name")
  export declare function name(i: i32): string;
  // @ts-ignore: decorator
  @external("binette:apps@0.1", "id")
  export declare function id(i: i32): string;
  // @ts-ignore: decorator
  @external("binette:apps@0.1", "open")
  export declare function open(i: i32): void;
}

/** `AppsApi.from(api)`。アプリの一覧と起動。ホーム（と Cadre）の役割を割り当てられたアプリに届く */
export class AppsApi {
  /** 届いていれば API を、届いていなければ null を返す */
  static from(api: Api): AppsApi | null {
    return api.why("apps") == Why.Granted ? new AppsApi() : null;
  }

  /** img に OS のアプリアイコンを入れる */
  icon(img: Element, i: i32): void { iconImport(img.handle, i); }
  count(): i32 { return hostApps.count(); }
  name(i: i32): string { return hostApps.name(i); }
  id(i: i32): string { return hostApps.id(i); }
  open(i: i32): void { hostApps.open(i); }
}
