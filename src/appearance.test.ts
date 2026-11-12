import { assertEquals } from "@std/assert";
import { Window } from "happy-dom";
import { applyAppearance, recallAppearance, rememberAppearance } from "./appearance.ts";

Deno.test("見た目の設定は data-theme・data-accent・data-wallpaper に付け、既定の 0 では外す", () => {
  const root = new Window().document.documentElement as unknown as HTMLElement;
  applyAppearance(root, { theme: 2, accent: 3, wallpaper: 1 });
  assertEquals([root.dataset.theme, root.dataset.accent, root.dataset.wallpaper], ["dark", "3", "1"]);
  applyAppearance(root, { theme: 1, accent: 0, wallpaper: 0 });
  assertEquals([root.dataset.theme, root.dataset.accent, root.dataset.wallpaper], ["light", undefined, undefined]);
  applyAppearance(root, { theme: 0, accent: 0, wallpaper: 0 });
  assertEquals(root.hasAttribute("data-theme"), false);
});

Deno.test("覚えた見た目は範囲を確かめて返し、壊れた値は捨てる", () => {
  const items = new Map<string, string>();
  const storage = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); } };
  assertEquals(recallAppearance(storage), undefined);
  rememberAppearance(storage, { theme: 2, accent: 4, wallpaper: 5 });
  assertEquals(recallAppearance(storage), { theme: 2, accent: 4, wallpaper: 5 });
  items.set("binette.appearance", '{"theme":3,"accent":0,"wallpaper":0}');
  assertEquals(recallAppearance(storage), undefined);
  items.set("binette.appearance", "{");
  assertEquals(recallAppearance(storage), undefined);
});
