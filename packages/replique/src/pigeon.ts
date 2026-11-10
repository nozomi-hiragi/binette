// deno-lint-ignore-file no-import-prefix no-unversioned-import no-namespace verbatim-module-syntax
import { Api, Why, application } from "jsr:@binette/replique/app";
import { rebuild } from "jsr:@binette/replique/ui";

/** この機能が要求するホスト ABI の版。各 external の module 名とテストで一致を確かめる */
export const ABI_VERSION = "0.1";

namespace hostPigeon {
  // @ts-ignore: decorator
  @external("binette:pigeon@0.1", "send")
  export declare function send(to: string, kind: string, title: string, body: string, urgent: bool, actions: string, shares: string): bool;
  // @ts-ignore: decorator
  @external("binette:pigeon@0.1", "count")
  export declare function count(): i32;
  // @ts-ignore: decorator
  @external("binette:pigeon@0.1", "shares")
  export declare function shares(i: i32): string;
  // @ts-ignore: decorator
  @external("binette:pigeon@0.1", "from")
  export declare function from(i: i32): string;
  // @ts-ignore: decorator
  @external("binette:pigeon@0.1", "to")
  export declare function to(i: i32): string;
  // @ts-ignore: decorator
  @external("binette:pigeon@0.1", "kind")
  export declare function kind(i: i32): string;
  // @ts-ignore: decorator
  @external("binette:pigeon@0.1", "title")
  export declare function title(i: i32): string;
  // @ts-ignore: decorator
  @external("binette:pigeon@0.1", "body")
  export declare function body(i: i32): string;
  // @ts-ignore: decorator
  @external("binette:pigeon@0.1", "urgent")
  export declare function urgent(i: i32): bool;
  // @ts-ignore: decorator
  @external("binette:pigeon@0.1", "actions")
  export declare function actions(i: i32): string;
  // @ts-ignore: decorator
  @external("binette:pigeon@0.1", "done")
  export declare function done(i: i32): void;
}

/** `PigeonApi.from(api)`: OS-authenticated letters and the app inbox. Available to all apps. */
export class PigeonApi {
  /** 届いていれば API を、届いていなければ null を返す */
  static from(api: Api): PigeonApi | null {
    return api.why("pigeon") == Why.Granted ? new PigeonApi() : null;
  }

  /** Sending to the user requires notify permission. actions is a JSON array of buttons or inputs. Returns false when rejected. */
  send(to: string, kind: string, title: string, body: string, urgent: bool = false, actions: string = "[]", shares: string = "[]"): bool {
    return hostPigeon.send(to, kind, title, body, urgent, actions, shares);
  }
  shares(i: i32): string { return hostPigeon.shares(i); }
  count(): i32 { return hostPigeon.count(); }
  from(i: i32): string { return hostPigeon.from(i); }
  to(i: i32): string { return hostPigeon.to(i); }
  kind(i: i32): string { return hostPigeon.kind(i); }
  title(i: i32): string { return hostPigeon.title(i); }
  body(i: i32): string { return hostPigeon.body(i); }
  urgent(i: i32): bool { return hostPigeon.urgent(i); }
  /** JSON array of buttons or inputs. */
  actions(i: i32): string { return hostPigeon.actions(i); }
  /** Removes a processed letter from the inbox. */
  done(i: i32): void { hostPigeon.done(i); }
}

/** The OS reports new inbox letters. Initial letters can be read synchronously in onCreate. */
export function __bina_pigeon(): void {
  const app = application;
  if (app === null) return;
  app.onPigeon();
  rebuild();
}
