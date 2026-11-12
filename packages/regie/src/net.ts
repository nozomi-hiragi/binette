/** 通信先の判定に使うリスト。URL は origin か、末尾が / のパスで指定する。 */
export interface NetLists {
  request: readonly string[];
  appAllow: readonly string[];
  appDeny: readonly string[];
  commonAllow: readonly string[];
  commonDeny: readonly string[];
}

/** 正規化した URL の origin とパスを比べる。 */
export function matchesNetUrl(target: string, prefix: string): boolean {
  try {
    const url = new URL(target);
    const rule = new URL(prefix);
    return url.href.startsWith(rule.href);
  } catch {
    return false;
  }
}

/** deny を優先し、要求または allow に含まれる通信先だけを通す。 */
export function allowsNetUrl(url: string, lists: NetLists): boolean {
  const matches = (entries: readonly string[]) => entries.some(entry => matchesNetUrl(url, entry));
  return !matches(lists.commonDeny) && !matches(lists.appDeny) &&
    (matches(lists.request) || matches(lists.appAllow) || matches(lists.commonAllow));
}

/** アプリから受け取る通信の設定。 */
export interface NetRequest {
  url: string;
  method?: string;
  headers?: [string, string][];
  redirect?: string;
}

/** Worker に返す通信の結果。 */
export interface NetResponse {
  status: number;
  statusText: string;
  url: string;
  type: string;
  headers: [string, string][];
  /** 本文。Worker へは転送で渡す */
  body: Uint8Array;
  reason: string;
}

const failure = (reason: string): NetResponse => ({ status: 0, statusText: "", url: "", type: "error", headers: [], body: new Uint8Array(0), reason });
const allowedHeaders = new Set(["accept", "if-none-match", "if-modified-since"]);
const exposedHeaders = ["content-type", "etag", "last-modified"];
const maxBytes = 4 * 1024 * 1024;

/** アプリごとの同時数を管理し、要求の検査と通信を行う。 */
export function createNetService(fetcher: typeof fetch = fetch, timeout = 30_000) {
  const queues = new Map<string, { active: number; waiting: (() => void)[] }>();
  return async (app: string, request: NetRequest, lists: NetLists, signal: AbortSignal): Promise<NetResponse> => {
    let url: URL;
    try {
      url = new URL(request.url);
      if (url.protocol !== "https:" || url.username || url.password || request.url.includes("#") || request.url.includes("*")) return failure("invalid");
    } catch { return failure("invalid"); }
    if ((request.method ?? "GET") !== "GET" || !["manual", "error"].includes(request.redirect ?? "manual")) return failure("invalid");
    const headers = new Headers();
    try {
      for (const [name, value] of request.headers ?? []) {
        if (!allowedHeaders.has(name.toLowerCase())) return failure("invalid");
        headers.append(name, value);
      }
    } catch { return failure("invalid"); }
    if (!allowsNetUrl(url.href, lists)) return failure("blocked");
    if (typeof navigator !== "undefined" && navigator.onLine === false) return failure("offline");
    const queue = queues.get(app) ?? { active: 0, waiting: [] };
    queues.set(app, queue);
    if (queue.active >= 4) {
      const acquired = await new Promise<boolean>(resolve => {
        const ready = () => { signal.removeEventListener("abort", cancel); resolve(true); };
        const cancel = () => { const index = queue.waiting.indexOf(ready); if (index >= 0) queue.waiting.splice(index, 1); resolve(false); };
        queue.waiting.push(ready);
        signal.addEventListener("abort", cancel, { once: true });
        if (signal.aborted) cancel();
      });
      if (!acquired) return failure("aborted");
    } else queue.active++;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
    const interrupted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error("通信を中断しました。")), { once: true });
    });
    try {
      if (signal.aborted) return failure("aborted");
      const response = await Promise.race([interrupted, fetcher(url.href, { method: "GET", headers, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", redirect: "manual", signal: controller.signal })]);
      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400 && response.status !== 304)) {
        if (request.redirect === "error") return failure("redirect");
        return { status: 0, statusText: "", url: "", type: "opaqueredirect", headers: [], body: new Uint8Array(0), reason: "" };
      }
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          for (;;) {
            const next = await Promise.race([interrupted, reader.read()]);
            if (next.done) break;
            length += next.value.length;
            if (length > maxBytes) { void reader.cancel().catch(() => {}); return failure("too_large"); }
            chunks.push(next.value);
          }
        } finally {
          if (controller.signal.aborted) void reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      }
      const body = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
      return { status: response.status, statusText: response.statusText, url: response.url, type: "cors", headers: exposedHeaders.flatMap(name => { const value = response.headers.get(name); return value === null ? [] : [[name, value] as [string, string]]; }), body, reason: "" };
    } catch {
      return failure(timedOut ? "timeout" : signal.aborted ? "aborted" : typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "network");
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      const next = queue.waiting.shift();
      if (next) next();
      else if (--queue.active === 0) queues.delete(app);
    }
  };
}
