/**
 * Régie。アプリの WASM を Worker で動かし、アプリからの呼び出しを受けて外に知らせる。
 *
 * @packageDocumentation
 */
export type { WorkerScope } from "./worker.ts";
export { serveApp } from "./worker.ts";
export type { ApiDenial, CadreSnapshot, LaunchOptions, SafeArea, ManagerApp, ManagerDetails, ManagerSnapshot, NetSnapshot, OsSnapshot, ScheduleSlot, ScheduleSnapshot, SchedulerEntry, SchedulerSnapshot, RegieApp, RegieWorker } from "./launch.ts";
export { API_KEYS, launchApp } from "./launch.ts";
export type { AppDataStore, AppStore, IndexedDbAppStoreOptions, InstalledApp, LifecycleRecord, LaunchRecord, SavedNetLists, SystemSettings, SystemStore } from "./store.ts";
export { APPEARANCE_LIMITS, createAppStore, createIndexedDbAppStore, createMemoryAppStore, DEFAULT_SYSTEM_SETTINGS, appId, validateSystemSettings } from "./store.ts";
export type { FileTree, IndexedDbFileTreeOptions } from "./fs.ts";
export { createIndexedDbFileTree, createMemoryFileTree } from "./fs.ts";
export type { ContentStore, FileMetadata, IndexedDbStorageOptions, OwnerStorage, ProviderRecord, StorageBackend, StorageOptions, ShareRecord, ShareStorage } from "./storage.ts";
export { createIndexedDbStorage, createMemoryContentStore, createMemoryStorage, createOpfsContentStore } from "./storage.ts";
export type { InstallOptions, InstallProgress, RecoveryAction, SystemDistribution, SystemDistributionOptions, SystemManifest, SystemUpdate } from "./distribution.ts";
export { createSystemDistribution, parseSystemManifest, SYSTEM_MANIFEST_PATH } from "./distribution.ts";
export type { ProcessOptions, Process } from "./process.ts";
export { startProcess } from "./process.ts";
export type { Appearance, SystemApp, SystemOptions, SystemUi, SystemView, BinetteSystem } from "./system.ts";
export { startSystem } from "./system.ts";
export type { PrebuiltApp } from "./prebuilt.ts";
export { parsePrebuiltApp, stringifyPrebuiltApp } from "./prebuilt.ts";
export type { BrowserBuildOptions } from "./browser-build.ts";
export { buildAppInWorker, buildStoredApp } from "./browser-build.ts";

export { createScheduler, nextScheduleTime, parseScheduleRule, SCHEDULE_MIN_EVERY } from "./scheduler.ts";
export type { ScheduleDay, ScheduleInfo, ScheduleJob, ScheduleRule, ScheduleRun, Scheduler, SchedulerOptions } from "./scheduler.ts";
export type { SavedSchedule } from "./store.ts";
export { formatDate, formatTime, systemTimeZone } from "./time.ts";
export { createProviderLists } from "./lists.ts";
export type { AppDetails, AppUpdate, AutoUpdateSettings, InstallConfirmation, InstallPhase, InstallState, ProviderLists, ProviderListsOptions } from "./lists.ts";
export type { ProviderListRegistration } from "./store.ts";

export type { LetterAction, PigeonLetter, PigeonSnapshot, PigeonSend, UserLetter } from "./launch.ts";
export type { PigeonStore } from "./pigeon.ts";
export { createMemoryPigeonStore, createIndexedDbPigeonStore, PIGEON_HISTORY_LIMIT, PIGEON_INBOX_LIMIT } from "./pigeon.ts";
