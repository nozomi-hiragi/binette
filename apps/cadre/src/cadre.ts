// deno-lint-ignore-file no-import-prefix no-unversioned-import
import { Api, App, Last, CadreApi, StorageApi } from "jsr:@binette/replique";
import { appArea, appIcon, badge, button, buttonOf, column, dropArea, input, menuItem, row, show, stack, text, View } from "jsr:@binette/replique-ui@^0.1";
import { defaultLayout, moveInLayout, parseLayout, partSlot, SLOTS, serializeLayout, Layout } from "./layout.ts";

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

let centerOpen = false;
function toggleCenter(): void { centerOpen = !centerOpen; }
function closeCenter(): void { centerOpen = false; }
function openHistory(): void {
  centerOpen = false;
  const api = cadreApi;
  if (api != null) api.openSettings();
}
function dismissAll(): void {
  const api = cadreApi;
  if (api == null) return;
  for (let i: i32 = 0; i < api.notificationCount(); i++) api.notificationDismiss(api.notificationId(i));
  cancelReply();
}
function countLabel(value: i32): string { return value >= 100 ? "99+" : value.toString(); }
function withBadge(view: View, count: i32, key: string): View {
  const children: View[] = [view];
  if (count > 0) children.push(badge(countLabel(count)).align("topEnd").key(key));
  return stack(children);
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
  centerOpen = false;
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
    cancelReply();
    api.notificationKeep(id, true);
    replyNotification = id;
    replyAction = action;
    replyDraft = "";
  } else {
    api.notificationReply(id, action, "");
  }
}
function editReply(value: string): void { replyDraft = value; }
function cancelReply(): void {
  const api = cadreApi;
  if (api != null && replyNotification >= 0) api.notificationKeep(replyNotification, false);
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

// 置き場の並び。起動したときに保存領域から読むので、既定の並びから跳ばない
const LAYOUT_KEY = "cadre.layout";
let storageApi: StorageApi | null = null;
let layout: Layout = defaultLayout();
let editing = false;

function startEdit(): void { editing = true; centerOpen = false; }
function endEdit(): void { editing = false; }
function resetLayout(): void {
  layout = defaultLayout();
  const storage = storageApi;
  if (storage != null) storage.remove(LAYOUT_KEY);
}
function saveLayout(): void {
  const storage = storageApi;
  if (storage != null) storage.write(LAYOUT_KEY, serializeLayout(layout));
}
/** JSON の文字列の値。Décor が JSON.stringify で作る名前だけを読むので、エスケープは扱わない */
function jsonText(value: string, name: string): string {
  const mark = '"' + name + '":"';
  const start = value.indexOf(mark);
  if (start < 0) return "";
  const from = start + mark.length;
  const end = value.indexOf('"', from);
  return end < 0 ? "" : value.substring(from, end);
}
function jsonInt(value: string, name: string): i32 {
  const mark = '"' + name + '":';
  const start = value.indexOf(mark);
  if (start < 0) return -1;
  let result: i32 = 0;
  let digits = 0;
  for (let i = start + mark.length; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 48 || code > 57) break;
    result = result * 10 + (code - 48);
    digits++;
  }
  return digits > 0 ? result : -1;
}
/** Décor の dropArea から届く。落とした部品を置き場に入れて保存する。Escape で編集を終える */
function onLayout(value: string): void {
  if (!editing) return;
  const type = jsonText(value, "type");
  if (type == "escape") { endEdit(); return; }
  if (type != "drop") return;
  const next = moveInLayout(layout, jsonText(value, "item"), jsonText(value, "zone"), jsonInt(value, "index"));
  if (next === null) return;
  layout = next!;
  saveLayout();
}
function noop(): void {}
function noopAt(_index: i32): void {}

/** 時計の「時:分」を時と分に分ける */
function clockPart(value: string, hour: bool): string {
  const colon = value.indexOf(":");
  if (colon < 0) return hour ? value : "";
  return hour ? value.substring(0, colon) : value.substring(colon + 1);
}

export class CadreApp extends App {
  override onCreate(_last: Last, api: Api): void {
    cadreApi = CadreApi.from(api);
    storageApi = StorageApi.from(api);
    const storage = storageApi;
    if (storage != null) {
      const saved = storage.read(LAYOUT_KEY);
      if (saved !== null) {
        // 壊れた値は読み捨てて既定に戻す
        const parsed: Layout | null = parseLayout(saved!);
        if (parsed !== null) layout = parsed!;
        else storage.remove(LAYOUT_KEY);
      }
    }
    const cadre = cadreApi;
    // 起動し直したときに開いているアプリがあれば、前面をそのままにする（アプリを入れたあとなど）
    if (cadre != null && cadre.count() == 0) {
      cadre.openHome();
    }
  }

  /** 部品。vertical は ml・mr の縦表示、prefix は狭い幅で下中央に写す分の key の頭 */
  part(api: CadreApi, name: string, vertical: bool, prefix: string): View {
    if (name == "home") {
      return buttonOf([], editing ? noop : goHome).label("ホームを開く").selected(api.isHome()).tip("ホーム")
        .menu([menuItem("レイアウトを編集", startEdit)]).draggable("home").key(prefix + "home");
    }
    if (name == "dock") {
      // 開いているアプリのドック。閉じる操作は × でなく、右クリック・長押しのメニューに置く
      const dock: View[] = [];
      const count = api.count();
      for (let i: i32 = 0; i < count; i++) {
        const app = api.name(i);
        dock.push(
          buttonOf([withBadge(api.hasIcon(i) ? appIcon(api.appIndex(i)) : text(initial(app)), api.unread(i), "dock-badge")], editing ? noopAt : switchToApp)
            .arg(i)
            .label(app + "を開く")
            .selected(api.isFront(i))
            .tip(app)
            .menu([menuItem("開く", switchToApp).arg(i), menuItem("閉じる", closeApp).arg(i)])
            .key("dock-" + api.appIndex(i).toString()),
        );
      }
      if (dock.length == 0 && editing) dock.push(text("ドック").small().tone("muted").key("dock-empty"));
      return show(dock.length > 0, (vertical ? column(dock) : row(dock)).label("開いているアプリ").draggable("dock").key(prefix + "dock"));
    }
    const total = api.unreadTotal();
    const time = api.clock();
    const face: View = vertical ? column([text(clockPart(time, true)), text(clockPart(time, false))]).key("clock-lines") : text(time);
    return buttonOf([withBadge(face, total, "clock-badge")], editing ? noop : toggleCenter).label(centerOpen ? "通知を閉じる" : "通知を開く").selected(centerOpen)
      .draggable("clock").key(prefix + "clock");
  }

  /** 置き場の枠。部品が見えなければ出さない。編集中は空の置き場も、落とす先として出す */
  frame(api: CadreApi, slot: i32): View | null {
    const name = SLOTS[slot];
    const vertical = name == "ml" || name == "mr";
    const parts: View[] = [];
    let visible = false;
    // 狭い幅では、左右中央の部品を下中央に横表示で写す（保存した並びは変えない）。編集中は写さない
    if (name == "bc" && !editing) for (let i = 0; i < layout[3].length; i++) parts.push(this.part(api, layout[3][i], false, "narrow-"));
    for (let i = 0; i < layout[slot].length; i++) {
      const part = layout[slot][i];
      if (part != "dock" || api.count() > 0) visible = true;
      parts.push(this.part(api, part, vertical, ""));
    }
    if (name == "bc" && !editing) for (let i = 0; i < layout[4].length; i++) parts.push(this.part(api, layout[4][i], false, "narrow-"));
    if (!editing && parts.length == 0) return null;
    const frame = (vertical ? column(parts) : row(parts)).reserve(name);
    if (editing) return frame.dropZone(name).label(name).key("frame-" + name);
    // 下中央に見える部品が無く、写した分だけのときは、狭い幅でだけ出す
    if (name == "bc" && !visible && parts.length > layout[6].length) return frame.key("frame-bc-narrow");
    return show(visible, frame).key("frame-" + name);
  }

  override build(): View {
    const api = cadreApi;
    if (api == null) {
      return dropArea([appArea().key("cadre-area")], onLayout).key("cadre-root");
    }
    // フルスクリーンのあいだは時計の枠が退くので、通知センターも閉じる
    if (api.isFullscreen()) centerOpen = false;
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
        row([
          api.notificationAppIndex(i) >= 0 ? appIcon(api.notificationAppIndex(i)) : text(""),
          text(api.notificationName(i)).small().tone("muted").grow(),
          text(api.notificationTime(i)).small().tone("muted"),
        ]).key("notification-header"),
        buttonOf([text(title).heading(2), text(body)], openNotification).arg(id).label(title + "を開く").key("notification-open"),
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
      if (centerOpen || api.notificationPopup(i)) notifications.push(column(content).surface("card").key("notification-" + id.toString()));
    }
    if (!replyFound && replyNotification >= 0) cancelReply();

    const total = api.unreadTotal();
    const centerContent: View[] = [
      row([
        text("通知").heading(2).grow(),
        button("すべて閉じる", dismissAll).enabled(total > 0).key("notifications-dismiss-all"),
        button("履歴", openHistory).key("notifications-history"),
      ]).key("notifications-toolbar"),
    ];
    if (notifications.length == 0) centerContent.push(text("新しい通知はありません").key("notifications-empty"));
    for (let i = 0; i < notifications.length; i++) centerContent.push(notifications[i]);

    const children: View[] = [appArea().key("cadre-area")];
    for (let slot: i32 = 0; slot < SLOTS.length; slot++) {
      const frame = this.frame(api, slot);
      if (frame !== null) children.push(frame!);
    }
    // 通知センターとポップアップは、時計を置いた置き場の近くから出す
    const clockSlot = partSlot(layout, "clock");
    children.push(show(centerOpen, buttonOf([], closeCenter).label("通知センターを閉じる").key("notifications-backdrop")));
    children.push(column([
      show(centerOpen, column(centerContent).label("通知").key("notifications-center")),
      show(!centerOpen && notifications.length > 0, column(notifications).label("通知").key("notifications")),
    ]).key("notice-" + (clockSlot >= 0 ? SLOTS[clockSlot] : "br")));
    if (editing) {
      children.push(column([
        text("レイアウトを編集").heading(2).key("layout-title"),
        text("部品をドラッグして置き場を変えます").small().tone("muted"),
        row([button("完了", endEdit).variant("primary").key("layout-done"), button("最初の並びに戻す", resetLayout).key("layout-reset")]).key("layout-actions"),
      ]).label("レイアウトの編集").key("layout-controls"));
    }
    return dropArea(children, onLayout).key("cadre-root");
  }
}
