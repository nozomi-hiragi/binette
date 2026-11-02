// deno-lint-ignore-file no-import-prefix no-unversioned-import
import { Api, App, Last, launch, CadreApi } from "jsr:@binette/replique";
import { appArea, appIcon, buttonOf, column, menuItem, row, show, text, View } from "jsr:@binette/replique/ui";

// 辞書から取った Cadre の API。ボタンのコールバックは関数なので、グローバルで持つ
let cadreApi: CadreApi | null = null;

function goHome(): void {
  const api = cadreApi;
  if (api != null) api.openHome();
}

function switchToApp(index: i32): void {
  const api = cadreApi;
  if (api != null) api.open(index);
}

function closeApp(index: i32): void {
  const api = cadreApi;
  if (api != null) api.close(index);
}

function installBinette(): void {
  const api = cadreApi;
  if (api != null) api.install();
}

/** 名前の最初の文字（コードポイント）。アイコンの無いアプリの札に使う */
function initial(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length == 0) return "?";
  return String.fromCodePoint(trimmed.codePointAt(0)).toUpperCase();
}

class CadreApp extends App {
  override onCreate(_last: Last, api: Api): void {
    cadreApi = api.get<CadreApi>("cadre");
    const cadre = cadreApi;
    if (cadre != null) {
      cadre.openHome();
    }
  }

  override build(): View {
    const api = cadreApi;
    if (api == null) {
      return column([appArea().grow()]).grow().key("cadre-root");
    }

    // 開いているアプリのドック。閉じる操作は × でなく、右クリック・長押しのメニューに置く
    const dock: View[] = [];
    const count = api.count();
    for (let i: i32 = 0; i < count; i++) {
      const name = api.name(i);
      dock.push(
        buttonOf([api.hasIcon(i) ? appIcon(api.appIndex(i)) : text(initial(name))], switchToApp)
          .arg(i)
          .label(name + "を開く")
          .selected(api.isFront(i))
          .tip(name)
          .menu([menuItem("開く", switchToApp).arg(i), menuItem("閉じる", closeApp).arg(i)])
          .key("dock-" + api.appIndex(i).toString()),
      );
    }

    // 左にホーム、中央にドック、右にインストール（ライブモードだけ）。アイコンの見た目は style.css
    const homebar = row([
      buttonOf([], goHome).label("ホームを開く").selected(api.isHome()).tip("ホーム").key("home"),
      // 開いているアプリが無いときは、空の台を見せずに隠す
      show(dock.length > 0, row(dock).key("dock")),
      show(!api.isInstalled(), buttonOf([text("インストール")], installBinette)
        .label("インストール")
        .tip("Binette をインストール")
        .enabled(!api.installBusy())
        .key("install")),
    ]).key("homebar");

    return column([
      appArea().grow().key("cadre-area"),
      homebar,
    ]).grow().key("cadre-root");
  }
}

launch(new CadreApp());
