import { apps, document, Element, Event } from "jsr:@binette/replique";

const indices = new Map<Element, i32>();

export function start(): void {
  const tiles = document.getElementById("tiles");
  tiles.textContent = "";
  indices.clear();
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
    indices.set(tile, i);
    tile.addEventListener("click", openApp);
    tiles.appendChild(tile);
  }
}

function openApp(event: Event): void {
  if (indices.has(event.currentTarget)) apps.open(indices.get(event.currentTarget));
}
