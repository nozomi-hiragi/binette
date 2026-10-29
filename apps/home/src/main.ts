import { App, apps, launch } from "jsr:@binette/replique";
import { View, appIcon, buttonOf, column, grid, text } from "jsr:@binette/replique/ui";

function openApp(index: i32): void { apps.open(index); }

class Home extends App {
  build(): View {
    const tiles: View[] = [];
    for (let i: i32 = 0; i < apps.count(); i++) {
      tiles.push(buttonOf([column([appIcon(i), text(apps.name(i))]).gap(16)], openApp).arg(i).padding(12).key("home-tile-" + i.toString()));
    }
    return grid(tiles).minWidth(112).gap(16).padding(16).grow().label("アプリ").key("home-grid");
  }
}

launch(new Home());
