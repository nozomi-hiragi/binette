import { type ProcessOptions, startProcess } from "@binette/regie";
import { mountApp, type MountOptions } from "../src/index.ts";
import type { BuiltApp } from "@binette/regie/build";

/** Process の起動と Scene の接続をまとめる、結合テスト用の準備。 */
export async function mountStartedApp(element: HTMLElement, built: BuiltApp, options: ProcessOptions & MountOptions = {}) {
  let mounted: ReturnType<typeof mountApp> | undefined;
  const process = await startProcess(built.wasm, {
    ...options,
    grants: options.grants ?? (options.apps ? { apps: options.apps } : undefined),
    onExit(error) { mounted?.stop(); options.onExit?.(error); },
  });
  try {
    mounted = mountApp(element, built.html, process, options);
    await process.begin();
    return {
      ...process,
      get state() { return process.state; },
      stop() { mounted?.stop(); process.stop(); },
    };
  } catch (error) { mounted?.stop(); process.stop(); throw error; }
}
