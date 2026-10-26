import { count } from "./bina";

let value = 0;

export function start(): void {
  count.text = "0";
}

export function increment(): void {
  value++;
  count.text = value.toString();
}
