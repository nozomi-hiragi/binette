import { ui } from "jsr:@binette/replique";

let count = 0;

export function start(): void {
  ui.text("count", "0");
}

export function increment(): void {
  count++;
  ui.text("count", count.toString());
}
