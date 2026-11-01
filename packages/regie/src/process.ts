import { DestroyCause, DestroyKind, State, type DomOp } from "@binette/core";
import { launchApp, type LaunchOptions, type RegieApp } from "./launch.ts";
import type { SystemStore, LifecycleRecord } from "./store.ts";

/** {@link startProcess} の設定 */
export interface ProcessOptions {
  /** 呼び出しと起動の時間切れ（ミリ秒、既定 5000） */
  callTimeout?: number;
  /** Pause から Stop まで（ミリ秒、既定 10000） */
  stopDelay?: number;
  /** onDestroy の時間切れ（ミリ秒、既定 5000） */
  destroyTimeout?: number;
  /** 今のページの識別子 */
  page?: string;
  /** HTML を持たない宣言的 UI アプリ */
  declarative?: boolean;
  /** 最後の状態と起動の履歴の保存先。key は installedAppKey */
  persistence?: { store: SystemStore; key: string; historyLimit?: number };
  /** 今の呼び出しが終わってから、自分を閉じる */
  onFinish?: () => void;
  /** アプリを終了しない呼び出しの失敗 */
  onError?: (error: unknown) => void;
  /** startProcess の完了後にアプリが終了したとき */
  onExit?: (error: Error) => void;
  /** Worker を作る関数。省略すると Régie の独立した module Worker */
  createWorker?: LaunchOptions["createWorker"];
  /** module Worker の URL。createWorker があればそちらを優先する */
  workerUrl?: LaunchOptions["workerUrl"];
  /** 起動中でもアプリを止める */
  signal?: AbortSignal;
  /** アプリに渡す呼び出し */
  grants?: { apps?: { id: string; name: string; icon?: string }[]; os?: LaunchOptions["os"] };
  /** ホームが指定した番号のアプリを開く */
  onOpen?: (i: number) => void;
  onSet?: LaunchOptions["onSet"];
  onSetHome?: LaunchOptions["onSetHome"];
}

/** 状態を進めるアプリ */
export interface Process {
  /** Régie で動いているアプリ */
  readonly app: RegieApp;
  readonly state: State;
  /** DOM 操作の受け先をつなぎ、溜まった操作を先に渡す */
  attach(sink: (ops: DomOp[]) => void): void;
  /** Create → Start(Create) → Resume を知らせる */
  begin(): Promise<void>;
  /** イベントを届けるか判断する */
  dispatch(listener: number): void;
  /** 宣言的 UI の要素ハンドルでイベントを届ける */
  dispatchUi(handle: number): void;
  dispatchUiText(handle: number, value: string, version?: number): void;
  /** 値を返す部品（checkbox・radio・slider・picker・segmented・tabs）の操作を届ける。捨てるときも版を知らせ、表示をアプリの値に戻す */
  dispatchUiValue(handle: number, value: number, version?: number): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  destroy(kind: DestroyKind, cause: DestroyCause): Promise<void>;
  /** 凍結中は Stop までの時間を数えない */
  setFrozen(frozen: boolean): void;
  /** 次の Pause から使う時間。今の Pause の計時は変えない */
  setStopDelay(delay: number): void;
  /** 状態を知らせずに Worker を止める */
  stop(): void;
}

/** _start まで起動し、画面の接続と begin を待つ。DOM には触らない */
export async function startProcess(wasm: Uint8Array | ArrayBuffer, options: ProcessOptions = {}): Promise<Process> {
  const persistence = options.persistence;
  const last = (persistence ? await persistence.store.getLast(persistence.key) : undefined) ?? {
    state: State.None, done: true, page: "", reason: { kind: DestroyKind.User, cause: DestroyCause.Os },
  };
  let reason = last.reason;

  // Régie が onError に渡したエラーを、call の失敗で二重に知らせないために覚えておく
  const reported = new WeakSet<object>();
  const report = (error: unknown) => {
    if (typeof error === "object" && error !== null) reported.add(error);
    options.onError?.(error);
  };

  let running: RegieApp | undefined;
  let state = State.None;
  let alive = true;
  let accepting = false;
  let closing = false;
  let destroying = false;
  let frozen = false;
  let finishRequested = false;
  const openings: number[] = [];
  const homes: number[] = [];
  let queue = Promise.resolve();
  const enqueue = (action: () => Promise<void>): Promise<void> => {
    const result = queue.then(async () => { if (alive) await action(); });
    queue = result.catch(() => {});
    return result;
  };
  const reportCall = (error: unknown) => {
    if (alive && !destroying && (typeof error !== "object" || error === null || !reported.has(error))) report(error);
  };
  const notifyRequests = () => {
    if (mounting || closing || !alive) return;
    // deno-lint-ignore require-await -- キューが待つ Promise と、通知中の例外を拒否で返す契約を保つ。
    void enqueue(async () => {
      if (closing) return;
      for (const i of homes.splice(0)) options.onSetHome?.(i);
      if (finishRequested) { finishRequested = false; openings.length = 0; options.onFinish?.(); }
      else for (const i of openings.splice(0)) options.onOpen?.(i);
    });
  };
  let mounting = true;
  let exitError: Error | undefined;
  let cleanup = () => {};
  let sink: ((ops: DomOp[]) => void) | undefined;
  const initialOps: DomOp[] = [];
  const app = await launchApp(wasm, {
    createWorker: options.createWorker,
    workerUrl: options.workerUrl,
    signal: options.signal,
    callTimeout: options.callTimeout,
    page: options.page,
    declarative: options.declarative,
    last,
    os: options.grants?.os,
    onSet: options.onSet,
    onSetHome(i) { homes.push(i); notifyRequests(); },
    onError: error => { if (!destroying) report(error); },
    onExit(error) {
      if (destroying) return;
      exitError = error;
      reported.add(error);
      cleanup();
      if (!mounting) options.onExit?.(error);
    },
    ...(options.grants?.apps === undefined ? {} : { apps: options.grants?.apps.map(({ id, name }) => ({ id, name })) }),
    onOpen(i) { openings.push(i); notifyRequests(); },
    onFinish() { accepting = false; finishRequested = true; notifyRequests(); },
    onDom(ops) { if (sink) sink(ops); else initialOps.push(...ops); },
  });

  if (exitError) { app.stop(); throw exitError; }

  running = app;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let destroyTimer: ReturnType<typeof setTimeout> | undefined;
  let stopDelay = options.stopDelay ?? 10000;
  let remaining = stopDelay;
  let countingSince: number | undefined;
  const cancelTimer = () => {
    clearTimeout(stopTimer);
    if (countingSince !== undefined) remaining = Math.max(0, remaining - (performance.now() - countingSince));
    countingSince = undefined;
  };
  const stop = () => {
    alive = false;
    accepting = false;
    cancelTimer();
    clearTimeout(destroyTimer);
    options.signal?.removeEventListener("abort", stop);
    running = undefined;
    app.stop();
  };
  cleanup = stop;
  options.signal?.addEventListener("abort", stop, { once: true });
  if (options.signal?.aborted) {
    stop();
    throw new Error("アプリを止めました。");
  }

  const lifecycle = async (next: State, a = 0, b = 0) => {
    state = next;
    if (next === State.Destroy) reason = { kind: a, cause: b };
    const record: LifecycleRecord = { state: next, done: false, page: options.page ?? "", reason };
    try {
      if (persistence) {
        if (next === State.Create) await persistence.store.recordLaunch({ time: Date.now(), app: persistence.key }, persistence.historyLimit);
        if (!alive) return;
        await persistence.store.putLast(persistence.key, record);
      }
      if (!alive) return;
      await app.call("__bina_lifecycle", next, a, b);
      if (alive && persistence) await persistence.store.putLast(persistence.key, { ...record, done: true });
    } catch (error) {
      if (alive && !destroying) {
        exitError = error instanceof Error ? error : new Error(String(error));
        cleanup();
        if (!mounting) options.onExit?.(exitError);
      }
      throw error;
    }
  };
  const stopState = async () => {
    cancelTimer();
    if (state === State.Pause) await lifecycle(State.Stop);
  };
  const armTimer = () => {
    if (!alive || closing || frozen || state !== State.Pause) return;
    countingSince = performance.now();
    stopTimer = setTimeout(() => {
      countingSince = undefined;
      remaining = 0;
      void enqueue(stopState).catch(reportCall);
    }, remaining);
  };
  const pauseState = async () => {
    if (state !== State.Resume && state !== State.Start && state !== State.Create) return;
    remaining = stopDelay;
    const paused = lifecycle(State.Pause);
    armTimer();
    await paused;
  };
  let destruction: Promise<void> | undefined;
  const process: Process = {
    app,
    get state() { return state; },
    attach(receiver) {
      sink = receiver;
      receiver(initialOps.splice(0));
    },
    dispatch(listener) {
      // 起動の途中のイベントは Resume のあとへ回す。Pause と Stop の間は捨てる
      if (closing || state === State.Pause || state === State.Stop || state === State.Destroy) return;
      void enqueue(async () => {
        if (accepting && state === State.Resume && !closing && !finishRequested && !openings.length) await running?.call("__bina_event", listener);
      }).catch(reportCall);
    },
    dispatchUiText(handle, value, version = 0) {
      // 捨てる入力も版だけは Worker に知らせ、Scene の表示をアプリの値に戻す
      const acknowledge = () => running?.call("__bina_ui_text_ack", handle, version);
      if (closing || state === State.Stop || state === State.Destroy) return;
      void enqueue(async () => {
        if (accepting && state === State.Resume && !closing && !finishRequested && !openings.length) await running?.call("__bina_ui_text_handle", handle, value, version);
        else if (!closing && state !== State.Stop && state !== State.Destroy) await acknowledge();
      }).catch(reportCall);
    },
    dispatchUiValue(handle, value, version = 0) {
      const acknowledge = () => running?.call("__bina_ui_value_ack", handle, version);
      if (closing || state === State.Stop || state === State.Destroy) return;
      void enqueue(async () => {
        if (accepting && state === State.Resume && !closing && !finishRequested && !openings.length) await running?.call("__bina_ui_value_handle", handle, value, version);
        else if (!closing && state !== State.Stop && state !== State.Destroy) await acknowledge();
      }).catch(reportCall);
    },
    dispatchUi(handle) {
      if (closing || state === State.Pause || state === State.Stop || state === State.Destroy) return;
      void enqueue(async () => {
        if (accepting && state === State.Resume && !closing && !finishRequested && !openings.length) await running?.call("__bina_ui_handle", handle);
      }).catch(reportCall);
    },
    async begin() {
      try {
        await enqueue(async () => {
          await lifecycle(State.Create, last.state, Number(last.done));
          if (finishRequested) return;
          await lifecycle(State.Start, State.Create);
          if (finishRequested) return;
          await lifecycle(State.Resume);
          accepting = true;
        });
      } catch (error) { stop(); throw error; }
      if (exitError) { stop(); throw exitError; }
      mounting = false;
      notifyRequests();
    },
    pause() {
      accepting = false;
      return enqueue(pauseState);
    },
    resume() {
      return enqueue(async () => {
        if (closing) return;
        cancelTimer();
        if (state === State.Stop) await lifecycle(State.Start, State.Stop);
        // onStart の中で finish したら、Resume に進まずに閉じる
        if (finishRequested) return;
        if (state === State.Pause || state === State.Start) await lifecycle(State.Resume);
        accepting = state === State.Resume;
      });
    },
    destroy(kind, cause) {
      if (destruction) return destruction;
      closing = true;
      accepting = false;
      cancelTimer();
      destruction = enqueue(async () => {
        await pauseState();
        await stopState();
        if (!alive) return;
        destroying = true;
        destroyTimer = setTimeout(stop, options.destroyTimeout ?? 5000);
        try { await lifecycle(State.Destroy, kind, cause); }
        catch { /* Destroy 中の終了は、ページごと切られたのと同じ扱い */ }
        finally { stop(); }
      });
      return destruction;
    },
    setFrozen(value) {
      if (frozen === value) return;
      frozen = value;
      if (frozen) cancelTimer();
      else armTimer();
    },
    setStopDelay(delay) { stopDelay = delay; },
    stop,
  };
  return process;
}
