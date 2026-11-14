// deno-lint-ignore-file no-import-prefix no-namespace verbatim-module-syntax
import { Api, Why, application, jsonString, Response } from "jsr:@binette/replique-app@^0.1";
import { rebuild } from "jsr:@binette/replique-ui@^0.1";
export { Response } from "jsr:@binette/replique-app@^0.1";
export const ABI_VERSION = "0.1";
namespace hostNet {
  // @ts-ignore: decorator
  @external("binette:net@0.1", "addAllow")
  export declare function addAllow(url: string): bool;
  // @ts-ignore: decorator
  @external("binette:net@0.1", "removeAllow")
  export declare function removeAllow(url: string): bool;
  // @ts-ignore: decorator
  @external("binette:net@0.1", "request")
  export declare function request(url: string, method: string, headers: string, redirect: string): i32;
  // @ts-ignore: decorator
  @external("binette:net@0.1", "abort")
  export declare function abort(id: i32): void;
}
/** fetch の要求設定。 */
export class RequestInit {
  methodValue: string = "GET";
  redirectValue: string = "manual";
  headers: string[] = [];
  method(value: string): RequestInit { this.methodValue = value; return this; }
  redirect(value: string): RequestInit { this.redirectValue = value; return this; }
  header(name: string, value: string): RequestInit { this.headers.push("[" + jsonString(name) + "," + jsonString(value) + "]"); return this; }
}
/** ネットへの要求。 */
export class NetApi {
  static from(api: Api): NetApi | null { return api.why("net") == Why.Granted ? new NetApi() : null; }
  fetch(url: string, init: RequestInit = new RequestInit()): i32 { return hostNet.request(url, init.methodValue, "[" + init.headers.join(",") + "]", init.redirectValue); }
  abort(id: i32): void { hostNet.abort(id); }
  /** addAllow の権限があり、正しい URL で 100 件以内なら足す。既存の URL も true */
  addAllow(url: string): bool { return hostNet.addAllow(url); }
  /** このアプリが足した URL だけを消す。消せたら true */
  removeAllow(url: string): bool { return hostNet.removeAllow(url); }
}
/** OS から届いた要求の結果をアプリに渡す。 */
export function __bina_net(id: i32): void {
  const app = application;
  if (app === null) return;
  app.onNet(id, new Response(id));
  rebuild();
}
