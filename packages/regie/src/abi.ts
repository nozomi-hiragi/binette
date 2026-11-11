import { BinetteError } from "@binette/core";

/** OS が提供する WASM import。Worker の型と、起動・インストール時の検査で共有する */
export const HOST_ABI = {
  app: { module: "binette:app@0.1", functions: ["why", "sub", "page", "lastPage", "lastKind", "lastCause", "finish"] },
  apps: { module: "binette:apps@0.1", functions: ["icon", "count", "name", "id", "open"] },
  cadre: { module: "binette:cadre@0.1", functions: ["notificationCount", "notificationId", "notificationFrom", "notificationTitle", "notificationBody", "notificationActionCount", "notificationActionId", "notificationActionLabel", "notificationActionPlaceholder", "notificationActionInput", "notificationOpen", "notificationDismiss", "notificationReply", "count", "name", "isFront", "isHome", "hasIcon", "appIndex", "isInstalled", "installBusy", "install", "open", "close", "openHome", "back", "openSettings", "notify"] },
  dom: { module: "binette:dom@0.1", functions: ["byId", "create", "text", "class", "append", "remove", "listen", "unlisten"] },
  manager: { module: "binette:manager@0.1", functions: ["text", "number", "do"] },
  os: { module: "binette:os@0.1", functions: ["notificationCount", "notificationName", "notificationId", "notificationMuted", "setNotificationMuted", "get", "set", "role", "candidateCount", "candidateName", "candidateId", "assign", "launchCount", "launchTime", "launchName", "updatePhase", "updateCurrent", "updateNext", "openRecovery", "checkUpdate", "updateAvailable", "update"] },
  pigeon: { module: "binette:pigeon@0.1", functions: ["send", "count", "shares", "from", "to", "kind", "title", "body", "urgent", "actions", "done"] },
  schedule: { module: "binette:schedule@0.1", functions: ["text", "number", "do"] },
  scheduler: { module: "binette:scheduler@0.1", functions: ["text", "number", "do"] },
  shares: { module: "binette:shares@0.1", functions: ["request", "result"] },
  storage: { module: "binette:storage@0.1", functions: ["has", "read", "write", "remove", "count", "name"] },
  ui: { module: "binette:ui@0.1", functions: ["render"] },
  env: { module: "env", functions: ["abort"] },
} as const;

/** ABI の module 名から機能と版を読む。形式外の名前はそのまま表示する */
function parseAbiModule(module: string): { feature: string; version: string } | undefined {
  const match = /^binette:([a-z][a-z0-9-]*)@(0\.\d+|[1-9]\d*)$/.exec(module);
  return match && match[0] === module ? { feature: match[1], version: match[2] } : undefined;
}

function moduleLabel(module: string): string {
  const abi = parseAbiModule(module);
  return abi ? `${abi.feature} ${abi.version}` : module;
}

/** 提供一覧の全関数を Worker に実装する。未知の関数も型検査で検出する */
export type HostImports = {
  [Feature in keyof typeof HOST_ABI as typeof HOST_ABI[Feature]["module"]]: Record<typeof HOST_ABI[Feature]["functions"][number], (...args: never[]) => unknown>;
};

/** 実行せずに import を検査し、起動に使えるコンパイル済み module を返す */
export async function validateAppAbi(wasm: Uint8Array | ArrayBuffer): Promise<WebAssembly.Module> {
  const bytes = wasm instanceof Uint8Array ? new Uint8Array(wasm) : wasm;
  const module = await WebAssembly.compile(bytes);
  const supported: ReadonlyMap<string, readonly string[]> = new Map(Object.values(HOST_ABI).map(abi => [abi.module, abi.functions]));
  const imports = WebAssembly.Module.imports(module);
  const missing = [...new Set(imports.filter(entry => !supported.has(entry.module)).map(entry => entry.module))];
  if (missing.length) throw new BinetteError("unsupported_abi", `この OS では動きません（${missing.map(moduleLabel).sort().join("、")}）。アプリの管理から入れ直すと直ります`);
  const invalid = imports.filter(entry => entry.kind !== "function" || !supported.get(entry.module)!.includes(entry.name));
  if (invalid.length) throw new BinetteError("unsupported_abi", `この OS では動きません（${invalid.map(entry => `${moduleLabel(entry.module)} の ${entry.name}`).sort().join("、")}）。アプリの管理から入れ直すと直ります`);
  return module;
}

/** ビルドした WASM から必要な機能と版を求める。SDK の import や宣言だけでは要求に含めない */
export async function appRequirements(wasm: Uint8Array): Promise<Record<string, string>> {
  const module = await WebAssembly.compile(new Uint8Array(wasm));
  const requirements = new Map<string, string>();
  for (const entry of WebAssembly.Module.imports(module)) {
    if (entry.module === "env") continue;
    const abi = parseAbiModule(entry.module);
    if (!abi) throw new Error(`requires に表せない WASM import です: ${entry.module}`);
    const previous = requirements.get(abi.feature);
    if (previous !== undefined && previous !== abi.version) throw new Error(`同じ機能に複数の ABI の版があります: ${abi.feature}`);
    requirements.set(abi.feature, abi.version);
  }
  return Object.fromEntries([...requirements].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

/** カタログの要求を現在の OS と照合する。未記載は従来どおりビルド後に検査する */
export function appCompatibility(requires?: Record<string, string>): string {
  const supported = new Set<string>(Object.values(HOST_ABI).map(abi => abi.module));
  const missing = Object.entries(requires ?? {}).filter(([feature, version]) => !supported.has(`binette:${feature}@${version}`));
  return missing.length ? `この OS では使えません（${missing.map(([feature, version]) => `${feature} ${version}`).sort().join("、")}）` : "";
}

/** アプリのファイルを取る前にも、最新のカタログの要求を検査する */
export function validateAppRequirements(requires?: Record<string, string>): void {
  const reason = appCompatibility(requires);
  if (reason) throw new BinetteError("unsupported_abi", reason);
}
