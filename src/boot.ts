import { formatAppId, normalizeAppIdentifier, parseAppId, parseAppManifest } from "@binette/core";
import {
  type AppStore,
  type FileTree,
  appId,
  parseSystemManifest,
  SYSTEM_MANIFEST_PATH,
  type SystemApp,
  type SystemDistribution,
} from "@binette/regie";

const SYSTEM = "binette:system";
const BUNDLED = "binette:bundled";
const fixed = (source: string) => source === SYSTEM || source === BUNDLED;
const decoder = new TextDecoder("utf-8", { fatal: true });

/** 配布物を読むたびに検証し、設定アプリはユーザーの上書きを使わない。 */
export async function loadBootApps(
  tree: FileTree,
  distribution: SystemDistribution,
): Promise<{ apps: SystemApp[]; roles: Record<string, string> }> {
  const required = async (path: string, system = false) => {
    const value =
      await (system
        ? distribution.readSystem(`/system${path}`)
        : distribution.readOverlay(path));
    if (value === undefined) {
      throw new Error(`起動に必要なファイルがありません: ${path}`);
    }
    return value;
  };
  const boot = JSON.parse(decoder.decode(await required("/boot.json", true)));
  if (
    !boot || typeof boot.roles?.home !== "string" ||
    typeof boot.roles?.settings !== "string" ||
    typeof boot.roles?.cadre !== "string"
  ) {
    throw new Error("boot.json の役割の割り当てが不正です。");
  }
  const roleKeys: Record<string, string> = {};
  for (const [role, id] of Object.entries(boot.roles)) {
    if (typeof id !== "string") throw new Error("boot.json の役割の割り当てが不正です。");
    roleKeys[role] = formatAppId(parseAppId(id));
  }
  const apps: SystemApp[] = [];
  // 役割の既定の割り当て（役割 → appId）
  const roles: Record<string, string> = {};
  const keys = new Set<string>();
  const saved = await tree.read(SYSTEM_MANIFEST_PATH);
  if (!saved) throw new Error("保存された目録がありません。");
  const paths = parseSystemManifest(JSON.parse(decoder.decode(saved))).files
    .map((file) => `/${file.path}`);
  for (
    const [prefix, source] of [["/system/apps", SYSTEM], [
      "/system/bundled",
      BUNDLED,
    ]] as const
  ) {
    for (
      const path of paths.filter((path) => path.startsWith(`${prefix}/`)).sort()
    ) {
      if (!/^\/system\/(apps|bundled)\/[^/]+\/app\.json$/.test(path)) continue;
      const directory = path.slice("/system".length, -"/app.json".length);
      const original = parseAppManifest(
        decoder.decode(await required(`${directory}/app.json`, true)),
      );
      const declaresSettings = (app: typeof original) => app.roles?.includes("settings") || Object.values(app.sub ?? {}).some(sub => sub.roles?.includes("settings"));
      const coreSettings = source === SYSTEM && declaresSettings(original) === true;
      const manifest = coreSettings ? original : parseAppManifest(
        decoder.decode(await required(`${directory}/app.json`)),
      );
      const entries = [{ id: manifest.id, roles: manifest.roles }, ...Object.entries(manifest.sub ?? {}).map(([id, sub]) => ({ id: `${manifest.id}.${normalizeAppIdentifier(id)}`, roles: sub.roles }))];
      for (const entry of entries) {
        const key = entry.id === manifest.id ? appId(source, manifest.id) : `${appId(source, manifest.id)}.${entry.id.slice(manifest.id.length + 1)}`;
        if (keys.has(key)) throw new Error(`アプリの ID が重複しています: ${entry.id}`);
        keys.add(key);
        if (source !== SYSTEM) continue;
        if (entry.roles?.includes("settings") && (!coreSettings || key !== roleKeys.settings)) {
          throw new Error("設定アプリの役割は固定の割り当てから変更できません。");
        }
        for (const role of ["home", "cadre", "settings"]) {
          if (key === roleKeys[role] && entry.roles?.includes(role)) roles[role] = key;
        }
      }
      const [wasm, html, css, icon] = await Promise.all([
        required(`${directory}/app.wasm`, coreSettings),
        required(`${directory}/index.html`, coreSettings),
        manifest.entry.css === undefined
          ? undefined
          : required(`${directory}/style.css`, coreSettings),
        manifest.icon === undefined
          ? undefined
          : required(`${directory}/icon.svg`, coreSettings),
      ]);
      const subIcons: Record<string, string> = {};
      for (const [id, sub] of Object.entries(manifest.sub ?? {})) {
        if (sub.icon !== undefined) {
          // サブの相対パスは親のフォルダ内だけを許す。
          if (sub.icon.startsWith("/") || sub.icon.split("/").includes("..") || sub.icon.includes("%") || sub.icon.includes("\\") || sub.icon.includes(":")) throw new Error("サブアプリのアイコンのパスが不正です。");
          subIcons[id] = decoder.decode(await required(`${directory}/${sub.icon}`, coreSettings));
        }
      }
      apps.push({
        source,
        prebuilt: {
          manifest,
          subIcons,
          wasm,
          html: decoder.decode(html),
          ...(css === undefined ? {} : { css: decoder.decode(css) }),
          ...(icon === undefined ? {} : { icon: decoder.decode(icon) }),
        },
      });
    }
  }
  if (!roles.home || !roles.settings || !roles.cadre) {
    throw new Error(
      "boot.json に指定された Cadre、ホームまたは設定アプリがありません。",
    );
  }
  return { apps, roles };
}

/** 古い配布物の保存済みコードを、起動候補へ戻さない。通常のインストール済みアプリは残す。 */
export function bootAppStore(store: AppStore): AppStore {
  return {
    ...store,
    async list() {
      return (await store.list()).filter((app) => !fixed(app.source));
    },
    async get(key) {
      const app = await store.get(key);
      return app && !fixed(app.source) ? app : undefined;
    },
  };
}
