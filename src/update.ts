import type { SystemDistribution, SystemManifest } from "@binette/regie";

export interface UpdateState {
  phase: string;
  current: string;
  next: string;
  available: boolean;
}
export interface KernelUpdates {
  current: string | undefined;
  check(kernel: string | undefined): Promise<void>;
  activate(kernel: string | undefined): Promise<void>;
}

/** 時間切れ後に返った結果で状態や準備済みデータを書き換えない。 */
export function createUpdater(distribution: SystemDistribution, kernels: KernelUpdates, reload: () => void) {
  let state: UpdateState = { phase: "idle", current: "", next: "", available: false };
  let prepared: { commit(): Promise<void> } | undefined;
  let target: SystemManifest | undefined;
  let checking: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const emit = (change: Partial<UpdateState>) => { state = { ...state, ...change }; for (const listener of listeners) listener(); };
  return {
    snapshot: () => ({ ...state }),
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async boot() {
      // 起動前のオンライン同版照合と、オフライン時の保存物検証も維持する。
      const found = await distribution.checkUpdate();
      let installed = await distribution.installed();
      // 開発時は入口にカーネルの印が無いので、組の照合をしない
      const paired = (kernel: string | undefined) => kernels.current === undefined || kernel === undefined || kernel === kernels.current;
      if (!installed || !paired(installed.kernel)) {
        if (!paired(found.manifest.kernel)) {
          throw new Error("実行中のカーネルと組になるシステムを取得できません。");
        }
        await distribution.install(found.manifest);
        installed = found.manifest;
      }
      emit({ current: installed.label ?? installed.version });
    },
    check(): Promise<void> {
      if (checking) return checking;
      if (state.phase === "applying") return Promise.resolve();
      // 通知から再入されても、確認と先取りは一度だけ開始する。
      checking = Promise.resolve().then(async () => {
        emit({ phase: "checking", next: "", available: false });
        prepared = undefined;
        target = undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          // 時間制限は目録の取得と比較だけに掛ける。遅れて返る目録は使わない。
          const update = await Promise.race([
            distribution.checkUpdate(true),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("確認に失敗: 時間切れ")), 8000);
            }),
          ]);
          clearTimeout(timer);
          if (!update.updateAvailable) {
            emit({ phase: "latest" });
            return;
          }
          target = update.manifest;
          emit({ phase: "downloading", next: target.label ?? target.version });
          // 固定物と SW の先取りは、低速回線でも確認の8秒制限で止めない。
          const [stage] = await Promise.all([
            distribution.prepare(target),
            kernels.check(target.kernel),
          ]);
          prepared = stage;
          emit({ phase: "ready", available: true });
        } catch (error) {
          console.warn(error);
          emit({
            phase: state.phase === "downloading" ? "download-failed" : "check-failed",
            available: false,
          });
        } finally {
          clearTimeout(timer);
          checking = undefined;
        }
      });
      return checking;
    },
    async apply() {
      if (checking || !prepared || !target || !["ready", "apply-failed"].includes(state.phase)) return;
      const stage = prepared;
      const manifest = target;
      emit({ phase: "applying", available: false });
      let rollback: { commit(): Promise<void> } | undefined;
      let committed = false;
      try {
        const previous = await distribution.installed();
        if (!previous) throw new Error("保存済みの版がありません。");
        // ロールバックにもネットワークを使わない。
        rollback = await distribution.prepare(previous);
        await kernels.check(manifest.kernel);
        await stage.commit();
        committed = true;
        await kernels.activate(manifest.kernel);
        reload();
      } catch (error) {
        emit({ phase: "apply-failed", available: true });
        if (committed && rollback) try { await rollback.commit(); }
        catch (rollbackError) {
          emit({ available: false });
          throw new AggregateError([error, rollbackError], "更新と旧版への復元に失敗しました。復旧画面を開いてください。");
        }
        console.error(error);
      }
    },
  };
}

/** 応答は送信先 SW の MessagePort だけから受け取る。 */
export function kernelIdentity(worker: ServiceWorker): Promise<string> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const finish = () => { clearTimeout(timer); channel.port1.close(); };
    const timer = setTimeout(() => { finish(); reject(new Error("カーネルの確認が時間切れです。")); }, 1500);
    channel.port1.onmessage = event => {
      finish();
      if (typeof event.data?.kernel === "string") resolve(event.data.kernel);
      else reject(new Error("カーネルの印が不正です。"));
    };
    worker.postMessage({ type: "binette.identity" }, [channel.port2]);
  });
}

export function browserKernels(registration: ServiceWorkerRegistration, current: string | undefined): KernelUpdates {
  const candidate = async (kernel: string | undefined) => {
    if (!kernel || kernel === current) return undefined;
    const ready = registration.waiting;
    if (ready && await kernelIdentity(ready) === kernel) return ready;
    // update() と install 完了の両方を待つ。先取りは低速回線でも待ち続ける。
    await registration.update();
    const installing = registration.installing;
    if (installing) await new Promise<void>((resolve, reject) => {
      const changed = () => {
        if (installing.state === "installed") { installing.removeEventListener("statechange", changed); resolve(); }
        else if (installing.state === "redundant") { installing.removeEventListener("statechange", changed); reject(new Error("カーネルの準備に失敗しました。")); }
      };
      installing.addEventListener("statechange", changed); changed();
    });
    const waiting = registration.waiting;
    if (!waiting || await kernelIdentity(waiting) !== kernel) throw new Error("待機中のカーネルと目録の印が一致しません。");
    return waiting;
  };
  return {
    current,
    async check(kernel) { await candidate(kernel); },
    async activate(kernel) {
      const waiting = await candidate(kernel);
      if (!waiting) return;
      await new Promise<void>((resolve, reject) => {
        const finish = () => { clearTimeout(timer); navigator.serviceWorker.removeEventListener("controllerchange", changed); };
        const changed = () => {
          if (navigator.serviceWorker.controller !== waiting) return;
          finish(); resolve();
        };
        const timer = setTimeout(() => { finish(); reject(new Error("カーネルの切替が時間切れです。")); }, 8000);
        navigator.serviceWorker.addEventListener("controllerchange", changed);
        waiting.postMessage({ type: "binette.activate", kernel });
      });
    },
  };
}
