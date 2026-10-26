import { serveApp } from "./worker.ts";

/** メインスレッド側から見た Worker。ブラウザの `Worker` や、テストで使う `MessagePort` がこの形を持つ */
export interface RegieWorker {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  terminate(): void;
}

/** {@link launchApp} の設定 */
export interface LaunchOptions {
  /** アプリが `ui.text` を呼んだとき */
  onText?: (name: string, value: string) => void;
  /** アプリの中で起きたエラー（abort や、呼び出しの失敗） */
  onError?: (error: Error) => void;
  /** Worker を作る関数。省略すると Blob URL の Worker。テストでは同じスレッドの `MessageChannel` を渡す */
  createWorker?: () => RegieWorker;
}

/** 起動したアプリ */
export interface RegieApp {
  /** アプリが export している関数の名前 */
  readonly exports: readonly string[];
  /** export した関数を呼ぶ。終わったら解決する。呼び出し中の `ui.text` は、解決より先に `onText` に届く */
  call(name: string): Promise<void>;
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
 *
 * @param wasm ビルドしたアプリの WASM
 * @throws {Error} WASM を起動できないとき
 */
export function launchApp(wasm: Uint8Array | ArrayBuffer, options: LaunchOptions = {}): Promise<RegieApp> {
  const worker = (options.createWorker ?? createBlobWorker)();
  const pending = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
  let nextId = 1;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    worker.terminate();
    for (const { reject } of pending.values()) reject(new Error("アプリを止めました。"));
    pending.clear();
  };

  return new Promise<RegieApp>((resolve, reject) => {
    worker.addEventListener("message", (event) => {
      const data = event.data as { type: string; id?: number; name?: string; value?: string; message?: string; exports?: string[] };
      switch (data.type) {
        case "ready": {
          const exports = Object.freeze([...data.exports!]);
          resolve({
            exports,
            call(name) {
              if (stopped) return Promise.reject(new Error("アプリは止まっています。"));
              return new Promise<void>((resolveCall, rejectCall) => {
                const id = nextId++;
                pending.set(id, { resolve: resolveCall, reject: rejectCall });
                worker.postMessage({ type: "call", id, name });
              });
            },
            stop,
          });
          break;
        }
        case "failed": {
          const error = new Error(data.message);
          stop();
          reject(error);
          break;
        }
        case "text":
          options.onText?.(data.name!, data.value!);
          break;
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
    // Uint8Array は一部だけ見ている場合があるので、WASM の分だけを切り出して渡す
    const copy = wasm instanceof Uint8Array ? wasm.slice().buffer : wasm.slice(0);
    worker.postMessage({ type: "init", wasm: copy }, [copy]);
  });
}
