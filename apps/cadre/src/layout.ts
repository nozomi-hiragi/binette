/** Cadre の部品の並び。置き場は 8 か所で、各置き場に部品の名前を並びの順に持つ */
export type Layout = Array<Array<string>>;

/** 置き場の名前。t・m・b は上・中・下、l・c・r は左・中・右。番号は Layout の添字 */
export const SLOTS: string[] = ["tl", "tc", "tr", "ml", "mr", "bl", "bc", "br"];
/** 部品の名前。3 つとも必ずどこかに置く */
export const PARTS: string[] = ["home", "dock", "clock"];

function emptyLayout(): Layout {
  const layout: Layout = [];
  for (let i = 0; i < SLOTS.length; i++) layout.push(new Array<string>());
  return layout;
}

/** 最初の並び。ホームは左下、ドックは下中央、時計は右下 */
export function defaultLayout(): Layout {
  const layout = emptyLayout();
  layout[5].push("home");
  layout[6].push("dock");
  layout[7].push("clock");
  return layout;
}

/** 保存する形。部品のある置き場だけを `置き場=部品,部品` にして `;` でつなぐ（例: `bl=home;bc=dock;br=clock`） */
export function serializeLayout(layout: Layout): string {
  let result = "";
  for (let i = 0; i < SLOTS.length; i++) {
    if (layout[i].length == 0) continue;
    if (result.length > 0) result += ";";
    result += SLOTS[i] + "=" + layout[i].join(",");
  }
  return result;
}

/** 保存した形を読む。知らない置き場や部品、重なり、足りない部品があれば null */
export function parseLayout(value: string): Layout | null {
  const layout = emptyLayout();
  const seen: string[] = [];
  const groups = value.split(";");
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    const equal = group.indexOf("=");
    if (equal < 0) return null;
    const slot = SLOTS.indexOf(group.substring(0, equal));
    if (slot < 0 || layout[slot].length > 0) return null;
    const names = group.substring(equal + 1).split(",");
    for (let n = 0; n < names.length; n++) {
      const name = names[n];
      if (!PARTS.includes(name) || seen.includes(name)) return null;
      seen.push(name);
      layout[slot].push(name);
    }
  }
  return seen.length == PARTS.length ? layout : null;
}

/** 部品を置いた置き場の番号。無ければ -1 */
export function partSlot(layout: Layout, part: string): i32 {
  for (let i = 0; i < layout.length; i++) if (layout[i].includes(part)) return i;
  return -1;
}

/** 部品を置き場の並びの index 番目（動かす部品を除いた並びでの位置）に移した新しい並び。知らない名前なら null */
export function moveInLayout(layout: Layout, part: string, zone: string, index: i32): Layout | null {
  const target = SLOTS.indexOf(zone);
  if (target < 0 || !PARTS.includes(part)) return null;
  const next = emptyLayout();
  for (let i = 0; i < layout.length; i++) for (let j = 0; j < layout[i].length; j++) if (layout[i][j] != part) next[i].push(layout[i][j]);
  const row = next[target];
  const at = index < 0 || index > row.length ? row.length : index;
  const placed = new Array<string>();
  for (let j = 0; j < row.length; j++) {
    if (j == at) placed.push(part);
    placed.push(row[j]);
  }
  if (at == row.length) placed.push(part);
  next[target] = placed;
  return next;
}
