import * as v from "valibot";

const objectValue = (message: string) => v.custom<Record<string, unknown>>(
  (value) => typeof value === "object" && value !== null && !Array.isArray(value), message,
);
const nonempty = (message: string) => v.pipe(v.string(message), v.nonEmpty(message));
const absent = v.optional(v.never());

const versionString = v.pipe(v.string("Binette のバージョンが正しくありません。"), v.regex(/^\d+\.\d+$/, "Binette のバージョンが正しくありません。"));


export const binetteAssetSchema = v.pipe(
  objectValue("asset の type が正しくありません。"),
  v.check((asset) => Object.hasOwn(asset, "content") !== Object.hasOwn(asset, "src"), "asset には content と src のどちらか一方を指定してください。"),
  v.transform((asset) => ({ type: asset.type, ...(Object.hasOwn(asset, "content") ? { content: asset.content } : { src: asset.src }) })),
  v.lazy((asset) => Object.hasOwn(asset as object, "content")
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
export interface BinetteSettingsRow {
  id: string;
  start?: string;
  label: string;
  end?: string;
  sections?: BinetteSettingsSection[];
}
export type BinetteSettingsSection = { order?: number; label?: string } & (
  { type: "list"; contents: BinetteSettingsRow[] } |
  { type: "element"; entry?: string; component?: string }
);

const settingsRowSchema: v.GenericSchema<BinetteSettingsRow> = v.object({
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
const settingsSectionSchema: v.GenericSchema<BinetteSettingsSection> = v.variant("type", [
  v.object({ ...sectionCommon, type: v.literal("list"), contents: v.array(settingsRowSchema, "list の contents は配列で指定してください。") }),
  v.pipe(
    v.object({ ...sectionCommon, type: v.literal("element"), entry: v.optional(nonempty("element の entry は asset の名前で指定してください。")), component: v.optional(nonempty("element の component は部品の名前で指定してください。")) }),
    v.check((section) => (section.entry === undefined) !== (section.component === undefined), "element には entry と component のどちらか一方を指定してください。"),
  ),
], "セクションの type は list か element で指定してください。");

function settingsEntries(sections: BinetteSettingsSection[]): string[] {
  return sections.flatMap((section) => section.type === "element"
    ? section.entry === undefined ? [] : [section.entry]
    : section.contents.flatMap((row) => settingsEntries(row.sections ?? [])));
}

const redirectPath = v.pipe(
  nonempty("redirect は Scene 内のパスで指定してください。"),
  v.check(path => path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") && !/[\u0000-\u0020]/.test(path), "redirect は Scene 内のパスで指定してください。"),
);

const binetteBodySchema = v.pipe(
  objectValue("Binette はオブジェクトで指定してください。"),
  v.check((value) => Object.hasOwn(value, "entry") !== Object.hasOwn(value, "redirect"), "entry と redirect のどちらか一方を指定してください。"),
  v.object({
    binette: versionString,
    title: v.optional(v.string("title は文字列で指定してください。")),
    entry: v.optional(nonempty("entry は asset の名前で指定してください。")),
    redirect: v.optional(redirectPath),
    assets: v.optional(assetsSchema, () => Object.create(null) as v.InferOutput<typeof assetsSchema>),
    settings: v.optional(v.array(settingsSectionSchema, "settings は配列で指定してください。")),
  }),
);

export const binetteSchema = v.pipe(
  binetteBodySchema,
  v.check((value) => value.entry === undefined || Object.hasOwn(value.assets, value.entry), "entry の asset がありません。"),
  v.check((value) => value.entry === undefined || !Object.hasOwn(value.assets, value.entry) || ["html", "js"].includes(value.assets[value.entry].type), "entry には html か js の asset を指定してください。"),
  v.check((value) => settingsEntries(value.settings ?? []).every((entry) => Object.hasOwn(value.assets, entry) && value.assets[entry].type === "js"), "element の entry には js の asset を指定してください。"),
);
