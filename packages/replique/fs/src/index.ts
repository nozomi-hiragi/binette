// deno-lint-ignore-file no-import-prefix verbatim-module-syntax
import { Api, Why } from "jsr:@binette/replique-app@^0.1";

/** この機能が要求するホスト ABI の版。外部呼び出しはまだない */
export const ABI_VERSION = "0.1";

/** `FsApi.from(api)`。ファイルの木。範囲の決め方が未決なので、キーだけ用意して今は誰にも届かない */
export class FsApi {
  /** 届いていれば API を、届いていなければ null を返す */
  static from(api: Api): FsApi | null {
    return api.why("fs") == Why.Granted ? new FsApi() : null;
  }
}
