import { apps } from "jsr:@binette/replique";
import { tiles } from "./bina";

export function start(): void {
  tiles.clear();
  for (let i: i32 = 0; i < apps.count(); i++) {
    const tile = tiles.add();
    tile.elem("name").text = apps.name(i);
    tile.icon(i);
  }
}

export function openApp(row: i32): void {
  apps.open(row);
}
