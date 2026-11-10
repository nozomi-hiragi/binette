// deno-lint-ignore-file no-import-prefix no-unversioned-import no-namespace verbatim-module-syntax
import { Api, Why } from "jsr:@binette/replique/app";
import { Element } from "jsr:@binette/replique/dom";

// @ts-ignore: decorator
@external("binette", "apps.icon")
declare function iconImport(handle: i32, app: i32): void;

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
