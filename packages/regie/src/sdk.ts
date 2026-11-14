import { BinetteError } from "@binette/core";

/** Réplique の公開機能。fs は API の予約だけで、ホストの呼び出し口を持たない。 */
export const REPLIQUE_FEATURES = ["app", "dom", "ui", "storage", "pigeon", "shares", "os", "apps", "manager", "scheduler", "schedule", "net", "cadre", "fs"] as const;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?![\s\S])/;

/** 配布目録には機能ごとに、実際に収録したパッケージの完全な版を書く。 */
export function parseRepliqueVersions(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== REPLIQUE_FEATURES.length ||
    !REPLIQUE_FEATURES.every(feature => Object.hasOwn(value, feature) && typeof (value as Record<string, unknown>)[feature] === "string" && versionPattern.test((value as Record<string, string>)[feature]))) {
    throw new Error("Invalid Réplique feature index: 機能名と X.Y.Z の版の辞書が必要です。");
  }
  return value as Record<string, string>;
}

/** libraries の完全な指定子から、配布する機能と版の辞書を作る。 */
export function repliqueVersions(libraries: Record<string, string>): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const specifier of Object.keys(libraries)) {
    if (!specifier.startsWith("jsr:@binette/replique-")) continue;
    const match = /^jsr:@binette\/replique-([a-z][a-z0-9-]*)@(.+)$/.exec(specifier);
    if (!match || !versionPattern.test(match[2]) || Object.hasOwn(versions, match[1])) throw new Error(`Réplique の提供版が不正です: ${specifier}`);
    versions[match[1]] = match[2];
  }
  return versions;
}

/** exact と ^・~ の範囲。省略した minor・patch は範囲指定のときだけ 0 にする。 */
export function satisfiesSdkVersion(version: string, range: string): boolean | undefined {
  const match = /^(\^|~)?(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?$/.exec(range);
  if (!match || match[0] !== range || (!match[1] && (match[3] === undefined || match[4] === undefined)) || !versionPattern.test(version)) return undefined;
  const lower = [Number(match[2]), Number(match[3] ?? 0), Number(match[4] ?? 0)];
  const actual = version.split(".").map(Number);
  if (![...lower, ...actual].every(Number.isSafeInteger)) return undefined;
  const compare = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  if (!match[1]) return compare(actual, lower) === 0;
  const upper = [...lower];
  const bump = match[1] === "~" ? (match[3] === undefined ? 0 : 1)
    : lower[0] !== 0 || match[3] === undefined ? 0 : lower[1] !== 0 || match[4] === undefined ? 1 : 2;
  upper[bump]++;
  for (let i = bump + 1; i < 3; i++) upper[i] = 0;
  return compare(actual, lower) >= 0 && compare(actual, upper) < 0;
}

/** 要求した範囲を一つの実体へそろえ、異なる指定の App・状態を重複させない。 */
export function resolveSdkSpecifier(specifier: string, versions: Record<string, string>): string {
  if (specifier === "jsr:@binette/replique" || !specifier.startsWith("jsr:@binette/replique")) return specifier;
  // 旧サブパスは版を指定しない互換入口として、提供中の機能と同じ実体へ解決する。
  const legacy = /^jsr:@binette\/replique\/([a-z][a-z0-9-]*)(?![\s\S])/.exec(specifier);
  // 新しい機能指定子も版を省略でき、その場合は提供中の版を使う。
  const unversioned = /^jsr:@binette\/replique-([a-z][a-z0-9-]*)(?![\s\S])/.exec(specifier);
  if (legacy || unversioned) {
    const feature = (legacy ?? unversioned)![1];
    if (!Object.hasOwn(versions, feature)) throw new BinetteError("unsupported_sdk", `この OS は Réplique の機能「${feature}」を提供していません（${legacy ? "互換入口" : "版指定なし"}）。`);
    return `jsr:@binette/replique-${feature}@${versions[feature]}`;
  }
  const match = /^jsr:@binette\/replique-([a-z][a-z0-9-]*)@([^/]+)$/.exec(specifier);
  if (!match || satisfiesSdkVersion("0.1.0", match[2]) === undefined) {
    throw new BinetteError("unsupported_sdk", `Réplique の指定が正しくありません: ${specifier}（版は X.Y.Z、^X.Y、~X.Y などで指定してください）`);
  }
  const [, feature, range] = match;
  const version = Object.hasOwn(versions, feature) ? versions[feature] : undefined;
  if (version === undefined) throw new BinetteError("unsupported_sdk", `この OS は Réplique の機能「${feature}」を提供していません（要求: ${range}）。`);
  if (!satisfiesSdkVersion(version, range)) throw new BinetteError("unsupported_sdk", `この OS の SDK ではビルドできません（${feature}: 要求 ${range}、提供 ${version}）。`);
  return `jsr:@binette/replique-${feature}@${version}`;
}

/** コメントや文字列の中の import は対象にせず、静的 import・再 export の指定子だけを読む。 */
export function sourceImports(source: string): { start: number; end: number; specifier: string }[] {
  const tokens = /\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|[A-Za-z_$][\w$]*|[^\s]/g;
  const result: { start: number; end: number; specifier: string }[] = [];
  let previous = "";
  for (const token of source.matchAll(tokens)) {
    const text = token[0];
    if (text.startsWith("//") || text.startsWith("/*")) continue;
    if ((previous === "from" || previous === "import") && (text[0] === '"' || text[0] === "'")) {
      const specifier = text.slice(1, -1).replace(/\\(?:u([\da-fA-F]{4})|x([\da-fA-F]{2})|([\s\S]))/g, (_match, unicode, hex, char) =>
        unicode || hex ? String.fromCharCode(parseInt(unicode ?? hex, 16)) : ({ n: "\n", r: "\r", t: "\t" } as Record<string, string>)[char] ?? char);
      result.push({ start: token.index!, end: token.index! + text.length, specifier });
    }
    previous = text;
  }
  return result;
}
