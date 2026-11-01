import { parseAppManifest } from "@binette/core";
import {
  type AppStore,
  type FileTree,
  installedAppKey,
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
): Promise<{ apps: SystemApp[]; home: string }> {
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
    typeof boot.roles?.settings !== "string"
  ) {
    throw new Error("boot.json の役割の割り当てが不正です。");
  }
  const apps: SystemApp[] = [];
  let home: string | undefined;
  let settings = false;
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
      const coreSettings = source === SYSTEM && original.role === "settings";
      const manifest = coreSettings ? original : parseAppManifest(
        decoder.decode(await required(`${directory}/app.json`)),
      );
      if (
        source === SYSTEM && manifest.role === "settings" &&
        (!coreSettings || manifest.id !== boot.roles.settings)
      ) {
        throw new Error("設定アプリの役割は固定の割り当てから変更できません。");
      }
      const key = installedAppKey(source, manifest.id);
      if (keys.has(key)) {
        throw new Error(`アプリの ID が重複しています: ${manifest.id}`);
      }
      keys.add(key);
      if (
        source === SYSTEM && manifest.id === boot.roles.home &&
        manifest.role === "home"
      ) home = key;
      if (coreSettings && manifest.id === boot.roles.settings) settings = true;
      const [wasm, html, icon] = await Promise.all([
        required(`${directory}/app.wasm`, coreSettings),
        required(`${directory}/index.html`, coreSettings),
        manifest.icon === undefined
          ? undefined
          : required(`${directory}/icon.svg`, coreSettings),
      ]);
      apps.push({
        source,
        prebuilt: {
          manifest,
          wasm,
          html: decoder.decode(html),
          ...(icon === undefined ? {} : { icon: decoder.decode(icon) }),
        },
      });
    }
  }
  if (!home || !settings) {
    throw new Error(
      "boot.json に指定されたホームまたは設定アプリがありません。",
    );
  }
  return { apps, home };
}

/** 古い配布物の保存済みコードを、起動候補へ戻さない。通常のインストール済みアプリは残す。 */
export function bootAppStore(
  store: AppStore,
  home: string,
  homes: readonly string[] = [home],
): AppStore {
  return {
    ...store,
    system: {
      ...store.system,
      async getSettings() {
        const settings = await store.system.getSettings();
        const selected = settings?.home;
        const installed = selected && !homes.includes(selected)
          ? await store.get(selected)
          : undefined;
        const valid = selected &&
          (homes.includes(selected) ||
            (installed && !fixed(installed.source) &&
              installed.manifest.role === "home"));
        return { ...settings, home: valid ? selected : home };
      },
    },
    async list() {
      return (await store.list()).filter((app) => !fixed(app.source));
    },
    async get(key) {
      const app = await store.get(key);
      return app && !fixed(app.source) ? app : undefined;
    },
  };
}
