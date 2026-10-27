import { App, apps, document, Element, Event, Last, launch } from "jsr:@binette/replique";

class Home extends App {
  private indices: Map<Element, i32> = new Map<Element, i32>();

  onCreate(_last: Last): void {
    const tiles = document.getElementById("tiles");
    tiles.textContent = "";
    this.indices.clear();
    for (let i: i32 = 0; i < apps.count(); i++) {
      const tile = document.createElement("button");
      tile.className = "home-tile";
      const img = document.createElement("img");
      img.className = "home-icon";
      apps.icon(img, i);
      tile.appendChild(img);
      const name = document.createElement("span");
      name.textContent = apps.name(i);
      tile.appendChild(name);
      this.indices.set(tile, i);
      tile.addEventListener("click", (event: Event) => home.openApp(event));
      tiles.appendChild(tile);
    }
  }

  openApp(event: Event): void {
    if (this.indices.has(event.currentTarget)) apps.open(this.indices.get(event.currentTarget));
  }
}

const home = new Home();
launch(home);
