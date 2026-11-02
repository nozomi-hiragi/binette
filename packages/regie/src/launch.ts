import type { DomOp } from "@binette/core";
import type { LifecycleRecord, SystemSettings } from "./store.ts";

/** 設定アプリの起動時に渡す写し。アプリの id は installedAppKey */
export interface OsSnapshot {
  settings: Omit<SystemSettings, "roles">;
  /** 役割に割り当てたアプリ */
  roles: Record<string, string>;
  /** 役割ごとの選べるアプリ。割り当てを変えられる役割だけが載る */
  candidates: Record<string, { id: string; name: string }[]>;
  launches: { time: number; name: string }[];
  /** 新しい版の `/system` があるか */
  updateAvailable: boolean;
  updateState?: { phase: string; current: string; next: string; available: boolean };
}

/** API の辞書に載らなかった理由。権限がない（NotGranted）か、役割に割り当てられていない（NotAssigned） */
export type ApiDenial = "NotGranted" | "NotAssigned";

/** シェルの起動中アプリ一覧の各要素 */
export interface ShellInstance {
  id: number;
  appIndex: number;
  name: string;
  front: boolean;
  hasIcon: boolean;
}

/** シェルアプリの起動時に渡す写し */
export interface ShellSnapshot {
  instances: ShellInstance[];
  homeFront: boolean;
  installed: boolean;
  installBusy: boolean;
}

/** 辞書に入りうるキー。アプリのライブラリ（Réplique）の `Api` と同じ */
export const API_KEYS = ["apps", "os", "storage", "fs", "shell"] as const;

/** メインスレッド側から見た Worker。ブラウザの `Worker` や、テストで使う `MessagePort` がこの形を持つ */
export interface RegieWorker {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener<K extends "message" | "error" | "messageerror">(type: K, listener: (event: K extends "error" ? ErrorEvent : MessageEvent) => void): void;
  terminate(): void;
}

/** {@link launchApp} の設定 */
export interface LaunchOptions {
  /** 一回の呼び出しと起動の時間切れ（ミリ秒、既定 5000） */
  callTimeout?: number;
  /** 今のページの識別子 */
  page?: string;
  /** HTML を持たない宣言的 UI アプリ */
  declarative?: boolean;
  /** 前回の最後の記録 */
  last?: LifecycleRecord;
  /** アプリが自分を閉じたとき。今の呼び出しの完了後に届く */
  onFinish?: () => void;
  /** _start または一回の call で溜めた操作。完了通知より先に届く */
  onDom?: (ops: DomOp[]) => void;
  /** 辞書の `apps`。ホームとシェルに渡すアプリ。省略時は apps.* を使えない */
  apps?: { id: string; name: string }[];
  onOpen?: (i: number) => void;
  /** 辞書の `os`。設定アプリだけに渡す。省略時は os.* を使えない */
  os?: OsSnapshot;
  onSet?: (name: string, value: number) => void;
  /** 役割に割り当てるアプリを、候補の番号で選ぶ */
  onAssign?: (role: string, i: number) => void;
  /** 「更新」を押された */
  onUpdate?: () => void;
  onCheckUpdate?: () => void;
  onOpenRecovery?: () => void;
  /** 辞書の `storage`。アプリごとのデータの写し。省略時は storage.* を使えない */
  storage?: Map<string, string>;
  /** データの書き込み。value が null なら削除 */
  onStorage?: (name: string, value: string | null) => void;
  /** 辞書の `shell`。シェルアプリだけに渡す。省略時は shell.* を使えない */
  shell?: ShellSnapshot;
  onShellOpen?: (i: number) => void;
  onShellClose?: (i: number) => void;
  onShellBack?: () => void;
  onShellHome?: () => void;
  /** シェルが設定アプリを開くよう頼んだとき */
  onShellSettings?: () => void;
  onShellNotify?: (text: string) => void;
  onShellInstall?: () => void;
  /** 辞書に載せなかったキーの理由。書かれていないキーは NotGranted として扱う */
  denied?: Record<string, ApiDenial>;
  /** アプリを終了しない呼び出しの失敗 */
  onError?: (error: Error) => void;
  /** 起動後にアプリが終了したとき。stop や signal では呼ばない */
  onExit?: (error: Error) => void;
  /** Worker を作る関数。省略すると独立した module Worker。テストでは同じスレッドの `MessageChannel` を渡す */
  createWorker?: () => RegieWorker;
  /** module Worker の URL。createWorker があればそちらを優先する */
  workerUrl?: string | URL;
  /** 起動中でも Worker を止める */
  signal?: AbortSignal;
}

/** 起動したアプリ */
export interface RegieApp {
  /** アプリが export している関数の名前 */
  readonly exports: readonly string[];
  /** export した関数を呼ぶ。終わったら解決する。呼び出し中の DOM 操作は、解決より先に `onDom` に届く */
  call(name: string, ...args: (number | string)[]): Promise<void>;
  /** シェルの状態（起動中アプリ一覧や前面）の更新を Worker に知らせる */
  syncShell?(snapshot: ShellSnapshot): void;
  syncOs?(snapshot: OsSnapshot): void;
  /** Worker を止める */
  stop(): void;
}

/** 独立した URL の Worker。Vite は本番でこの入口を固定名へ書き出す */
function createModuleWorker(url?: string | URL): RegieWorker {
  if (url !== undefined) return new Worker(url, { type: "module" });
  return new Worker(new URL("./worker-entry.ts", import.meta.url), { type: "module" });
}

/**
 * アプリの WASM を Worker で起動する。export された関数名の一覧を受け取ったら解決する。
 * 状態の通知は、呼び出し側が画面を用意してから行う。
 * WASM は `--exportStart _start` でビルドしておく。トップレベルの初期化は、起動のときに `_start` で走らせる。
 *
 * @param wasm ビルドしたアプリの WASM
 * @throws {Error} WASM を起動できないとき
 */
export function launchApp(wasm: Uint8Array | ArrayBuffer, options: LaunchOptions = {}): Promise<RegieApp> {
  if (options.signal?.aborted) return Promise.reject(new Error("アプリを止めました。"));
  const worker = options.createWorker ? options.createWorker() : createModuleWorker(options.workerUrl);
  const pending = new Map<number, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const timeout = options.callTimeout ?? 5000;
  let initTimer: ReturnType<typeof setTimeout> | undefined;
  let finishing = false;
  const openings: number[] = [];
  const assignments: [string, number][] = [];
  let nextId = 1;
  let stopped = false;
  let rejectLaunch: ((error: Error) => void) | undefined;

  const finish = (error: Error, notify: boolean) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(initTimer);
    options.signal?.removeEventListener("abort", stop);
    worker.terminate();
    const launching = rejectLaunch;
    rejectLaunch = undefined;
    launching?.(error);
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(error); }
    pending.clear();
    if (!launching && notify) options.onExit?.(error);
  };
  const stop = () => finish(new Error("アプリを止めました。"), false);
  const exit = (error: Error) => finish(error, true);

  const expired = () => exit(new Error("アプリが応答しないので終了しました。"));
  const notifyRequests = () => {
    if (rejectLaunch || pending.size || stopped) return;
    for (const [role, i] of assignments.splice(0)) options.onAssign?.(role, i);
    if (finishing) { finishing = false; openings.length = 0; options.onFinish?.(); }
    else for (const i of openings.splice(0)) options.onOpen?.(i);
  };

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
      const data = event.data as { type: string; exit?: boolean; id?: number; message?: string; exports?: string[]; ops?: DomOp[]; i?: number; name?: string; value?: number | string | null; role?: string; text?: string };
      switch (data.type) {
        case "ready": {
          clearTimeout(initTimer);
          rejectLaunch = undefined;
          const exports = Object.freeze([...data.exports!]);
          resolve({
            exports,
            call(name, ...args) {
              if (stopped) return Promise.reject(new Error("アプリは止まっています。"));
              return new Promise<void>((resolveCall, rejectCall) => {
                const id = nextId++;
                const timer = setTimeout(expired, timeout);
                pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
                try { worker.postMessage({ type: "call", id, name, args }); }
                catch (error) { exit(error instanceof Error ? error : new Error(String(error))); }
              });
            },
            syncOs(snapshot) {
              if (stopped) return;
              const id = nextId++;
              pending.set(id, { resolve: () => {}, reject: () => {}, timer: setTimeout(expired, timeout) });
              try { worker.postMessage({ type: "os.sync", id, os: snapshot }); }
              catch (error) { exit(error instanceof Error ? error : new Error(String(error))); }
            },
            syncShell(snapshot) {
              if (stopped) return;
              // 描き直しで固まったときも、ほかの呼び出しと同じ時間切れで終了させる
              const id = nextId++;
              pending.set(id, { resolve: () => {}, reject: () => {}, timer: setTimeout(expired, timeout) });
              try { worker.postMessage({ type: "shell.sync", id, shell: snapshot }); }
              catch (error) { exit(error instanceof Error ? error : new Error(String(error))); }
            },
            stop,
          });
          notifyRequests();
          break;
        }
        case "failed": {
          const error = new Error(data.message);
          exit(error);
          break;
        }
        case "dom": options.onDom?.(data.ops!); break;
        case "apps.open": openings.push(data.i!); break;
        case "os.set": options.onSet?.(data.name!, data.value as number); break;
        case "os.assign": assignments.push([data.role!, data.i!]); break;
        case "os.openRecovery": options.onOpenRecovery?.(); break;
        case "os.checkUpdate": options.onCheckUpdate?.(); break;
        case "os.update": options.onUpdate?.(); break;
        case "storage.write": options.onStorage?.(data.name!, data.value as string | null); break;
        case "shell.open": options.onShellOpen?.(data.i!); break;
        case "shell.close": options.onShellClose?.(data.i!); break;
        case "shell.back": options.onShellBack?.(); break;
        case "shell.home": options.onShellHome?.(); break;
        case "shell.settings": options.onShellSettings?.(); break;
        case "shell.notify": options.onShellNotify?.(data.text!); break;
        case "shell.install": options.onShellInstall?.(); break;
        case "finish": finishing = true; break;
        case "done": {
          clearTimeout(pending.get(data.id!)?.timer);
          pending.get(data.id!)?.resolve();
          pending.delete(data.id!);
          notifyRequests();
          break;
        }
        case "fail": {
          const error = new Error(data.message);
          if (data.exit) { exit(error); break; }
          options.onError?.(error);
          clearTimeout(pending.get(data.id!)?.timer);
          pending.get(data.id!)?.reject(error);
          pending.delete(data.id!);
          notifyRequests();
          break;
        }
      }
    });
    // Uint8Array は大きなバッファの一部だけを見ている場合があるので、WASM の分だけを新しいバッファに写して渡す
    const copy = wasm instanceof Uint8Array ? new Uint8Array(wasm).buffer : wasm.slice(0);
    try {
      initTimer = setTimeout(expired, timeout);
      worker.postMessage({ type: "init", wasm: copy, page: options.page ?? "", declarative: options.declarative, last: options.last, ...(options.apps === undefined ? {} : { apps: options.apps }), ...(options.os === undefined ? {} : { os: options.os }), ...(options.storage === undefined ? {} : { storage: options.storage }), ...(options.shell === undefined ? {} : { shell: options.shell }), ...(options.denied === undefined ? {} : { denied: options.denied }) }, [copy]);
    } catch (error) {
      rejectLaunch = undefined;
      stop();
      reject(error);
    }
  });
}
