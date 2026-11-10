// deno-lint-ignore-file no-import-prefix no-unversioned-import
import { Api, App, Last, CadreApi } from "jsr:@binette/replique";
import { appArea, appIcon, button, buttonOf, column, input, menuItem, row, show, text, View } from "jsr:@binette/replique/ui";

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

// The shared input handler keeps one notification action reply active at a time.
let replyNotification: i32 = -1;
let replyAction = "";
let replyDraft = "";
let actionNotifications: i32[] = [];
let actionIds: string[] = [];
let actionInputs: bool[] = [];

function openNotification(id: i32): void {
  const api = cadreApi;
  if (api != null) api.notificationOpen(id);
}
function dismissNotification(id: i32): void {
  const api = cadreApi;
  if (api != null) api.notificationDismiss(id);
  if (replyNotification == id) cancelReply();
}
function chooseAction(index: i32): void {
  const api = cadreApi;
  if (api == null || index < 0 || index >= actionIds.length) return;
  const id = actionNotifications[index];
  const action = actionIds[index];
  if (actionInputs[index]) {
    replyNotification = id;
    replyAction = action;
    replyDraft = "";
  } else {
    api.notificationReply(id, action, "");
  }
}
function editReply(value: string): void { replyDraft = value; }
function cancelReply(): void {
  replyNotification = -1;
  replyAction = "";
  replyDraft = "";
}
function sendReply(): void {
  const api = cadreApi;
  if (api != null && replyNotification >= 0) api.notificationReply(replyNotification, replyAction, replyDraft);
  cancelReply();
}

/** 名前の最初の文字（コードポイント）。アイコンの無いアプリの札に使う */
function initial(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length == 0) return "?";
  return String.fromCodePoint(trimmed.codePointAt(0)).toUpperCase();
}

export class CadreApp extends App {
  override onCreate(_last: Last, api: Api): void {
    cadreApi = CadreApi.from(api);
    const cadre = cadreApi;
    // 起動し直したときに開いているアプリがあれば、前面をそのままにする（アプリを入れたあとなど）
    if (cadre != null && cadre.count() == 0) {
      cadre.openHome();
    }
  }

  override build(): View {
    const api = cadreApi;
    if (api == null) {
      return column([appArea().grow()]).grow().key("cadre-root");
    }

    const notifications: View[] = [];
    actionNotifications = [];
    actionIds = [];
    actionInputs = [];
    let replyFound = false;
    for (let i: i32 = 0; i < api.notificationCount(); i++) {
      const id = api.notificationId(i);
      const title = api.notificationTitle(i);
      const body = api.notificationBody(i);
      const actionCount = api.notificationActionCount(i);
      const content: View[] = [
        text(api.notificationFrom(i)).small().tone("muted"),
        actionCount == 0
          ? buttonOf([text(title).heading(2), text(body)], openNotification).arg(id).label(title + "を開く").key("notification-open")
          : column([text(title).heading(2), text(body)]),
      ];
      const actions: View[] = [];
      for (let a: i32 = 0; a < actionCount; a++) {
        const actionId = api.notificationActionId(i, a);
        const label = api.notificationActionLabel(i, a);
        const index = actionIds.length;
        actionNotifications.push(id);
        actionIds.push(actionId);
        actionInputs.push(api.notificationActionInput(i, a));
        actions.push(button(label, chooseAction).arg(index).key("notification-action-" + actionId));
        if (replyNotification == id && replyAction == actionId) {
          replyFound = true;
          content.push(input(replyDraft, editReply).placeholder(api.notificationActionPlaceholder(i, a)).label(label).key("notification-reply-input"));
          content.push(row([button("送信", sendReply).variant("primary"), button("キャンセル", cancelReply)]).key("notification-reply-controls"));
        }
      }
      actions.push(button("閉じる", dismissNotification).arg(id).variant("ghost").label("通知を閉じる"));
      content.push(row(actions).key("notification-actions"));
      notifications.push(column(content).surface("card").key("notification-" + id.toString()));
    }
    if (!replyFound && replyNotification >= 0) cancelReply();

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
      show(notifications.length > 0, column(notifications).label("通知").key("notifications")),
      homebar,
    ]).grow().key("cadre-root");
  }
}

