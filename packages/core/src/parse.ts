import * as v from "valibot";
import { binetteSchema } from "./schema.ts";
import type { Binette } from "./types.ts";

/** ビネットの形式が正しくないときのエラー */
export class BinetteError extends Error {
  readonly code: "invalid_format";

  constructor(code: "invalid_format", message: string) {
    super(message);
    this.code = code;
    this.name = "BinetteError";
  }
}

/**
 * `.bina` の中身を JSON として読み、ビネットとして検査する。正しければ {@link Binette} として返す。
 *
 * @param text `.bina` の中身の文字列
 * @throws {BinetteError} JSON として読めないときや、形式が正しくないとき
 */
export function parseBinette(text: string): Binette {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BinetteError("invalid_format", "Binette を JSON として読めません。");
  }
  const result = v.safeParse(binetteSchema, value, { abortEarly: true });
  if (!result.success) throw new BinetteError("invalid_format", result.issues[0].message);
  return result.output;
}
