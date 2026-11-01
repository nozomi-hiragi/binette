// deno-lint-ignore-file no-import-prefix no-unversioned-import
import { Api, App, Last, launch, ShellApi } from "jsr:@binette/replique";
import { appArea, appIcon, button, buttonOf, column, row, text, View } from "jsr:@binette/replique/ui";

// 辞書から取ったシェルの API。ボタンのコールバックは関数なので、グローバルで持つ
let shellApi: ShellApi | null = null;

function goHome(): void {
  const api = shellApi;
  if (api != null) api.openHome();
}

function switchToApp(index: i32): void {
  const api = shellApi;
  if (api != null) api.open(index);
}

function closeApp(index: i32): void {
  const api = shellApi;
  if (api != null) api.close(index);
}

function goBack(): void {
  const api = shellApi;
  if (api != null) api.back();
}

function installBinette(): void {
  const api = shellApi;
  if (api != null) api.install();
}

function openSettings(): void {
  const api = shellApi;
  if (api != null) api.openSettings();
}

class ShellApp extends App {
  override onCreate(_last: Last, api: Api): void {
    shellApi = api.get<ShellApi>("shell");
    const shell = shellApi;
    if (shell != null) {
      shell.openHome();
    }
  }

  override build(): View {
    const api = shellApi;
    if (api == null) {
      return column([appArea().grow()]).grow().key("shell-root");
    }

    // 左にホームボタン
    const homeBtn = button("ホーム", goHome)
      .selected(api.isHome())
      .key("shell-home");

    // 中央に開いているアプリのドック
    const dock: View[] = [];
    const count = api.count();
    let frontIndex: i32 = -1;
    for (let i: i32 = 0; i < count; i++) {
      const isFront = api.isFront(i);
      if (isFront) frontIndex = i;
      const label = api.hasIcon(i) ? appIcon(api.appIndex(i)).width(26).height(26) : text(api.name(i));
      dock.push(
        buttonOf([label], switchToApp)
          .arg(i)
          .label(api.name(i) + "を開く")
          .selected(isFront)
          .key("shell-dock-" + i.toString()),
      );
    }

    // 右のボタン群（戻る、閉じる、設定）
    const rightControls: View[] = [];
    if (!api.isHome()) {
      rightControls.push(button("戻る", goBack).key("shell-back"));
      if (frontIndex >= 0) {
        rightControls.push(button("閉じる", closeApp).arg(frontIndex).key("shell-close"));
      }
    }
    // 設定を開くボタン
    rightControls.push(button("設定", openSettings).key("shell-settings"));
    if (!api.isInstalled()) {
      rightControls.push(button("インストール", installBinette)
        .enabled(!api.installBusy())
        .key("shell-install"));
    }

    // ドックとバーのレイアウト
    const barItems: View[] = [homeBtn];
    // ドックは間を埋め、右のボタン群を右端に寄せる
    barItems.push(dock.length > 0 ? row(dock).gap(4).grow().key("shell-dock-row") : row([]).grow().key("shell-spacer"));
    barItems.push(row(rightControls).gap(4).key("shell-right-row"));

    const homebar = row(barItems)
      .gap(8)
      .padding(8)
      .key("shell-bar");

    return column([
      appArea().grow().key("shell-area"),
      homebar,
    ]).grow().key("shell-root");
  }
}

launch(new ShellApp());
