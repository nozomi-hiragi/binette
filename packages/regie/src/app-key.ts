import { formatAppId } from "@binette/core";

/** 入手元と識別子から完全な ID を作る。埋め込みの旧い . 付き ID は PR 3 まで保つ */
export function appId(source: string, id: string): string {
  if (source === "binette:system" || source === "binette:bundled") {
    // 既存の埋め込みアプリの名前は次の PR で改める。URL を名乗ることは許さない。
    if (id.includes(":") || id === "") throw new Error("埋め込みアプリの ID が不正です。");
    if (["cadre", "home", "settings", "designer"].some(name => id === `io.github.nozomi-hiragi.binette.${name}`)) return id;
    return formatAppId({ id });
  }
  return formatAppId({ list: source, id });
}
