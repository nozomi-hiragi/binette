import { document } from "jsr:@binette/replique";

export function start(): void {
  document.getElementById("details").addEventListener("click", () => showDetails());
}

function showDetails(): void {
  document.getElementById("description").textContent = "ブラウザだけで動く、アプリの土台です。";
}
