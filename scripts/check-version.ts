// 公開するパッケージのバージョンと設定がそろっているかを、テストや公開の前に確かめる。
import { existsSync } from "@std/fs";
import { join } from "@std/path";

export const PUBLISHED: Record<string, string> = {
  "packages/core": "@binette/core",
  "packages/regie": "@binette/regie",
  "packages/scene": "@binette/scene",
  "packages/coulisses": "@binette/coulisses",
  "packages/replique": "@binette/replique",
};
export const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(Deno.readTextFileSync(path)) as Record<string, unknown>;
}

export interface CheckResult {
  errors: string[];
  version: string | null;
}

/** バージョンの一致、内部依存の固定、LICENSE の一致を調べる。`expectedTag` を渡すとタグとも照らし合わせる */
export function checkVersions(root: string, expectedTag?: string): CheckResult {
  const errors: string[] = [];
  const names = new Set(Object.values(PUBLISHED));
  const versions = new Set<string>();

  for (const [dir, name] of Object.entries(PUBLISHED)) {
    const file = "deno.json";
    const path = join(root, dir, file);
    if (!existsSync(path)) {
      errors.push(`${dir}/${file}: missing`);
      continue;
    }
    const pkg = readJson(path);
    if (pkg.name !== name) errors.push(`${dir}/${file}: expected name ${name}`);
    if (typeof pkg.version !== "string" || !VERSION.test(pkg.version)) errors.push(`${dir}/${file}: expected a plain X.Y.Z version`);
    else versions.add(pkg.version);
  }

  const version = versions.size === 1 ? [...versions][0]! : null;
  if (versions.size !== 1) errors.push(`Version mismatch across packages: ${[...versions].join(", ")}`);
  if (expectedTag !== undefined) {
    if (!expectedTag.startsWith("v") || !VERSION.test(expectedTag.slice(1))) errors.push(`Tag format unrecognized: ${expectedTag} (expected vX.Y.Z)`);
    else if (expectedTag.slice(1) !== version) errors.push(`Tag version ${expectedTag.slice(1)} does not match package version ${version}`);
  }

  // 各パッケージの内部依存が jsr:@binette/x@version に固定されているか調べる
  for (const dir of Object.keys(PUBLISHED)) {
    const path = join(root, dir, "deno.json");
    if (!existsSync(path)) continue;
    const pkg = readJson(path);
    const imports = (pkg.imports ?? {}) as Record<string, unknown>;
    for (const [alias, target] of Object.entries(imports)) {
      if (names.has(alias) && target !== `jsr:${alias}@${version}`) {
        errors.push(`${dir}/deno.json: import ${alias} is ${String(target)}, expected jsr:${alias}@${version}`);
      }
    }
  }

  const license = Deno.readTextFileSync(join(root, "LICENSE"));
  for (const dir of Object.keys(PUBLISHED)) {
    const path = join(root, dir, "LICENSE");
    if (!existsSync(path)) errors.push(`${dir}/LICENSE: missing`);
    else if (license !== Deno.readTextFileSync(path)) errors.push(`${dir}/LICENSE: differs from root LICENSE`);
  }
  return { errors, version };
}

if (import.meta.main) {
  const printVersion = Deno.args[0] === "--print-version";
  const { errors, version } = checkVersions(join(import.meta.dirname!, ".."), printVersion ? undefined : Deno.args[0]);
  if (errors.length) {
    console.error(errors.join("\n"));
    Deno.exit(1);
  } else {
    console.log(printVersion ? version : `Version check passed (version: ${version})`);
  }
}
