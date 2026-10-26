import { elem } from "jsr:@binette/replique";

let count = 0;

export function start(): void {
  elem("count").text = "0";
}

export function increment(): void {
  count++;
  elem("count").text = count.toString();
}
