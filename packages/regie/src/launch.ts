import { serveApp } from "./worker.ts";

/** メインスレッド側から見た Worker。ブラウザの `Worker` や、テストで使う `MessagePort` がこの形を持つ */
export interface RegieWorker {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener<K extends "message" | "error" | "messageerror">(type: K, listener: (event: K extends "error" ? ErrorEvent : MessageEvent) => void): void;
  terminate(): void;
}

/** アプリから届く DOM 操作 */
export type DomOp =
  | { op: "byId"; handle: number; id: string }
  | { op: "create"; handle: number; tag: string }
  | { op: "text"; handle: number; value: string }
  | { op: "class"; handle: number; value: string }
  | { op: "append"; parent: number; child: number }
  | { op: "remove"; handle: number }
  | { op: "listen"; handle: number; type: string; listener: number }
  | { op: "icon"; handle: number; app: number };

/** {@link launchApp} の設定 */
export interface LaunchOptions {
  /** _start または一回の call で溜めた操作。完了通知より先に届く */
  onDom?: (ops: DomOp[]) => void;
  /** ホームへ渡すアプリ。省略時は apps.* を使えない */
  apps?: { id: string; name: string }[];
  onOpen?: (i: number) => void;
  /** アプリを終了しない呼び出しの失敗 */
  onError?: (error: Error) => void;
  /** 起動後にアプリが終了したとき。stop や signal では呼ばない */
  onExit?: (error: Error) => void;
  /** Worker を作る関数。省略すると Blob URL の Worker。テストでは同じスレッドの `MessageChannel` を渡す */
  createWorker?: () => RegieWorker;
  /** 起動中でも Worker を止める */
  signal?: AbortSignal;
}

/** 起動したアプリ */
export interface RegieApp {
  /** アプリが export している関数の名前 */
  readonly exports: readonly string[];
  /** export した関数を呼ぶ。終わったら解決する。呼び出し中の DOM 操作は、解決より先に `onDom` に届く */
  call(name: string, arg?: number): Promise<void>;
  /** Worker を止める */
  stop(): void;
}

/** 関数の `toString()` から Blob URL の Worker を作る。ワーカーのファイルの場所に頼らない */
function createBlobWorker(): RegieWorker {
  const source = `(${serveApp.toString()})(self)`;
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const worker = new Worker(url);
  URL.revokeObjectURL(url);
  return worker;
}

/**
 * アプリの WASM を Worker で起動する。export された関数名の一覧を受け取ったら解決する。
 * `start()` はここでは呼ばない。呼び出し側が画面を用意してから `call("start")` する。
 * WASM は `--exportStart _start` でビルドしておく。トップレベルの初期化は、起動のときに `_start` で走らせる。
 *
 * @param wasm ビルドしたアプリの WASM
 * @throws {Error} WASM を起動できないとき
 */
export function launchApp(wasm: Uint8Array | ArrayBuffer, options: LaunchOptions = {}): Promise<RegieApp> {
  if (options.signal?.aborted) return Promise.reject(new Error("アプリを止めました。"));
  const worker = (options.createWorker ?? createBlobWorker)();
  const pending = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
  let nextId = 1;
  let stopped = false;
  let rejectLaunch: ((error: Error) => void) | undefined;

  const finish = (error: Error, notify: boolean) => {
    if (stopped) return;
    stopped = true;
    options.signal?.removeEventListener("abort", stop);
    worker.terminate();
    const launching = rejectLaunch;
    rejectLaunch = undefined;
    launching?.(error);
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
    if (!launching && notify) options.onExit?.(error);
  };
  const stop = () => finish(new Error("アプリを止めました。"), false);
  const exit = (error: Error) => finish(error, true);

  return new Promise<RegieApp>((resolve, reject) => {
    rejectLaunch = reject;
    options.signal?.addEventListener("abort", stop, { once: true });
    if (options.signal?.aborted) { stop(); return; }
    worker.addEventListener("error", (event) => {
      event.preventDefault?.();
      exit(new Error(event.message ? `アプリが落ちました: ${event.message}` : "アプリが落ちました。"));
    });
    worker.addEventListener("messageerror", () => exit(new Error("アプリとのやりとりに失敗しました。")));
    worker.addEventListener("message", (event) => {
      if (stopped) return;
      const data = event.data as { type: string; exit?: boolean; id?: number; message?: string; exports?: string[]; ops?: DomOp[]; i?: number };
      switch (data.type) {
        case "ready": {
          rejectLaunch = undefined;
          const exports = Object.freeze([...data.exports!]);
          resolve({
            exports,
            call(name, arg) {
              if (stopped) return Promise.reject(new Error("アプリは止まっています。"));
              return new Promise<void>((resolveCall, rejectCall) => {
                const id = nextId++;
                pending.set(id, { resolve: resolveCall, reject: rejectCall });
                worker.postMessage({ type: "call", id, name, ...(arg === undefined ? {} : { arg }) });
              });
            },
            stop,
          });
          break;
        }
        case "failed": {
          const error = new Error(data.message);
          exit(error);
          break;
        }
        case "dom": options.onDom?.(data.ops!); break;
        case "apps.open": options.onOpen?.(data.i!); break;
        case "done": {
          pending.get(data.id!)?.resolve();
          pending.delete(data.id!);
          break;
        }
        case "fail": {
          const error = new Error(data.message);
          if (data.exit) { exit(error); break; }
          options.onError?.(error);
          pending.get(data.id!)?.reject(error);
          pending.delete(data.id!);
          break;
        }
      }
    });
    // Uint8Array は大きなバッファの一部だけを見ている場合があるので、WASM の分だけを新しいバッファに写して渡す
    const copy = wasm instanceof Uint8Array ? new Uint8Array(wasm).buffer : wasm.slice(0);
    try {
      worker.postMessage({ type: "init", wasm: copy, ...(options.apps === undefined ? {} : { apps: options.apps }) }, [copy]);
    } catch (error) {
      rejectLaunch = undefined;
      stop();
      reject(error);
    }
  });
}
