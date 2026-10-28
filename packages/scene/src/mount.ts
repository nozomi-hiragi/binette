import { DestroyCause, DestroyKind, State, type DomOp } from "@binette/core";
import { launchApp, type LaunchOptions, type RegieApp, type SystemStore, type LifecycleRecord } from "@binette/regie";
import type { BuiltApp } from "./build.ts";

/** {@link mountApp} の設定 */
export interface MountOptions {
  /** 呼び出しと起動の時間切れ（ミリ秒、既定 5000） */
  callTimeout?: number;
  /** Pause から Stop まで（ミリ秒、既定 10000） */
  stopDelay?: number;
  /** onDestroy の時間切れ（ミリ秒、既定 5000） */
  destroyTimeout?: number;
  /** 今のページの識別子 */
  page?: string;
  /** 最後の状態と起動の履歴の保存先。key は installedAppKey */
  persistence?: { store: SystemStore; key: string; historyLimit?: number };
  /** 今の呼び出しが終わってから、自分を閉じる */
  onFinish?: () => void;
  /** アプリを終了しない呼び出しの失敗 */
  onError?: (error: unknown) => void;
  /** mountApp の完了後にアプリが終了したとき */
  onExit?: (error: Error) => void;
  /** Worker を作る関数。省略すると Régie の Blob URL の Worker */
  createWorker?: LaunchOptions["createWorker"];
  /** 起動中でもアプリを止める */
  signal?: AbortSignal;
  /** ホームだけに渡すアプリの一覧 */
  apps?: { id: string; name: string; icon?: string }[];
  /** ホームが指定した番号のアプリを開く */
  onOpen?: (i: number) => void;
  /** システムの設定アプリだけに渡す写しと変更の通知 */
  os?: LaunchOptions["os"];
  onSet?: LaunchOptions["onSet"];
  onSetHome?: LaunchOptions["onSetHome"];
}

/** 画面に出したアプリ */
export interface MountedApp {
  /** Régie で動いているアプリ */
  readonly app: RegieApp;
  readonly state: State;
  pause(): Promise<void>;
  resume(): Promise<void>;
  destroy(kind: DestroyKind, cause: DestroyCause): Promise<void>;
  /** 凍結中は Stop までの時間を数えない */
  setFrozen(frozen: boolean): void;
  /** 次の Pause から使う時間。今の Pause の計時は変えない */
  setStopDelay(delay: number): void;
  /** アプリを止め、クリックの受け付けをやめる */
  stop(): void;
}

/**
 * `element` に HTML を描き、Régie でアプリを起動して、document API の操作を反映する。
 * _start のあとに HTML を描き、Create → Start → Resume を知らせる。HTML の検証はまだしない。
 *
 * @throws {Error} アプリを起動できないとき、または状態の通知が失敗したとき
 */
export async function mountApp(element: HTMLElement, built: BuiltApp, options: MountOptions = {}): Promise<MountedApp> {
  const persistence = options.persistence;
  const last = (persistence ? await persistence.store.getLast(persistence.key) : undefined) ?? {
    state: State.None, done: true, page: "", reason: { kind: DestroyKind.User, cause: DestroyCause.Os },
  };
  let reason = last.reason;
  // アプリの領域が外に出ないようにする
  element.style.contain = "paint";

  // Régie が onError に渡したエラーを、call の失敗で二重に知らせないために覚えておく
  const reported = new WeakSet<object>();
  const report = (error: unknown) => {
    if (typeof error === "object" && error !== null) reported.add(error);
    options.onError?.(error);
  };

  const ids = new Map<number, string>();
  const created = new Map<number, HTMLElement>();
  const removers: (() => void)[] = [];
  const allowed = new Set("div span p h1 h2 h3 h4 h5 h6 button ul ol li img section header footer nav main article label strong em small br hr".split(" "));
  // CSS の文字列として引用する。制御文字もエスケープし、任意の id を安全に探す
  const escapeId = (id: string) => id.replace(/["\\\x00-\x1f\x7f]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `);
  const target = (handle: number): HTMLElement | undefined => {
    const made = created.get(handle);
    if (made) return made;
    const id = ids.get(handle);
    if (id === undefined) return undefined;
    const found = element.querySelector<HTMLElement>(`[id="${escapeId(id)}"]`);
    return found && found !== element && element.contains(found) ? found : undefined;
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
    void enqueue(async () => {
      if (closing) return;
      for (const i of homes.splice(0)) options.onSetHome?.(i);
      if (finishRequested) { finishRequested = false; openings.length = 0; options.onFinish?.(); }
      else for (const i of openings.splice(0)) options.onOpen?.(i);
    });
  };
  let mounting = true;
  let exitError: Error | undefined;
  const removeListeners = () => { for (const remove of removers.splice(0)) remove(); };
  let cleanup = removeListeners;
  const applyDom = (ops: DomOp[]) => {
    for (const op of ops) {
      if (op.op === "byId") { ids.set(op.handle, op.id); continue; }
      if (op.op === "create") {
        const tag = op.tag.toLowerCase();
        if (!allowed.has(tag)) { report(new Error(`作れないタグです: ${op.tag}`)); continue; }
        const made = element.ownerDocument.createElement(tag);
        if (tag === "button") made.setAttribute("type", "button");
        // 装飾アイコンとして使う。属性 API が入るまではすべて空の代替テキストにする
        if (tag === "img") made.setAttribute("alt", "");
        created.set(op.handle, made);
        continue;
      }
      if (op.op === "append") {
        const parent = target(op.parent), child = target(op.child);
        if (parent && child && child !== element && parent !== child && !child.contains(parent)) parent.appendChild(child);
        continue;
      }
      if (op.op === "listen" && op.type !== "click") {
        report(new Error(`使えないイベントです: ${op.type}`)); continue;
      }
      const node = target(op.handle);
      if (!node || node === element) continue;
      switch (op.op) {
        case "text": node.textContent = op.value; break;
        // SVG の className は読み取り専用なので、属性で書く
        case "class": node.setAttribute("class", op.value); break;
        case "remove": node.remove(); break;
        case "icon": {
          if (node.tagName.toLowerCase() !== "img") break;
          const icon = options.apps?.[op.app]?.icon;
          if (icon === undefined) node.removeAttribute("src");
          else node.setAttribute("src", `data:image/svg+xml;charset=utf-8,${encodeURIComponent(icon)}`);
          break;
        }
        case "listen": {
          const listener = () => {
            // 起動の途中（Create・Start）のクリックは捨てずに、Resume のあとへ回す。Pause と Stop の間は捨てる
            if (closing || state === State.Pause || state === State.Stop || state === State.Destroy) return;
            void enqueue(async () => {
              if (accepting && state === State.Resume && !closing && !finishRequested && !openings.length) await running?.call("__bina_event", op.listener);
            }).catch(reportCall);
          };
          node.addEventListener("click", listener);
          removers.push(() => node.removeEventListener("click", listener));
          break;
        }
      }
    }
  };
  let htmlReady = false;
  const initialOps: DomOp[] = [];
  const app = await launchApp(built.wasm, {
    createWorker: options.createWorker,
    signal: options.signal,
    callTimeout: options.callTimeout,
    page: options.page,
    last,
    os: options.os,
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
    ...(options.apps === undefined ? {} : { apps: options.apps.map(({ id, name }) => ({ id, name })) }),
    onOpen(i) { openings.push(i); notifyRequests(); },
    onFinish() { accepting = false; finishRequested = true; notifyRequests(); },
    onDom(ops) { if (htmlReady) applyDom(ops); else initialOps.push(...ops); },
  }).catch((error: unknown) => { removeListeners(); throw error; });

  if (exitError) { removeListeners(); app.stop(); throw exitError; }

  element.innerHTML = built.html;
  htmlReady = true;
  applyDom(initialOps);
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
    removeListeners();
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
  const mounted: MountedApp = {
    app,
    get state() { return state; },
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
  return mounted;
}
