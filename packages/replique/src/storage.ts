// deno-lint-ignore-file no-namespace no-import-prefix no-unversioned-import verbatim-module-syntax
import { Api, Why } from "jsr:@binette/replique/app";

/** この機能が要求するホスト ABI の版。各 external の module 名とテストで一致を確かめる */
export const ABI_VERSION = "0.1";

namespace hostStorage {
  // @ts-ignore: decorator
  @external("binette:storage@0.1", "has")
  export declare function has(name: string): bool;
  // @ts-ignore: decorator
  @external("binette:storage@0.1", "read")
  export declare function read(name: string): string | null;
  // @ts-ignore: decorator
  @external("binette:storage@0.1", "write")
  export declare function write(name: string, value: string): bool;
  // @ts-ignore: decorator
  @external("binette:storage@0.1", "remove")
  export declare function remove(name: string): void;
  // @ts-ignore: decorator
  @external("binette:storage@0.1", "count")
  export declare function count(): i32;
  // @ts-ignore: decorator
  @external("binette:storage@0.1", "name")
  export declare function name(i: i32): string;
}

/** `StorageApi.from(api)`。アプリごとのデータ（`/data/<id>/`）。名前は 1 つの部品で、中身は文字列。すべてのアプリに届く */
export class StorageApi {
  /** 届いていれば API を、届いていなければ null を返す */
  static from(api: Api): StorageApi | null {
    return api.why("storage") == Why.Granted ? new StorageApi() : null;
  }

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
