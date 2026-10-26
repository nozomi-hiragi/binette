import { serveApp } from "./worker.ts";

/** メインスレッド側から見た Worker。ブラウザの `Worker` や、テストで使う `MessagePort` がこの形を持つ */
export interface RegieWorker {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  terminate(): void;
}

/** {@link launchApp} の設定 */
export interface LaunchOptions {
  /** アプリが要素の文字を書き換えたとき（`elem(name).text = value`） */
  onText?: (name: string, value: string) => void;
  /** ホームへ渡すアプリ。省略時は apps.* を使えない */
  apps?: { id: string; name: string }[];
  onListAdd?: (list: string, row: number) => void;
  onListClear?: (list: string) => void;
  onItemText?: (list: string, row: number, name: string, value: string) => void;
  onItemIcon?: (list: string, row: number, app: number) => void;
  onOpen?: (i: number) => void;
  /** アプリの中で起きたエラー（abort や、呼び出しの失敗） */
  onError?: (error: Error) => void;
  /** Worker を作る関数。省略すると Blob URL の Worker。テストでは同じスレッドの `MessageChannel` を渡す */
  createWorker?: () => RegieWorker;
  /** 起動中でも Worker を止める */
  signal?: AbortSignal;
}

/** 起動したアプリ */
export interface RegieApp {
  /** アプリが export している関数の名前 */
  readonly exports: readonly string[];
  /** export した関数を呼ぶ。終わったら解決する。呼び出し中の文字の書き換えは、解決より先に `onText` に届く */
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

  const stop = () => {
    if (stopped) return;
    stopped = true;
    options.signal?.removeEventListener("abort", stop);
    worker.terminate();
    rejectLaunch?.(new Error("アプリを止めました。"));
    rejectLaunch = undefined;
    for (const { reject } of pending.values()) reject(new Error("アプリを止めました。"));
    pending.clear();
  };

  return new Promise<RegieApp>((resolve, reject) => {
    rejectLaunch = reject;
    options.signal?.addEventListener("abort", stop, { once: true });
    if (options.signal?.aborted) { stop(); return; }
    worker.addEventListener("message", (event) => {
      if (stopped) return;
      const data = event.data as { type: string; id?: number; name?: string; value?: string; message?: string; exports?: string[]; list?: string; row?: number; app?: number; i?: number };
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
          rejectLaunch = undefined;
          stop();
          reject(error);
          break;
        }
        case "text":
          options.onText?.(data.name!, data.value!);
          break;
        case "list.add": options.onListAdd?.(data.list!, data.row!); break;
        case "list.clear": options.onListClear?.(data.list!); break;
        case "item.text": options.onItemText?.(data.list!, data.row!, data.name!, data.value!); break;
        case "item.icon": options.onItemIcon?.(data.list!, data.row!, data.app!); break;
        case "apps.open": options.onOpen?.(data.i!); break;
        case "done": {
          pending.get(data.id!)?.resolve();
          pending.delete(data.id!);
          break;
        }
        case "fail": {
          const error = new Error(data.message);
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
