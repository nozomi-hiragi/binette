// 公開するパッケージのバージョンと設定がそろっているかを、テストや公開の前に確かめる。
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PUBLISHED: Record<string, string> = {
  "packages/core": "@binette/core",
  "packages/regie": "@binette/regie",
  "packages/scene": "@binette/scene",
  "packages/coulisses": "@binette/coulisses",
  "packages/replique": "@binette/replique",
};
const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
export const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

export interface CheckResult {
  errors: string[];
  version: string | null;
}

/** バージョンの一致、private の有無、内部依存の固定、LICENSE の一致を調べる。`expectedTag` を渡すとタグとも照らし合わせる */
export function checkVersions(root: string, expectedTag?: string): CheckResult {
  const errors: string[] = [];
  const names = new Set(Object.values(PUBLISHED));
  const versions = new Set<string>();
  for (const [dir, name] of Object.entries(PUBLISHED)) {
    for (const file of ["package.json", "jsr.json"]) {
      const path = join(root, dir, file);
      if (!existsSync(path)) {
        errors.push(`${dir}/${file}: missing`);
        continue;
      }
      const pkg = readJson(path);
      if (pkg.name !== name) errors.push(`${dir}/${file}: expected name ${name}`);
      if (typeof pkg.version !== "string" || !VERSION.test(pkg.version)) errors.push(`${dir}/${file}: expected a plain X.Y.Z version`);
      else versions.add(pkg.version);
      if (file === "package.json" && pkg.private === true) errors.push(`${dir}/${file}: must not have "private": true`);
    }
  }
  const version = versions.size === 1 ? [...versions][0]! : null;
  if (versions.size !== 1) errors.push(`Version mismatch across packages: ${[...versions].join(", ")}`);
  if (expectedTag !== undefined) {
    if (!expectedTag.startsWith("v") || !VERSION.test(expectedTag.slice(1))) errors.push(`Tag format unrecognized: ${expectedTag} (expected vX.Y.Z)`);
    else if (expectedTag.slice(1) !== version) errors.push(`Tag version ${expectedTag.slice(1)} does not match package version ${version}`);
  }

  const root_ = readJson(join(root, "package.json"));
  if (root_.private !== true) errors.push(`package.json: must have "private": true`);
  for (const dir of [".", ...Object.keys(PUBLISHED)]) {
    const pkg = readJson(join(root, dir, "package.json"));
    for (const section of DEPENDENCY_SECTIONS) {
      const deps = pkg[section] as Record<string, string> | undefined;
      for (const [name, value] of Object.entries(deps ?? {})) {
        if (names.has(name) && value !== version) errors.push(`${dir}/package.json: ${section} ${name} is ${value}, expected ${version}`);
      }
    }
    if (dir === ".") continue;
    const imports = readJson(join(root, dir, "jsr.json")).imports as Record<string, unknown> | undefined;
    for (const [alias, target] of Object.entries(imports ?? {})) {
      if (names.has(alias) && target !== `jsr:${alias}@${version}`) {
        errors.push(`${dir}/jsr.json: import ${alias} is ${String(target)}, expected jsr:${alias}@${version}`);
      }
    }
  }

  const license = readFileSync(join(root, "LICENSE"));
  for (const dir of Object.keys(PUBLISHED)) {
    const path = join(root, dir, "LICENSE");
    if (!existsSync(path)) errors.push(`${dir}/LICENSE: missing`);
    else if (!license.equals(readFileSync(path))) errors.push(`${dir}/LICENSE: differs from root LICENSE`);
  }
  return { errors, version };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const printVersion = process.argv[2] === "--print-version";
  const { errors, version } = checkVersions(fileURLToPath(new URL("..", import.meta.url)), printVersion ? undefined : process.argv[2]);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(printVersion ? version : `Version check passed (version: ${version})`);
  }
}
