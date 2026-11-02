import { assertEquals, assertRejects } from "@std/assert";
import { createMemoryFileTree, createSystemDistribution, type SystemManifest } from "@binette/regie";
import { browserKernels, createUpdater } from "./update.ts";

const encode = (value: string) => new TextEncoder().encode(value);
async function fixture() {
  const tree = createMemoryFileTree();
  const data = encode("旧版");
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map(n => n.toString(16).padStart(2, "0")).join("");
  let manifest: SystemManifest = { version: "old", label: "0.2.0+old", kernel: "kernel-old", files: [{ path: "system/value", size: data.length, sha256: digest }] };
  let offline = false;
  const fetcher: typeof fetch = () => {
    if (offline) return Promise.reject(new Error("オフライン"));
    return Promise.resolve(new Response(JSON.stringify(manifest)));
  };
  // 最初の固定物は検証済みの保存値を再利用する。
  await tree.replaceSystem(new Map([["/system/value", data]]));
  const distribution = createSystemDistribution(tree, { manifestUrl: "https://example.test/manifest.json", origin: "https://example.test", fetch: fetcher });
  await distribution.install(manifest);
  let activationFails = false;
  let mismatch = false;
  let activated = "";
  let reloads = 0;
  let kernelCheck = () => mismatch ? Promise.reject(new Error("待機 SW 不一致")) : Promise.resolve();
  const updater = createUpdater(distribution, {
    current: "kernel-old",
    check() { return kernelCheck(); },
    activate(kernel) {
      activated = kernel ?? "";
      return activationFails ? Promise.reject(new Error("切替失敗")) : Promise.resolve();
    },
  }, () => { reloads++; });
  await updater.boot();
  return { distribution, updater, tree, setManifest(value: SystemManifest) { manifest = value; }, next: () => ({ ...manifest, version: "new", label: "0.2.0+new" }),
    offline() { offline = true; }, activationFails() { activationFails = true; }, mismatch() { mismatch = true; },
    setKernelCheck(check: () => Promise<void>) { kernelCheck = check; }, result: () => ({ activated, reloads }) };
}

Deno.test("system の準備は現行版を維持し、明示更新で一度だけ再読み込みする", async () => {
  const f = await fixture();
  let changes = 0;
  f.updater.subscribe(() => { changes++; });
  f.setManifest(f.next());
  await f.updater.check();
  assertEquals((await f.distribution.installed())?.version, "old");
  assertEquals(f.updater.snapshot(), { phase: "ready", current: "0.2.0+old", next: "0.2.0+new", available: true });
  await Promise.all([f.updater.apply(), f.updater.apply()]);
  await f.updater.apply();
  assertEquals((await f.distribution.installed())?.version, "new");
  assertEquals(f.result(), { activated: "kernel-old", reloads: 1 });
  assertEquals(changes, 4);
});

Deno.test("kernel 単独更新も検出し、切替失敗時は旧目録を復元して再試行できる", async () => {
  const f = await fixture();
  const old = (await f.distribution.installed())!;
  f.setManifest({ ...old, kernel: "kernel-new", label: "0.2.0+kernel" });
  await f.updater.check();
  assertEquals(f.updater.snapshot().available, true);
  f.activationFails();
  await f.updater.apply();
  assertEquals(await f.distribution.installed(), old);
  assertEquals(f.updater.snapshot().phase, "apply-failed");
  assertEquals(f.result().reloads, 0);
});

Deno.test("SW の印不一致はダウンロード失敗、オフラインは確認失敗になり現行版を保つ", async () => {
  for (const failure of ["mismatch", "offline"] as const) {
    const f = await fixture();
    const old = await f.distribution.installed();
    f.setManifest(f.next());
    f[failure]();
    await f.updater.check();
    assertEquals(f.updater.snapshot().phase, failure === "mismatch" ? "download-failed" : "check-failed");
    assertEquals(await f.distribution.installed(), old);
    await f.updater.apply();
    assertEquals(f.result().reloads, 0);
  }
});

Deno.test("起動時の kernel 不一致は一致するシステムがなければ起動を拒む", async () => {
  const f = await fixture();
  const updater = createUpdater(f.distribution, { current: "wrong", check: () => Promise.resolve(), activate: () => Promise.resolve() }, () => {});
  await assertRejects(() => updater.boot(), Error, "実行中のカーネル");
});

Deno.test("開発時（カーネルの印なし）は kernel 付きの目録でも起動する", async () => {
  const f = await fixture();
  const updater = createUpdater(f.distribution, { current: undefined, check: () => Promise.resolve(), activate: () => Promise.resolve() }, () => {});
  await updater.boot();
  assertEquals(updater.snapshot().current, "0.2.0+old");
});

Deno.test("label/kernel のない旧目録を読み、検証済み staging を切替できる", async () => {
  const f = await fixture();
  const old = (await f.distribution.installed())!;
  const legacy = { version: "legacy", files: old.files };
  const stage = await f.distribution.prepare(legacy);
  assertEquals((await f.distribution.installed())?.version, "old");
  await stage.commit();
  assertEquals(await f.distribution.installed(), legacy);
});

Deno.test("起動時に kernel が異なる保存済み system を実行中の組へ戻す", async () => {
  const f = await fixture();
  const old = (await f.distribution.installed())!;
  await f.distribution.install({ ...old, kernel: "wrong", version: "wrong" });
  await f.updater.boot();
  assertEquals(await f.distribution.installed(), old);
});

Deno.test("system 保存の失敗は現行版と再読み込み回数を変えない", async () => {
  const f = await fixture();
  const old = await f.distribution.installed();
  f.setManifest(f.next());
  await f.updater.check();
  const replace = f.tree.replaceSystem;
  let writes = 0;
  f.tree.replaceSystem = files => ++writes === 1 ? Promise.reject(new Error("保存失敗")) : replace(files);
  await f.updater.apply();
  assertEquals(await f.distribution.installed(), old);
  assertEquals(f.updater.snapshot().phase, "apply-failed");
  assertEquals(f.result().reloads, 0);
});

Deno.test("確認は8秒で失敗し、後から取得が終わっても準備完了へ戻らない", async () => {
  const f = await fixture();
  const check = f.distribution.checkUpdate;
  const prepare = f.distribution.prepare;
  let preparations = 0;
  f.distribution.prepare = manifest => {
    preparations++;
    return prepare(manifest);
  };
  let complete: ((value: Awaited<ReturnType<typeof f.distribution.checkUpdate>>) => void) | undefined;
  f.distribution.checkUpdate = () => new Promise(resolve => { complete = resolve; });
  const started = performance.now();
  await f.updater.check();
  assertEquals(f.updater.snapshot().phase, "check-failed");
  assertEquals(performance.now() - started >= 7900, true);
  f.distribution.checkUpdate = check;
  const retry = { ...f.next(), version: "retry", label: "0.2.0+retry" };
  f.setManifest(retry);
  await f.updater.check();
  assertEquals(f.updater.snapshot().next, retry.label);
  complete!({ manifest: f.next(), updateAvailable: true, installedVersion: "old" });
  await new Promise(resolve => setTimeout(resolve, 10));
  assertEquals(f.updater.snapshot(), { phase: "ready", current: "0.2.0+old", next: retry.label, available: true });
  assertEquals(preparations, 1);
  assertEquals((await f.distribution.installed())?.version, "old");
});

Deno.test("8秒を超える固定物とカーネルの先取りはダウンロード中を保ち、両方の完了後だけ更新できる", async () => {
  const f = await fixture();
  f.setManifest(f.next());
  const prepare = f.distribution.prepare;
  const began = Promise.withResolvers<void>();
  const files = Promise.withResolvers<void>();
  const kernel = Promise.withResolvers<void>();
  let preparations = 0;
  let checks = 0;
  f.distribution.prepare = async manifest => {
    preparations++;
    began.resolve();
    await files.promise;
    return await prepare(manifest);
  };
  f.setKernelCheck(() => {
    checks++;
    return kernel.promise;
  });
  const phases: string[] = [];
  f.updater.subscribe(() => { phases.push(f.updater.snapshot().phase); });
  const started = performance.now();
  const pending = f.updater.check();
  assertEquals(f.updater.check(), pending);
  await began.promise;
  await new Promise(resolve => setTimeout(resolve, 8100));
  assertEquals(performance.now() - started >= 8000, true);
  assertEquals(f.updater.snapshot(), { phase: "downloading", current: "0.2.0+old", next: "0.2.0+new", available: false });
  assertEquals(f.updater.check(), pending);
  await f.updater.apply();
  assertEquals(f.result().reloads, 0);
  files.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  assertEquals(f.updater.snapshot().phase, "downloading");
  kernel.resolve();
  await pending;
  assertEquals(f.updater.snapshot().phase, "ready");
  assertEquals(phases, ["checking", "downloading", "ready"]);
  assertEquals(preparations, 1);
  assertEquals(checks, 1);
  assertEquals((await f.distribution.installed())?.version, "old");
  await f.updater.apply();
  assertEquals(f.result().reloads, 1);
});

Deno.test("先取り失敗は再試行でき、失敗した試行の遅い完了は新しい準備を変えない", async () => {
  for (const failure of ["files", "kernel"]) {
    const f = await fixture();
    const prepare = f.distribution.prepare;
    const late = Promise.withResolvers<void>();
    f.setManifest(f.next());
    f.distribution.prepare = async manifest => {
      if (failure === "files") throw new Error("固定物の取得失敗");
      await late.promise;
      return await prepare(manifest);
    };
    f.setKernelCheck(() => failure === "kernel" ? Promise.reject(new Error("SW の取得失敗")) : late.promise);
    await f.updater.check();
    assertEquals(f.updater.snapshot(), { phase: "download-failed", current: "0.2.0+old", next: "0.2.0+new", available: false });
    await f.updater.apply();
    assertEquals(f.result().reloads, 0);
    f.distribution.prepare = prepare;
    f.setKernelCheck(() => Promise.resolve());
    const retry = { ...f.next(), version: "retry", label: "0.2.0+retry" };
    f.setManifest(retry);
    await f.updater.check();
    late.resolve();
    await new Promise(resolve => setTimeout(resolve, 10));
    assertEquals(f.updater.snapshot(), { phase: "ready", current: "0.2.0+old", next: retry.label, available: true });
    await f.updater.apply();
    assertEquals((await f.distribution.installed())?.version, "retry");
  }
});

Deno.test("保存済み system のオフライン起動を維持する", async () => {
  const f = await fixture();
  f.offline();
  await f.updater.boot();
  assertEquals(f.updater.snapshot().current, "0.2.0+old");
  assertEquals((await f.distribution.installed())?.version, "old");
});

Deno.test("通知からの確認連打をまとめ、再確認直後に旧 staging を適用しない", async () => {
  const f = await fixture();
  f.setManifest(f.next());
  let requests = 0;
  const check = f.distribution.checkUpdate;
  f.distribution.checkUpdate = online => {
    requests++;
    return check(online);
  };
  const unsubscribe = f.updater.subscribe(() => {
    if (f.updater.snapshot().phase === "checking") void f.updater.check();
  });
  await f.updater.check();
  unsubscribe();
  assertEquals(requests, 1);
  f.offline();
  const pending = f.updater.check();
  await f.updater.apply();
  await pending;
  assertEquals(f.result().reloads, 0);
  assertEquals((await f.distribution.installed())?.version, "old");
});

Deno.test("登録直後は SW の準備を待ち、準備後の照合はネットワークを必要としない", async () => {
  const waiting = {
    postMessage(_message: unknown, transfer: Transferable[]) {
      const port = transfer[0] as MessagePort;
      port.postMessage({ kernel: "kernel-new" }); port.close();
    },
  } as unknown as ServiceWorker;
  let requests = 0;
  const registration = {
    waiting: null as ServiceWorker | null, installing: null,
    update() { requests++; this.waiting = waiting; return Promise.resolve(); },
  };
  const kernels = browserKernels(registration as unknown as ServiceWorkerRegistration, "kernel-old");
  await kernels.check("kernel-new");
  assertEquals(requests, 1);
  await kernels.check("kernel-new");
  assertEquals(requests, 1);
  await assertRejects(() => kernels.check("kernel-other"), Error, "目録の印が一致しません");
});
