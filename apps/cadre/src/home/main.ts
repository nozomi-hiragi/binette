// deno-lint-ignore-file no-import-prefix no-unversioned-import
import { Api, App, AppsApi, Last } from "jsr:@binette/replique";
import { View, appIcon, badge, buttonOf, column, grid, image, stack, text } from "jsr:@binette/replique-ui@^0.1";

// 辞書から取った API。ボタンのコールバックは関数なので、グローバルで持つ
let appsApi: AppsApi | null = null;

function openApp(index: i32): void {
  const api = appsApi;
  if (api == null) return;
  api.open(index);
}

function installBinette(): void {
  const api = appsApi;
  if (api != null) api.install();
}
function countLabel(value: i32): string { return value >= 100 ? "99+" : value.toString(); }
function iconWithBadge(index: i32, count: i32): View {
  const children: View[] = [appIcon(index)];
  if (count > 0) children.push(badge(countLabel(count)).align("topEnd").key("home-badge"));
  return stack(children);
}

export class Home extends App {
  override onCreate(_last: Last, api: Api): void { appsApi = AppsApi.from(api); }

  override build(): View {
    const api = appsApi;
    if (api == null) return column([text("アプリの一覧が届いていません。")]).padding(16).key("home-unavailable");
    const tiles: View[] = [];
    for (let i: i32 = 0; i < api.count(); i++) {
      tiles.push(buttonOf([column([iconWithBadge(i, api.unread(i)), text(api.name(i))]).gap(16)], openApp).arg(i).padding(12).key("home-tile-" + i.toString()));
    }
    if (!api.isInstalled()) tiles.push(buttonOf([column([image("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20128%20128%22%3E%0A%20%20%3Crect%20width%3D%22128%22%20height%3D%22128%22%20rx%3D%2228%22%20fill%3D%22%233273b9%22%2F%3E%0A%20%20%3Cpath%20d%3D%22M38%2027h28c17%200%2027%208%2027%2021%200%208-4%2014-11%2017%2010%203%2015%209%2015%2018%200%2015-11%2024-30%2024H38V27zm16%2014v18h11c8%200%2012-3%2012-9s-4-9-12-9H54zm0%2032v20h12c10%200%2015-3%2015-10s-5-10-15-10H54z%22%20fill%3D%22%23fff%22%2F%3E%0A%3C%2Fsvg%3E").label(""), text("インストール")]).gap(16)], installBinette).enabled(!api.installBusy()).padding(12).key("install-tile"));
    return grid(tiles).minWidth(112).gap(16).padding(16).grow().label("アプリ").key("home-grid");
  }
}

