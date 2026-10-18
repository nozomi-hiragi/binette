import * as v from "valibot";

const objectValue = (message: string) => v.custom<Record<string, unknown>>(
  (value) => typeof value === "object" && value !== null && !Array.isArray(value), message,
);
/** オブジェクトなら `key` の値を、そうでなければ undefined を返す */
const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
const has = (value: unknown, key: string) => typeof value === "object" && value !== null && Object.hasOwn(value, key);
const nonempty = (message: string) => v.pipe(v.string(message), v.nonEmpty(message));
const absent = v.optional(v.never());

const versionString = v.pipe(v.string("Binette のバージョンが正しくありません。"), v.regex(/^\d+\.\d+$/, "Binette のバージョンが正しくありません。"));


export const binetteAssetSchema = v.pipe(
  objectValue("asset の type が正しくありません。"),
  v.check((asset) => Object.hasOwn(asset, "content") !== Object.hasOwn(asset, "src"), "asset には content と src のどちらか一方を指定してください。"),
  v.transform((asset) => ({ type: asset.type, ...(Object.hasOwn(asset, "content") ? { content: asset.content } : { src: asset.src }) })),
  v.lazy((asset) => has(asset, "content")
    ? v.object({ type: nonempty("asset の type が正しくありません。"), content: v.string("asset の content は文字列で指定してください。"), src: absent })
    : v.object({ type: nonempty("asset の type が正しくありません。"), src: nonempty("asset の src は URL で指定してください。"), content: absent })),
);

// record は特殊な名前を除外するため、全ての own enumerable key を検証してから辞書へ戻す。
const assetsSchema = v.pipe(
  objectValue("assets はオブジェクトで指定してください。"),
  v.transform(Object.entries),
  v.array(v.tuple([
    v.pipe(v.string(), v.nonEmpty("asset の名前には拡張子やパスを指定できません。"), v.check((name) => !/[./\\]/.test(name), "asset の名前には拡張子やパスを指定できません。")),
    binetteAssetSchema,
  ])),
  v.transform((entries) => Object.assign(Object.create(null) as Record<string, v.InferOutput<typeof binetteAssetSchema>>, Object.fromEntries(entries))),
);
/** 設定画面の list セクションの 1 行。欄は検討中 */
export interface BinetteSettingsRow {
  /** 行の名前。`sections` があるとき `/settings/<id>` で開く */
  id: string;
  /** 行の先頭に出す文字（アイコンなど） */
  start?: string;
  /** 行の見出し */
  label: string;
  /** 行の末尾に出す文字 */
  end?: string;
  /** 押したときに開く中身。入れ子にできる */
  sections?: BinetteSettingsSection[];
}

/** 設定画面のセクション。行の一覧（list）か任意の表示（element）のどちらか */
export type BinetteSettingsSection = BinetteSettingsList | BinetteSettingsElement;

/** 設定画面のセクションに共通の欄 */
export interface BinetteSettingsSectionBase {
  /** 並び順。General が `0` で、小さいほど上。省略すると `0`。一番上の階層だけで効く */
  order?: number;
  /** セクションの見出し */
  label?: string;
}

/** 行の一覧のセクション */
export interface BinetteSettingsList extends BinetteSettingsSectionBase {
  type: "list";
  /** 並べる行 */
  contents: BinetteSettingsRow[];
}

/** 任意の表示のセクション。`entry` と `component` のどちらか一方を持つ */
export type BinetteSettingsElement = BinetteSettingsEntryElement | BinetteSettingsComponentElement;

/** 入口の js asset を表示するセクション */
export interface BinetteSettingsEntryElement extends BinetteSettingsSectionBase {
  type: "element";
  /** 入口の `assets` にある js の名前。`mount(element, sh)` を呼ぶ */
  entry: string;
  component?: undefined;
}

/** クライアントが登録した部品を表示するセクション */
export interface BinetteSettingsComponentElement extends BinetteSettingsSectionBase {
  type: "element";
  /** クライアントが `components` で登録した部品の名前 */
  component: string;
  entry?: undefined;
}

const settingsRowSchema: v.GenericSchema<unknown, BinetteSettingsRow> = v.object({
  id: nonempty("設定の行の id を指定してください。"),
  start: v.optional(v.string("設定の行の start は文字列で指定してください。")),
  label: v.string("設定の行の label は文字列で指定してください。"),
  end: v.optional(v.string("設定の行の end は文字列で指定してください。")),
  sections: v.optional(v.array(v.lazy(() => settingsSectionSchema), "設定の行の sections は配列で指定してください。")),
});
const sectionCommon = {
  order: v.optional(v.pipe(v.number("order は数値で指定してください。"), v.finite("order は数値で指定してください。"))),
  label: v.optional(v.string("セクションの label は文字列で指定してください。")),
};
// element は入口の js asset（entry）か、クライアントが登録した部品（component）のどちらか一方を表示する。
const settingsSectionSchema: v.GenericSchema<unknown, BinetteSettingsSection> = v.pipe(
  objectValue("セクションはオブジェクトで指定してください。"),
  v.check((section) => section.type === "list" || section.type === "element", "セクションの type は list か element で指定してください。"),
  v.check((section) => section.type !== "element" || Object.hasOwn(section, "entry") !== Object.hasOwn(section, "component"), "element には entry と component のどちらか一方を指定してください。"),
  v.lazy((section) => field(section, "type") === "list"
    ? v.object({ ...sectionCommon, type: v.literal("list"), contents: v.array(settingsRowSchema, "list の contents は配列で指定してください。") })
    : has(section, "entry")
      ? v.object({ ...sectionCommon, type: v.literal("element"), entry: nonempty("element の entry は asset の名前で指定してください。"), component: absent })
      : v.object({ ...sectionCommon, type: v.literal("element"), component: nonempty("element の component は部品の名前で指定してください。"), entry: absent })),
);

function settingsEntries(sections: BinetteSettingsSection[]): string[] {
  return sections.flatMap((section) => section.type === "element"
    ? section.entry === undefined ? [] : [section.entry]
    : section.contents.flatMap((row) => settingsEntries(row.sections ?? [])));
}

const redirectPath = v.pipe(
  nonempty("redirect は Scene 内のパスで指定してください。"),
  v.check(path => path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") && !/[\u0000-\u0020]/.test(path), "redirect は Scene 内のパスで指定してください。"),
);

const binetteCommon = {
  binette: versionString,
  title: v.optional(v.string("title は文字列で指定してください。")),
  assets: v.optional(assetsSchema, () => Object.create(null) as v.InferOutput<typeof assetsSchema>),
  settings: v.optional(v.array(settingsSectionSchema, "settings は配列で指定してください。")),
};

const binetteBodySchema = v.pipe(
  objectValue("Binette はオブジェクトで指定してください。"),
  v.check((value) => Object.hasOwn(value, "entry") !== Object.hasOwn(value, "redirect"), "entry と redirect のどちらか一方を指定してください。"),
  v.lazy((value) => has(value, "entry")
    ? v.object({ ...binetteCommon, entry: nonempty("entry は asset の名前で指定してください。"), redirect: absent })
    : v.object({ ...binetteCommon, redirect: redirectPath, entry: absent })),
);

export const binetteSchema = v.pipe(
  binetteBodySchema,
  v.check((value) => value.entry === undefined || Object.hasOwn(value.assets, value.entry), "entry の asset がありません。"),
  v.check((value) => value.entry === undefined || !Object.hasOwn(value.assets, value.entry) || ["html", "js"].includes(value.assets[value.entry].type), "entry には html か js の asset を指定してください。"),
  v.check((value) => settingsEntries(value.settings ?? []).every((entry) => Object.hasOwn(value.assets, entry) && value.assets[entry].type === "js"), "element の entry には js の asset を指定してください。"),
);
