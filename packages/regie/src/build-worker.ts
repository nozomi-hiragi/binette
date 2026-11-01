import { buildApp, type Compiler } from "./build.ts";

/** ブラウザと MessageChannel で共通に使う、ビルド専用 Worker の受け口。 */
export interface BuildWorkerScope {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

/** 一度のビルドを処理する。終了と中止のあとの破棄は呼び出し側が行う。 */
export function serveBuild(scope: BuildWorkerScope): void {
  let started = false;
  let nextId = 0;
  const pending = new Map<number, { resolve(value: string): void; reject(error: Error): void }>();
  scope.addEventListener("message", (event) => {
    const data = event.data;
    if (data.type === "file") {
      const request = pending.get(data.id);
      pending.delete(data.id);
      if (data.error !== undefined) request?.reject(new Error(data.error));
      else request?.resolve(data.contents);
    } else if (data.type === "build" && !started) {
      started = true;
      void (async () => {
        const url = URL.createObjectURL(new Blob([data.compiler], { type: "text/javascript" }));
        try {
          const compiler = await import(/* @vite-ignore */ url) as Compiler;
          if (typeof compiler.main !== "function" || typeof compiler.createMemoryStream !== "function") {
            throw new Error("コンパイラの ESM が不正です。");
          }
          const built = await buildApp(path => new Promise<string>((resolve, reject) => {
            const id = nextId++;
            pending.set(id, { resolve, reject });
            scope.postMessage({ type: "read", id, path });
          }), { compiler, libraries: data.libraries });
          scope.postMessage({ type: "built", built });
        } finally { URL.revokeObjectURL(url); }
      })().catch(error => scope.postMessage({ type: "failed", message: error instanceof Error ? error.message : String(error) }));
    }
  });
}
