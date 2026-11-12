import type { Appearance } from "@binette/regie";

const KEY = "binette.appearance";
const THEMES = ["", "light", "dark"];

/** 見た目の設定を入口のページに付ける。色と壁紙の中身は index.html の CSS が番号から決める */
export function applyAppearance(root: HTMLElement, appearance: Appearance): void {
  const theme = THEMES[appearance.theme] ?? "";
  if (theme) root.dataset.theme = theme;
  else delete root.dataset.theme;
  for (const name of ["accent", "wallpaper"] as const) {
    if (appearance[name] > 0) root.dataset[name] = String(appearance[name]);
    else delete root.dataset[name];
  }
}

/** 設定を読む前の起動画面でも同じ見た目にするため、前回の値を覚えておく */
export function rememberAppearance(storage: Pick<Storage, "setItem">, appearance: Appearance): void {
  try { storage.setItem(KEY, JSON.stringify(appearance)); } catch { /* 保存できなくても表示は続ける */ }
}

/** 覚えておいた見た目。無い・壊れているときは undefined */
export function recallAppearance(storage: Pick<Storage, "getItem">): Appearance | undefined {
  try {
    const value: unknown = JSON.parse(storage.getItem(KEY) ?? "null");
    if (typeof value !== "object" || value === null) return undefined;
    const { theme, accent, wallpaper } = value as Record<string, unknown>;
    const valid = (n: unknown, max: number): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max;
    return valid(theme, 2) && valid(accent, 255) && valid(wallpaper, 255) ? { theme, accent, wallpaper } : undefined;
  } catch { return undefined; }
}
