import type { FileTree } from "./fs.ts";

/** 同一オリジンから配布する固定物の目録。パスは system/ から始める。 */
export interface SystemManifest {
  version: string;
  label?: string;
  kernel?: string;
  files: { path: string; sha256: string; size: number }[];
}

export interface SystemDistributionOptions {
  manifestUrl: string | URL;
  /** カーネルが動くページの origin。取得元から推測しない。 */
  origin: string;
  fetch?: typeof globalThis.fetch;
}

export interface SystemUpdate {
  manifest: SystemManifest;
  installedVersion: string | undefined;
  updateAvailable: boolean;
}

export type RecoveryAction = "clear-user" | "refetch-system" | "clear-all";

export interface SystemDistribution {
  /** 取得できない場合だけ、検証した保存済み配布物を更新なしとして返す。 */
  checkUpdate(online?: boolean): Promise<SystemUpdate>;
  install(manifest?: SystemManifest): Promise<void>;
  /** 現行版を変えずに取得・検証し、切替操作を返す。 */
  prepare(manifest: SystemManifest): Promise<{ commit(): Promise<void> }>;
  installed(): Promise<SystemManifest | undefined>;
  readSystem(path: string): Promise<Uint8Array | undefined>;
  readOverlay(path: string): Promise<Uint8Array | undefined>;
  recover(action: RecoveryAction): Promise<void>;
}

/** 本体と同じトランザクションで保存する、カーネル用の予約パス。 */
export const SYSTEM_MANIFEST_PATH = "/system/.manifest.json";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** 目録の内容・取得元の検査失敗と、取得できない場合を区別する。 */
class DistributionUnavailable extends Error {}

function canonical(path: string): boolean {
  return !/[\\%?#\s]/.test(path) &&
    ![...path].some((char) =>
      char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
    ) &&
    path.split("/").every((part) => part && part !== "." && part !== "..");
}

/** 入力を検査してコピーする。非同期処理中に呼び出し側が変えても影響しない。 */
export function parseSystemManifest(value: unknown): SystemManifest {
  if (typeof value !== "object" || value === null) {
    throw new Error("目録はオブジェクトにしてください。");
  }
  const { version, files, label, kernel } = value as Record<string, unknown>;
  if (typeof version !== "string" || !version.trim() || !Array.isArray(files)) {
    throw new Error("目録の version と files が不正です。");
  }
  for (const [name, value] of [["label", label], ["kernel", kernel]]) {
    if (value !== undefined && (typeof value !== "string" || !value.trim())) throw new Error(`目録の ${name} が不正です。`);
  }
  const seen = new Set<string>();
  return {
    version,
    ...(label === undefined ? {} : { label: label as string }),
    ...(kernel === undefined ? {} : { kernel: kernel as string }),
    files: files.map((value) => {
      if (typeof value !== "object" || value === null) {
        throw new Error("目録のファイルが不正です。");
      }
      const { path, sha256, size } = value as Record<string, unknown>;
      if (
        typeof path !== "string" || !path.startsWith("system/") ||
        !canonical(path) || `/${path}` === SYSTEM_MANIFEST_PATH ||
        seen.has(path) || typeof sha256 !== "string" ||
        !/^[0-9a-f]{64}$/.test(sha256) || typeof size !== "number" ||
        !Number.isSafeInteger(size) || size < 0
      ) throw new Error("目録のパス・SHA-256・大きさが不正です。");
      seen.add(path);
      return { path, sha256, size };
    }),
  };
}

async function verify(
  data: Uint8Array,
  file: SystemManifest["files"][number],
): Promise<void> {
  if (data.byteLength !== file.size) {
    throw new Error(`大きさが一致しません: ${file.path}`);
  }
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", data.slice()),
  );
  const actual = [...hash].map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (actual !== file.sha256) {
    throw new Error(`SHA-256 が一致しません: ${file.path}`);
  }
}

function decodeManifest(data: Uint8Array): SystemManifest {
  return parseSystemManifest(JSON.parse(decoder.decode(data)));
}

function sameManifest(a: SystemManifest, b: SystemManifest): boolean {
  const ordered = (manifest: SystemManifest) => ({
    version: manifest.version,
    files: [...manifest.files].sort((a, b) => a.path.localeCompare(b.path)),
  });
  return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
}

/** 取得・検査・保存・復旧。実行する固定物は必ずこの読み込み API を通す。 */
export function createSystemDistribution(
  tree: FileTree,
  options: SystemDistributionOptions,
): SystemDistribution {
  const origin = new URL(options.origin);
  if (!/^https?:$/.test(origin.protocol) || origin.origin !== options.origin) {
    throw new Error("origin はページの HTTP(S) オリジンにしてください。");
  }
  const manifestUrl = new URL(options.manifestUrl, `${origin.origin}/`);
  const sameOrigin = (url: URL) => {
    if (
      url.origin !== origin.origin || url.username || url.password || url.hash
    ) {
      throw new Error("取得元は同じオリジンにしてください。");
    }
  };
  sameOrigin(manifestUrl);
  const fetcher = options.fetch ?? globalThis.fetch;
  let trustedManifest: SystemManifest | undefined;
  const fetchBytes = async (url: URL, manifest = false) => {
    sameOrigin(url);
    let response: Response;
    try {
      response = await fetcher(url, {
        redirect: "error",
        credentials: "same-origin",
        cache: "no-store",
        // 目録だけ短く待つ。大きな固定物の取得には時間制限を掛けない。
        ...(manifest ? { signal: AbortSignal.timeout(8000) } : {}),
      });
    } catch (cause) {
      throw new DistributionUnavailable(`取得に失敗しました: ${url.pathname}`, {
        cause,
      });
    }
    if (response.url) sameOrigin(new URL(response.url));
    if (
      response.redirected || (response.status >= 300 && response.status < 400)
    ) {
      throw new Error(
        `取得に失敗しました: ${url.pathname} (${response.status})`,
      );
    }
    if (!response.ok) {
      throw new DistributionUnavailable(
        `取得に失敗しました: ${url.pathname} (${response.status})`,
      );
    }
    try {
      return new Uint8Array(await response.arrayBuffer());
    } catch (cause) {
      throw new DistributionUnavailable(`取得に失敗しました: ${url.pathname}`, {
        cause,
      });
    }
  };
  const fetchManifest = async () =>
    decodeManifest(await fetchBytes(manifestUrl, true));
  const prepare = async (input?: SystemManifest, refetch = false) => {
    const manifest = input === undefined
      ? await fetchManifest()
      : parseSystemManifest(input);
    const files = new Map<string, Uint8Array>();
    for (const file of manifest.files) {
      let data = refetch ? undefined : await tree.read(`/${file.path}`);
      if (data) {
        try {
          await verify(data, file);
        } catch {
          data = undefined;
        }
      }
      if (!data) {
        data = await fetchBytes(new URL(file.path, manifestUrl));
        await verify(data, file);
      }
      files.set(`/${file.path}`, data);
    }
    files.set(SYSTEM_MANIFEST_PATH, encoder.encode(JSON.stringify(manifest)));
    return { async commit() {
      await tree.replaceSystem(files);
      trustedManifest = manifest;
    } };
  };
  const readSystem = async (path: string) => {
    if (
      !path.startsWith("/system/") || !canonical(path.slice(1)) ||
      path === SYSTEM_MANIFEST_PATH
    ) {
      throw new Error(
        "読み込み先は目録に載る /system のファイルにしてください。",
      );
    }
    // 目録と本体を同じ時点で読む。更新の途中でも版を混ぜない。
    const [saved, data] = await tree.readFiles([SYSTEM_MANIFEST_PATH, path]);
    if (!saved) throw new Error("保存された目録がありません。");
    const manifest = decodeManifest(saved);
    if (trustedManifest && !sameManifest(manifest, trustedManifest)) {
      throw new Error("保存された目録が確認済みの目録と一致しません。");
    }
    const file = manifest.files.find((file) => `/${file.path}` === path);
    if (!file) {
      if (data) throw new Error(`目録にない固定物です: ${path}`);
      return undefined;
    }
    if (!data) throw new Error(`固定物がありません: ${path}`);
    await verify(data, file);
    return data;
  };
  return {
    async checkUpdate(online = false) {
      let manifest: SystemManifest;
      try {
        manifest = await fetchManifest();
      } catch (error) {
        if (online || !(error instanceof DistributionUnavailable)) throw error;
        const saved = await tree.read(SYSTEM_MANIFEST_PATH);
        if (!saved) throw error;
        const installed = decodeManifest(saved);
        trustedManifest = installed;
        for (const file of installed.files) await readSystem(`/${file.path}`);
        return {
          manifest: installed,
          installedVersion: installed.version,
          updateAvailable: false,
        };
      }
      const saved = await tree.read(SYSTEM_MANIFEST_PATH);
      const installed = saved ? decodeManifest(saved) : undefined;
      const installedVersion = installed?.version;
      if (
        installed?.version === manifest.version &&
        !sameManifest(installed, manifest)
      ) {
        throw new Error("保存された目録が同版の配布目録と一致しません。");
      }
      if (installed) trustedManifest = installed;
      return {
        manifest,
        installedVersion,
        updateAvailable: installedVersion !== manifest.version || installed?.kernel !== manifest.kernel,
      };
    },
    install: async (manifest) => { await (await prepare(manifest)).commit(); },
    prepare: (manifest) => prepare(manifest),
    async installed() {
      const saved = await tree.read(SYSTEM_MANIFEST_PATH);
      return saved ? decodeManifest(saved) : undefined;
    },
    readSystem,
    async readOverlay(path) {
      if (!path.startsWith("/") || !canonical(path.slice(1))) {
        throw new Error("読み込み先は正規の絶対パスにしてください。");
      }
      if (path !== "/apps/settings" && !path.startsWith("/apps/settings/")) {
        const user = await tree.read(`/user${path}`);
        if (user) return user;
      }
      return await readSystem(`/system${path}`);
    },
    async recover(action) {
      switch (action) {
        case "refetch-system":
          await (await prepare(undefined, true)).commit();
          return;
        case "clear-user":
          for (const path of await tree.list("/user")) await tree.delete(path);
          return;
        case "clear-all":
          await tree.replaceSystem(new Map());
          trustedManifest = undefined;
          for (const path of await tree.list("/")) {
            if (!path.startsWith("/system/")) await tree.delete(path);
          }
          return;
        default:
          throw new Error("不明な復旧操作です。");
      }
    },
  };
}
