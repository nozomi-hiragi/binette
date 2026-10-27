import { App, document, Last, launch } from "jsr:@binette/replique";

class Settings extends App {
  onCreate(_last: Last): void {
    document.getElementById("details").addEventListener("click", () => settings.showDetails());
  }

  showDetails(): void {
    document.getElementById("description").textContent = "ブラウザだけで動く、アプリの土台です。";
  }
}

const settings = new Settings();
launch(settings);
