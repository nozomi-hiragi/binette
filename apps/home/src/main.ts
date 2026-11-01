// deno-lint-ignore-file no-import-prefix no-unversioned-import
import { Api, App, AppsApi, Last, launch } from "jsr:@binette/replique";
import { View, appIcon, buttonOf, column, grid, text } from "jsr:@binette/replique/ui";

// 辞書から取った API。ボタンのコールバックは関数なので、グローバルで持つ
let appsApi: AppsApi | null = null;

function openApp(index: i32): void {
  const api = appsApi;
  if (api == null) return;
  api.open(index);
}

class Home extends App {
  override onCreate(_last: Last, api: Api): void { appsApi = api.get<AppsApi>("apps"); }

  override build(): View {
    const api = appsApi;
    if (api == null) return column([text("アプリの一覧が届いていません。")]).padding(16).key("home-unavailable");
    const tiles: View[] = [];
    for (let i: i32 = 0; i < api.count(); i++) {
      tiles.push(buttonOf([column([appIcon(i), text(api.name(i))]).gap(16)], openApp).arg(i).padding(12).key("home-tile-" + i.toString()));
    }
    return grid(tiles).minWidth(112).gap(16).padding(16).grow().label("アプリ").key("home-grid");
  }
}

launch(new Home());
