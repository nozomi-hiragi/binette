// deno-lint-ignore-file no-import-prefix no-unversioned-import no-namespace verbatim-module-syntax
import { Api, Why, application } from "jsr:@binette/replique/app";
import { rebuild } from "jsr:@binette/replique/ui";

/** この機能が要求するホスト ABI の版。各 external の module 名とテストで一致を確かめる */
export const ABI_VERSION = "0.1";

namespace hostShares {
  // @ts-ignore: decorator
  @external("binette:shares@0.1", "request")
  export declare function request(operation: string, args: string): i32;
  // @ts-ignore: decorator
  @external("binette:shares@0.1", "result")
  export declare function result(id: i32): string | null;
}

/** Encode sharing arguments as a JSON array. */
function shareArguments(values: string[]): string {
  let result = "[";
  const hex = "0123456789abcdef";
  for (let i = 0; i < values.length; i++) {
    if (i > 0) result += ",";
    result += "\"";
    const value = values[i];
    for (let j = 0; j < value.length; j++) {
      const code = value.charCodeAt(j);
      if (code == 34 || code == 92) result += "\\" + value.charAt(j);
      else if (code < 32) result += "\\u00" + hex.charAt(code >> 4) + hex.charAt(code & 15);
      else result += value.charAt(j);
    }
    result += "\"";
  }
  return result + "]";
}

/** Sharing operations return a request ID. Read result in onShare and inspect JSON ok/value/error. */
export class SharesApi {
  /** 届いていれば API を、届いていなければ null を返す */
  static from(api: Api): SharesApi | null {
    return api.why("shares") == Why.Granted ? new SharesApi() : null;
  }

  request(operation: string, args: string = "[]"): i32 { return hostShares.request(operation, args); }
  /** Returns null while pending. Each completed result can be consumed once. */
  result(id: i32): string | null { return hostShares.result(id); }
  create(name: string): i32 { return this.request("create", shareArguments([name])); }
  list(): i32 { return this.request("list"); }
  join(id: string): i32 { return this.request("join", shareArguments([id])); }
  leave(id: string): i32 { return this.request("leave", shareArguments([id])); }
  read(id: string, path: string): i32 { return this.request("read", shareArguments([id, path])); }
  write(id: string, path: string, value: string): i32 { return this.request("write", shareArguments([id, path, value])); }
  /** Transfer binary data as base64 strings. */
  readBase64(id: string, path: string): i32 { return this.request("readBase64", shareArguments([id, path])); }
  writeBase64(id: string, path: string, value: string): i32 { return this.request("writeBase64", shareArguments([id, path, value])); }
  remove(id: string, path: string): i32 { return this.request("remove", shareArguments([id, path])); }
  files(id: string, prefix: string = "/"): i32 { return this.request("files", shareArguments([id, prefix])); }
}

/** The OS reports a completed sharing request. */
export function __bina_share(): void {
  const app = application;
  if (app === null) return;
  app.onShare();
  rebuild();
}
