/**
 * Régie。アプリの WASM を Worker で動かし、アプリからの呼び出しを受けて外に知らせる。
 *
 * @packageDocumentation
 */
export type { WorkerScope } from "./worker.ts";
export { serveApp } from "./worker.ts";
export type { DomOp, LaunchOptions, RegieApp, RegieWorker } from "./launch.ts";
export { launchApp } from "./launch.ts";
export type { AppStore, IndexedDbAppStoreOptions, InstalledApp, LifecycleRecord, LaunchRecord, SystemSettings, SystemStore } from "./store.ts";
export { createIndexedDbAppStore, createMemoryAppStore, DEFAULT_SYSTEM_SETTINGS, installedAppKey, validateSystemSettings } from "./store.ts";
