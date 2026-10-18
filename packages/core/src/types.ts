import type { InferOutput } from "valibot";
import type { binetteAssetSchema, binetteSchema } from "./schema.ts";

export type BinetteAsset = InferOutput<typeof binetteAssetSchema>;
export type Binette = InferOutput<typeof binetteSchema>;
export type { BinetteSettingsRow, BinetteSettingsSection } from "./schema.ts";
