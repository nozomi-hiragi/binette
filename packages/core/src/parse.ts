import * as v from "valibot";
import { binetteSchema } from "./schema.ts";
import type { Binette } from "./types.ts";

export class BinetteError extends Error {
  readonly code: "invalid_format";

  constructor(code: "invalid_format", message: string) {
    super(message);
    this.code = code;
    this.name = "BinetteError";
  }
}

export function parseBinette(value: unknown): Binette {
  const result = v.safeParse(binetteSchema, value, { abortEarly: true });
  if (!result.success) throw new BinetteError("invalid_format", result.issues[0].message);
  return result.output;
}
