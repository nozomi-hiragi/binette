import { BinetteError, type DomOp } from "@binette/core";
import type { LifecycleRecord, SystemSettings } from "./store.ts";

/** A letter whose sender is supplied by the OS. */
export interface PigeonLetter {
  id: number;
  from: string;
  to: string;
  kind: string;
  title: string;
  body: string;
  urgent?: boolean;
  /** OS が送る確認待ち通知の対象。差出人が設定の手紙だけで使う */
  netApp?: string;
  shares?: { id: string; access: "read" | "write" }[];
  actions?: { id: string; label: string; input?: boolean; placeholder?: string }[];
}
/** A letter to the user as kept in the history: when it arrived and whether it was opened. */
export interface UserLetter extends PigeonLetter { time: number; opened: boolean }
export interface PigeonSnapshot { letters: PigeonLetter[]; notify: boolean }
/** What settings can do to the history: show the sender, force a letter open, or delete it. */
export const LETTER_ACTIONS = ["show", "open", "openAll", "delete", "deleteAll"] as const;
export type LetterAction = typeof LETTER_ACTIONS[number];
export type PigeonSend = Omit<PigeonLetter, "id" | "from">;

/** アプリが操作できる、自分の通信先の写し。 */
export interface NetSnapshot { tools: string[]; added: string[] }

/** 設定アプリの起動時に渡す写し。アプリの id は 完全な ID */
export interface OsSnapshot {
  apps?: { id: string; name: string; notify: boolean; muted: boolean; net: boolean; request: string[]; pending?: string[]; allow: string[]; added: string[]; deny: string[]; quiet: boolean }[];
  net?: { allow: string[]; deny: string[] };
  notifications?: { id: string; name: string; muted: boolean }[];
  /** ユーザー宛てに届いた手紙。新しい順。`name` は差出人のアプリ名（もう無いアプリは ID） */
  letters?: { id: number; from: string; name: string; title: string; body: string; time: number; opened: boolean }[];
  settings: Omit<SystemSettings, "roles" | "allowHttpLists">;
  /** 役割に割り当てたアプリ */
  roles: Record<string, string>;
  /** 役割ごとの選べるアプリ。割り当てを変えられる役割だけが載る */
  candidates: Record<string, { id: string; name: string }[]>;
  launches: { time: number; name: string }[];
  /** 新しい版の `/system` があるか */
  updateAvailable: boolean;
  updateState?: { phase: string; current: string; next: string; available: boolean };
}

/** アプリ管理（役割 apps-manager）に渡す写し。アプリは完全な ID で引く */
export interface ManagerSnapshot {
  repos: { url: string; name: string; host: string; removable: boolean; state: string }[];
  apps: ManagerApp[];
  /** 更新があるアプリの完全な ID */
  updates: string[];
  auto: { all: boolean; lists: Record<string, boolean>; apps: Record<string, boolean> };
  details: Record<string, ManagerDetails>;
}

/** アプリ管理に見せるアプリ 1 つ。カタログにあるもの、入っているもの、本体なし・データありのもの */
export interface ManagerApp {
  key: string;
  /** 提供リストの URL。埋め込みは空 */
  list: string;
  name: string;
  /** アイコンの URL（カタログの URL か、入っているアプリの SVG の data URL）。無ければ空 */
  icon: string;
  description: string;
  /** カタログの版。カタログに無ければ空 */
  version: string;
  /** 入っている（本体がある） */
  present: boolean;
  /** カタログが要求する ABI の不一致。空または省略なら事前の制限なし */
  compatibilityError?: string;
  /** 保存済み WASM の ABI 不一致。データを残した入れ直しを案内する */
  installedError?: string;
  /** 入っている版。版が無ければ空 */
  installed: string;
  removed: boolean;
  /** カタログに載っている */
  listed: boolean;
  removable: boolean;
  /** none・installed・update・waiting・fetching・building・saving・prepared・failed */
  state: string;
  error: string;
  files: number;
  bytes: number;
  /** 自動更新がオンとして扱われるか */
  auto: boolean;
}

/** `details` で取った内容 */
export interface ManagerDetails {
  loading: boolean;
  error: string;
  permissions: [string, string][];
  added: string[];
  roles: string[];
  integrity: boolean;
  listName: string;
}

/** 設定アプリ（役割 settings）に渡す予定の一覧（[scheduler.md](../../../docs/spec/scheduler.md#設定アプリ)） */
export interface SchedulerSnapshot {
  schedules: SchedulerEntry[];
}

/** 予定 1 つ */
export interface SchedulerEntry {
  id: string;
  /** `os` か完全なアプリ ID */
  owner: string;
  /** 持ち主の表示名。OS は「OS」 */
  ownerName: string;
  label: string;
  /** 予定の形の JSON */
  rule: string;
  enabled: boolean;
  /** 次の実行（Unix epoch ミリ秒）。無ければ 0 */
  next: number;
  /** 前回の実行。無ければ 0 と空 */
  lastTime: number;
  lastResult: string;
  running: boolean;
}

/** アプリに渡す自分の予定の写し（[scheduler.md](../../../docs/spec/scheduler.md#アプリの予定)）。枠の番号で並べ、予定の無い枠は null */
export interface ScheduleSnapshot {
  slots: (ScheduleSlot | null)[];
}

/** アプリの予定 1 つ */
export interface ScheduleSlot {
  /** 予定の形の JSON */
  rule: string;
  /** 表示名。無ければ空 */
  label: string;
  enabled: boolean;
  /** 前回の実行。無ければ 0 と空 */
  lastTime: number;
  lastResult: string;
}

/** API の辞書に載らなかった理由。権限がない（NotGranted）か、役割に割り当てられていない（NotAssigned） */
export type ApiDenial = "NotGranted" | "NotAssigned";

/** Cadre の起動中アプリ一覧の各要素 */
export interface CadreInstance {
  id: number;
  appIndex: number;
  name: string;
  front: boolean;
  hasIcon: boolean;
}

/** Cadre アプリの起動時に渡す写し */
export interface CadreSnapshot {
  notifications?: PigeonLetter[];
  instances: CadreInstance[];
  homeFront: boolean;
  installed: boolean;
  installBusy: boolean;
}

/** 辞書に入りうるキー。アプリのライブラリ（Réplique）の `Api` と同じ */
export const API_KEYS = ["apps", "os", "storage", "fs", "cadre", "pigeon", "shares", "manager", "scheduler", "schedule", "net"] as const;

/** メインスレッド側から見た Worker。ブラウザの `Worker` や、テストで使う `MessagePort` がこの形を持つ */
export interface RegieWorker {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener<K extends "message" | "error" | "messageerror">(type: K, listener: (event: K extends "error" ? ErrorEvent : MessageEvent) => void): void;
  terminate(): void;
}

/** {@link launchApp} の設定 */
export interface LaunchOptions {
  net?: boolean;
  netState?: NetSnapshot;
  onNetAllow?: (action: string, url: string) => void;
  onNetDo?: (action: string, appId: string, url: string) => void;
  onNetQuiet?: (appId: string, on: boolean) => void;
  onAppNotificationMuted?: (appId: string, muted: boolean) => void;
  onNet?: (request: import("./net.ts").NetRequest, signal: AbortSignal) => Promise<import("./net.ts").NetResponse>;
  /** 起動中の OS のビルド情報 */
  osBuild?: { ref: string; commit: string };
  /** 一回の呼び出しと起動の時間切れ（ミリ秒、既定 5000） */
  callTimeout?: number;
  /** 今のページの識別子 */
  page?: string;
  /** サブアプリの識別子。親として開いたら空文字列 */
  sub?: string;
  /** HTML を持たない宣言的 UI アプリ */
  declarative?: boolean;
  /** 前回の最後の記録 */
  last?: LifecycleRecord;
  /** アプリが自分を閉じたとき。今の呼び出しの完了後に届く */
  onFinish?: () => void;
  /** Request an external HTTPS page; the host still confirms the action. */
  onOpenUrl?: (url: string) => void;
  /** _start または一回の call で溜めた操作。完了通知より先に届く */
  onDom?: (ops: DomOp[]) => void;
  /** 辞書の `apps`。ホームと Cadre に渡すアプリ。省略時は apps.* を使えない */
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
  /** 辞書の `manager`。アプリ管理だけに渡す。省略時は manager.* を使えない */
  manager?: ManagerSnapshot;
  /** アプリ管理の操作。args は文字列と真偽値 */
  onManager?: (action: string, args: (string | boolean)[]) => void;
  /** 辞書の `scheduler`。設定アプリだけに渡す。省略時は scheduler.* を使えない */
  scheduler?: SchedulerSnapshot;
  /** 予定の操作。action は update・setEnabled・runNow */
  onScheduler?: (action: string, id: string, value: string, flag: boolean) => void;
  /** 辞書の `schedule`。`permissions` に `schedule` を書いたアプリに渡す自分の予定。省略時は schedule.* を使えない */
  schedule?: ScheduleSnapshot;
  /** 自分の予定の操作。action は register・update・remove・runNow */
  onSchedule?: (action: string, slot: number, rule: string, label: string) => void;
  /** 辞書の `storage`。アプリごとのデータの写し。省略時は storage.* を使えない */
  storage?: Map<string, string>;
  /** データの書き込み。value が null なら削除 */
  onStorage?: (name: string, value: string | null) => void;
  /** 辞書の `cadre`。Cadre アプリだけに渡す。省略時は cadre.* を使えない */
  cadre?: CadreSnapshot;
  onCadreOpen?: (i: number) => void;
  onCadreClose?: (i: number) => void;
  onCadreBack?: () => void;
  onCadreHome?: () => void;
  /** Cadre が設定アプリを開くよう頼んだとき */
  onCadreSettings?: () => void;
  onCadreNotify?: (text: string) => void;
  onCadreInstall?: () => void;
  shares?: boolean;
  onShare?: (operation: string, args: string[]) => Promise<unknown>;
  pigeon?: PigeonSnapshot;
  onPigeonSend?: (letter: PigeonSend) => void;
  onPigeonDone?: (id: number) => void;
  /** The app says the cause of its letters to the user is settled. An empty kind means all of its letters. */
  onPigeonOpened?: (kind: string) => void;
  /** Settings acts on the history of letters to the user. `id` is ignored by openAll and deleteAll. */
  onLetter?: (action: LetterAction, id: number) => void;
  onNotificationMuted?: (i: number, muted: boolean) => void;
  onNotificationOpen?: (id: number) => void;
  onNotificationDismiss?: (id: number) => void;
  onNotificationReply?: (id: number, action: string, body: string) => void;
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
  /** call と同じだが、時間切れを timeout（ミリ秒）にする。過ぎたら `時間切れ` でアプリを終了する */
  callWithin(timeout: number, name: string, ...args: (number | string)[]): Promise<void>;
  /** Cadre の状態（起動中アプリ一覧や前面）の更新を Worker に知らせる */
  syncCadre?(snapshot: CadreSnapshot): void;
  syncOs?(snapshot: OsSnapshot): void;
  syncNet?(snapshot: NetSnapshot): void;
  syncPigeon?(snapshot: PigeonSnapshot): void;
  syncManager?(snapshot: ManagerSnapshot): void;
  syncScheduler?(snapshot: SchedulerSnapshot): void;
  syncSchedule?(snapshot: ScheduleSnapshot): void;
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
  const netRequests = new Map<number, AbortController>();
  // この Worker の net.allow をカーネルが処理したところまで、写しと一緒に返す。
  let netAcknowledged = 0;
  let rejectLaunch: ((error: Error) => void) | undefined;

  const finish = (error: Error, notify: boolean) => {
    if (stopped) return;
    stopped = true;
    for (const controller of netRequests.values()) controller.abort();
    netRequests.clear();
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
  const send = (limit: number, onTimeout: () => void, name: string, args: (number | string)[]) => {
    if (stopped) return Promise.reject(new Error("アプリは止まっています。"));
    return new Promise<void>((resolveCall, rejectCall) => {
      const id = nextId++;
      const timer = setTimeout(onTimeout, limit);
      pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
      try { worker.postMessage({ type: "call", id, name, args }); }
      catch (error) { exit(error instanceof Error ? error : new Error(String(error))); }
    });
  };
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
      const data = event.data as { type: string; exit?: boolean; id?: number; message?: string; code?: BinetteError["code"]; exports?: string[]; ops?: DomOp[]; i?: number; name?: string; value?: number | string | null; role?: string; text?: string; letter?: PigeonSend; muted?: boolean; action?: string; kind?: string; body?: string; operation?: string; args?: string[]; url?: string; appId?: string; on?: boolean; seq?: number };
      switch (data.type) {
        case "ready": {
          clearTimeout(initTimer);
          rejectLaunch = undefined;
          const exports = Object.freeze([...data.exports!]);
          resolve({
            exports,
            call(name, ...args) { return send(timeout, expired, name, args); },
            callWithin(limit, name, ...args) { return send(limit, () => exit(new Error("時間切れ")), name, args); },
            syncPigeon(snapshot) {
              if (stopped) return;
              const id = nextId++;
              pending.set(id, { resolve: () => {}, reject: () => {}, timer: setTimeout(expired, timeout) });
              try { worker.postMessage({ type: "pigeon.sync", id, pigeon: snapshot }); }
              catch (error) { exit(error instanceof Error ? error : new Error(String(error))); }
            },
            syncNet(snapshot) {
              if (stopped) return;
              try { worker.postMessage({ type: "net.sync", netState: snapshot, netAck: netAcknowledged }); }
              catch (error) { exit(error instanceof Error ? error : new Error(String(error))); }
            },
            syncOs(snapshot) {
              if (stopped) return;
              const id = nextId++;
              pending.set(id, { resolve: () => {}, reject: () => {}, timer: setTimeout(expired, timeout) });
              try { worker.postMessage({ type: "os.sync", id, os: snapshot }); }
              catch (error) { exit(error instanceof Error ? error : new Error(String(error))); }
            },
            syncManager(snapshot) {
              if (stopped) return;
              const id = nextId++;
              pending.set(id, { resolve: () => {}, reject: () => {}, timer: setTimeout(expired, timeout) });
              try { worker.postMessage({ type: "manager.sync", id, manager: snapshot }); }
              catch (error) { exit(error instanceof Error ? error : new Error(String(error))); }
            },
            syncScheduler(snapshot) {
              if (stopped) return;
              const id = nextId++;
              pending.set(id, { resolve: () => {}, reject: () => {}, timer: setTimeout(expired, timeout) });
              try { worker.postMessage({ type: "scheduler.sync", id, scheduler: snapshot }); }
              catch (error) { exit(error instanceof Error ? error : new Error(String(error))); }
            },
            syncSchedule(snapshot) {
              if (stopped) return;
              const id = nextId++;
              pending.set(id, { resolve: () => {}, reject: () => {}, timer: setTimeout(expired, timeout) });
              try { worker.postMessage({ type: "schedule.sync", id, schedule: snapshot }); }
              catch (error) { exit(error instanceof Error ? error : new Error(String(error))); }
            },
            syncCadre(snapshot) {
              if (stopped) return;
              // 描き直しで固まったときも、ほかの呼び出しと同じ時間切れで終了させる
              const id = nextId++;
              pending.set(id, { resolve: () => {}, reject: () => {}, timer: setTimeout(expired, timeout) });
              try { worker.postMessage({ type: "cadre.sync", id, cadre: snapshot }); }
              catch (error) { exit(error instanceof Error ? error : new Error(String(error))); }
            },
            stop,
          });
          notifyRequests();
          break;
        }
        case "failed": {
          const error = data.code === "unsupported_abi" || data.code === "invalid_format"
            ? new BinetteError(data.code, data.message ?? "") : new Error(data.message);
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
        case "manager.do": options.onManager?.(data.action!, (data as { managerArgs?: (string | boolean)[] }).managerArgs ?? []); break;
        case "scheduler.do": { const args = (data as { schedulerArgs?: [string, string, boolean] }).schedulerArgs ?? ["", "", false]; options.onScheduler?.(data.action!, args[0], args[1], args[2]); break; }
        case "schedule.do": { const args = (data as { scheduleArgs?: [number, string, string] }).scheduleArgs ?? [-1, "", ""]; options.onSchedule?.(data.action!, args[0], args[1], args[2]); break; }
        case "storage.write": options.onStorage?.(data.name!, data.value as string | null); break;
        case "net.allow":
          if (options.net) {
            if (Number.isSafeInteger(data.seq) && data.seq! > netAcknowledged) netAcknowledged = data.seq!;
            options.onNetAllow?.(data.action!, data.url!);
          }
          break;
        case "os.netDo": if (options.os) options.onNetDo?.(data.action!, data.appId!, data.url!); break;
        case "os.netQuiet": if (options.os) options.onNetQuiet?.(data.appId!, data.on!); break;
        case "os.appNotificationMuted": if (options.os) options.onAppNotificationMuted?.(data.appId!, data.muted!); break;
        case "net.request": {
          const message = data as typeof data & { request: import("./net.ts").NetRequest };
          if (!options.net || !options.onNet || !Number.isInteger(data.id) || netRequests.has(data.id!)) break;
          const controller = new AbortController();
          netRequests.set(data.id!, controller);
          options.onNet(message.request, controller.signal).then(result => {
            if (!stopped && netRequests.get(data.id!) === controller) { const reply = controller.signal.aborted ? { status: 0, statusText: "", url: "", type: "error", headers: [], body: new Uint8Array(0), reason: "aborted" } : result; worker.postMessage({ type: "net.result", id: data.id, result: reply }, [reply.body.buffer]); }
          }).catch(() => {
            if (!stopped && netRequests.get(data.id!) === controller) worker.postMessage({ type: "net.result", id: data.id, result: { status: 0, statusText: "", url: "", type: "error", headers: [], body: new Uint8Array(0), reason: controller.signal.aborted ? "aborted" : "network" } });
          }).finally(() => netRequests.delete(data.id!));
          break;
        }
        case "net.abort": netRequests.get(data.id!)?.abort(); break;
        case "shares.request": {
          const reply = (result: unknown) => { if (!stopped) worker.postMessage({ type: "shares.result", id: data.id, result: JSON.stringify(result) }); };
          Promise.resolve().then(() => { if (!options.shares || !options.onShare) throw new Error("共有 API は許可されていません。"); return options.onShare(data.operation!, data.args!); }).then(value => reply({ ok: true, value: value ?? null }), error => reply({ ok: false, error: error instanceof Error ? error.message : String(error) }));
          break;
        }
        case "pigeon.send": options.onPigeonSend?.(data.letter!); break;
        case "pigeon.done": options.onPigeonDone?.(data.i!); break;
        case "pigeon.opened": options.onPigeonOpened?.(String(data.kind ?? "")); break;
        case "os.letter": if ((LETTER_ACTIONS as readonly string[]).includes(data.action!)) options.onLetter?.(data.action as LetterAction, Number(data.i)); break;
        case "os.notificationMuted": options.onNotificationMuted?.(data.i!, data.muted!); break;
        case "cadre.notificationOpen": options.onNotificationOpen?.(data.i!); break;
        case "cadre.notificationDismiss": options.onNotificationDismiss?.(data.i!); break;
        case "cadre.notificationReply": options.onNotificationReply?.(data.i!, data.action!, data.body!); break;
        case "cadre.open": options.onCadreOpen?.(data.i!); break;
        case "cadre.close": options.onCadreClose?.(data.i!); break;
        case "cadre.back": options.onCadreBack?.(); break;
        case "cadre.home": options.onCadreHome?.(); break;
        case "cadre.settings": options.onCadreSettings?.(); break;
        case "cadre.notify": options.onCadreNotify?.(data.text!); break;
        case "cadre.install": options.onCadreInstall?.(); break;
        case "app.openUrl": {
          try {
            const url = new URL(data.url!);
            if (url.protocol === "https:") options.onOpenUrl?.(url.href);
          } catch { /* Invalid URLs are ignored. */ }
          break;
        }
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
      worker.postMessage({ type: "init", net: options.net, netState: options.netState, osBuild: options.osBuild, wasm: copy, page: options.page ?? "", sub: options.sub ?? "", declarative: options.declarative, last: options.last, pigeon: options.pigeon, shares: options.shares, ...(options.apps === undefined ? {} : { apps: options.apps }), ...(options.os === undefined ? {} : { os: options.os }), ...(options.manager === undefined ? {} : { manager: options.manager }), ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }), ...(options.schedule === undefined ? {} : { schedule: options.schedule }), ...(options.storage === undefined ? {} : { storage: options.storage }), ...(options.cadre === undefined ? {} : { cadre: options.cadre }), ...(options.denied === undefined ? {} : { denied: options.denied }) }, [copy]);
    } catch (error) {
      rejectLaunch = undefined;
      stop();
      reject(error);
    }
  });
}
