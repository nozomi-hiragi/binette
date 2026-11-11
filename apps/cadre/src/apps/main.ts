// deno-lint-ignore-file no-import-prefix no-unversioned-import
import { Api, App, AppManagerApi, Last } from "jsr:@binette/replique";
import { View, badge, button, buttonOf, chip, column, image, input, row, show, spinner, tabs, text } from "jsr:@binette/replique-ui@^0.1";

// 辞書から取った API と画面の状態。ボタンのコールバックは関数なので、グローバルで持つ
let manager: AppManagerApi | null = null;
let tab: i32 = 0;
let detail = "";
let removing = false;
let draft = "";
// 押したボタンの番号から、描いたときのアプリと提供リストを引く。一覧が変わっても別のものを操作しない
let rows: string[] = [];
let repos: string[] = [];

function selectTab(i: i32): void { tab = i; }
function openDetail(i: i32): void {
  const m = manager;
  if (m == null || i < 0 || i >= rows.length) return;
  detail = rows[i];
  removing = false;
  // 埋め込みのアプリは提供リストに無いので、詳細を取りに行かない
  if (m.list(detail).length > 0) m.details(detail);
}
function closeDetail(): void { detail = ""; removing = false; }
function install(): void { const m = manager; if (m != null && detail.length > 0) m.install(detail); }
function reinstall(): void { const m = manager; if (m != null && detail.length > 0) m.reinstall(detail); }
function cancel(): void { const m = manager; if (m != null && detail.length > 0) m.cancel(detail); }
function apply(): void { const m = manager; if (m != null && detail.length > 0) m.apply(detail); }
function askRemove(): void { removing = true; }
function keepApp(): void { removing = false; }
function removeApp(): void { const m = manager; if (m != null && detail.length > 0) m.uninstall(detail, false); removing = false; }
function removeWithData(): void {
  const m = manager;
  if (m == null || detail.length == 0) return;
  const listed = m.list(detail).length > 0 && m.version(detail).length > 0;
  m.uninstall(detail, true);
  removing = false;
  // カタログに無いアプリは、データを消すと一覧から消えるので戻る
  if (!listed) detail = "";
}
function toggleApp(): void { const m = manager; if (m != null && detail.length > 0) m.setAutoUpdateApp(detail, !m.autoUpdateApp(detail)); }
function toggleAll(): void { const m = manager; if (m != null) m.setAutoUpdateAll(!m.autoUpdateAll()); }
function toggleRepo(i: i32): void {
  const m = manager;
  if (m == null || i < 0 || i >= repos.length) return;
  m.setAutoUpdateRepo(repos[i], !m.autoUpdateRepo(repos[i]));
}
function checkRepo(i: i32): void { const m = manager; if (m != null && i >= 0 && i < repos.length) m.checkUpdates(repos[i]); }
function removeRepo(i: i32): void { const m = manager; if (m != null && i >= 0 && i < repos.length) m.removeRepo(repos[i]); }
function checkAll(): void { const m = manager; if (m != null) m.checkUpdates(); }
function updateAll(): void {
  const m = manager;
  if (m == null) return;
  const ids: string[] = [];
  for (let i: i32 = 0; i < m.updateCount(); i++) ids.push(m.updateId("", i));
  for (let i = 0; i < ids.length; i++) m.install(ids[i]);
}
function typeUrl(value: string): void { draft = value; }
function addRepo(): void {
  const m = manager;
  const url = draft.trim();
  if (m == null || url.length == 0) return;
  m.addRepo(url);
  draft = "";
}

function busy(state: string): boolean { return state == "waiting" || state == "fetching" || state == "building" || state == "saving"; }

/** AS の bool を TS の型検査に通す */
function yes(value: bool): boolean { return value ? true : false; }

/** 名前が無ければ、ID の # の後ろを出す */
function nameOf(m: AppManagerApi, id: string): string {
  const name = m.name(id);
  if (name.length > 0) return name;
  const hash = id.lastIndexOf("#");
  return hash >= 0 ? id.slice(hash + 1) : id;
}

function size(bytes: f64): string {
  if (bytes < 1024) return (<i64>bytes).toString() + " B";
  if (bytes < 1024 * 1024) return (Math.round(bytes / 1024 * 10) / 10).toString() + " KB";
  return (Math.round(bytes / 1024 / 1024 * 10) / 10).toString() + " MB";
}

function progressText(m: AppManagerApi, id: string): string {
  const state = m.state(id);
  const counted = m.files(id).toString() + " ファイル・" + size(m.bytes(id));
  if (state == "waiting") return "待っています";
  if (state == "fetching") return "取得中 " + counted;
  if (state == "building") return "ビルド中 " + counted;
  if (state == "saving") return "保存中";
  return "";
}

function stateLabel(m: AppManagerApi, id: string): string {
  const state = m.state(id);
  if (m.removed(id) && !busy(state)) return "データだけ";
  if (m.installedError(id).length > 0 && !busy(state)) return "入れ直してください";
  if (!m.compatible(id) && !busy(state)) return "使えません";
  if (state == "installed") return "入っている";
  if (state == "update") return "更新あり";
  if (state == "prepared") return "適用待ち";
  if (state == "failed") return "失敗";
  if (busy(state)) return progressText(m, id);
  return "入れる";
}

/** アイコン（OS が data URL にしたもの）。まだ届いていない・無いときは名前の頭文字 */
function initial(m: AppManagerApi, id: string, size: i32 = 32): View {
  const icon = m.icon(id);
  if (icon.length > 0) return image(icon).width(size).height(size).key("apps-icon");
  const name = nameOf(m, id).trim();
  return text(name.length > 0 ? String.fromCodePoint(name.codePointAt(0)).toUpperCase() : "?").bold().width(size).key("apps-initial");
}

function appRow(m: AppManagerApi, id: string, tilePrefix: string): View {
  const index = rows.length;
  rows.push(id);
  const state = m.state(id);
  const removed = m.removed(id) && !busy(state);
  const version = removed ? "" : m.installedVersion(id).length > 0 && state != "update" ? m.installedVersion(id) : m.version(id);
  const label = stateLabel(m, id);
  const description = m.description(id);
  const status = state == "update" || state == "prepared" ? badge(label).key("apps-state")
    : busy(state) ? row([spinner(), text(label).small().tone("muted")]).gap(4).key("apps-state")
    : state == "failed" ? text(label).small().tone("danger").key("apps-state")
    : chip(label).tone("muted").key("apps-state");
  const tile = buttonOf([
    initial(m, id),
    column([
      text(nameOf(m, id)).bold().truncate(),
      show(description.length > 0, text(description).small().tone("muted").truncate()),
      show(m.compatibilityError(id).length > 0, text(m.compatibilityError(id)).small().tone("danger")),
      show(m.installedError(id).length > 0, text(m.installedError(id)).small().tone("danger")),
    ]).gap(2).grow(),
    show(version.length > 0, text(version).small().tone("muted").mono()),
    status,
  ], openDetail).variant("ghost").grow().gap(12).arg(index).label(nameOf(m, id) + "（" + label + "）の詳細").key(tilePrefix + index.toString());
  return removed ? tile.tone("muted") : tile;
}

function discover(m: AppManagerApi): View {
  const sections: View[] = [];
  for (let i: i32 = 0; i < m.repoCount(); i++) {
    const url = m.repoUrl(i);
    const state = m.repoState(i);
    const name = m.repoName(i);
    const apps: View[] = [];
    for (let j: i32 = 0; j < m.appCount(url); j++) apps.push(appRow(m, m.appId(url, j), "find-app-"));
    sections.push(column([
      column([
        text(name.length > 0 ? name : m.repoHost(i)).heading(2),
        text(m.repoHost(i)).small().tone("muted"),
      ]).gap(2),
      show(state == "loading", row([spinner(), text("読み込んでいます…").small().tone("muted")]).gap(4)),
      show(yes(state.startsWith("error")), text(state.startsWith("error: ") ? state.slice(7) : "読み込めませんでした。").small().tone("danger")),
      show(apps.length == 0 && state.length == 0, text("アプリはありません。").tone("muted")),
      column(apps).list().surface("card"),
    ]).gap(8).key("find-repo-" + i.toString()));
  }
  if (sections.length == 0) sections.push(text("提供リストがありません。「リスト」で追加してください。").tone("muted"));
  return column(sections).gap(24).key("apps-find");
}

function installed(m: AppManagerApi): View {
  const count = m.updateCount();
  const apps: View[] = [];
  for (let i: i32 = 0; i < m.installedCount(); i++) apps.push(appRow(m, m.installedId(i), "installed-"));
  const all = m.autoUpdateAll();
  return column([
    column([
      text(count > 0 ? "更新が " + count.toString() + " 件あります" : "更新はありません").bold().key("apps-update-count"),
      row([
        button("すべて更新", updateAll).variant("primary").enabled(count > 0).key("apps-update-all"),
        button("更新を確認", checkAll).variant("ghost").key("apps-check-all"),
      ]).gap(8).wrap(),
      row([
        text("すべてのリストを自動更新").grow(),
        button("すべてのリストを自動更新", toggleAll).toggle(yes(all)).key("apps-auto-all"),
      ]).gap(8),
    ]).gap(8).surface("card").key("apps-updates"),
    show(apps.length == 0, text("入っているアプリはありません。").tone("muted")),
    column(apps).list().surface("card").key("apps-installed"),
  ]).gap(16).key("apps-installed-tab");
}

function lists(m: AppManagerApi): View {
  const items: View[] = [];
  for (let i: i32 = 0; i < m.repoCount(); i++) {
    const url = m.repoUrl(i);
    repos.push(url);
    const name = m.repoName(i);
    const state = m.repoState(i);
    const removable = m.repoRemovable(i);
    items.push(column([
      row([
        column([
          text(name.length > 0 ? name : m.repoHost(i)).bold().truncate(),
          text(m.repoHost(i)).small().tone("muted").truncate(),
        ]).gap(2).grow(),
        show(!removable, chip("既定")),
      ]).gap(8),
      show(yes(state.startsWith("error")), text(state.startsWith("error: ") ? state.slice(7) : "読み込めませんでした。").small().tone("danger")),
      row([
        button("更新を確認", checkRepo).arg(i).variant("ghost").enabled(state != "loading").label((name.length > 0 ? name : url) + "の更新を確認"),
        row([
          text("自動更新").small(),
          button((name.length > 0 ? name : url) + "を自動更新", toggleRepo).arg(i).toggle(yes(m.autoUpdateRepo(url))),
        ]).gap(6).grow(),
        show(yes(removable), button("削除", removeRepo).arg(i).variant("ghost").tone("danger").label((name.length > 0 ? name : url) + "を削除")),
      ]).gap(8).wrap(),
    ]).gap(6).padding(12).key("repo-" + i.toString()));
  }
  return column([
    show(items.length == 0, text("提供リストがありません。").tone("muted")),
    column(items).list().surface("card").key("apps-repos"),
    column([
      text("提供リストを追加").bold(),
      row([
        input(draft, typeUrl).placeholder("https://…").label("提供リストの URL").grow().key("apps-repo-url"),
        button("追加", addRepo).variant("primary").enabled(draft.trim().length > 0).key("apps-repo-add"),
      ]).gap(8),
    ]).gap(8).surface("card").key("apps-repo-form"),
  ]).gap(16).key("apps-lists-tab");
}

function details(m: AppManagerApi, id: string): View {
  const state = m.state(id);
  const removed = m.removed(id) && !busy(state);
  const present = !removed && (m.installedVersion(id).length > 0 || m.installedError(id).length > 0);
  const listed = m.version(id).length > 0;
  const progress = busy(state);
  const compatible = m.compatible(id);
  const broken = m.installedError(id).length > 0;
  const host = hostOf(m.list(id));
  const listName = m.listName(id);
  const source = listName.length > 0 ? listName + "（" + host + "）" : host;
  const description = m.description(id);
  const info: View[] = [];
  const ready = m.detailsReady(id);
  const failure = m.detailsError(id);
  if (ready && failure.length == 0) {
    const permissions: View[] = [];
    for (let i: i32 = 0; i < m.permissionCount(id); i++) {
      const reason = m.permissionReason(id, i);
      permissions.push(column([
        text(m.permissionName(id, i)).mono(),
        show(reason.length > 0, text(reason).small().tone("muted")),
      ]).gap(2));
    }
    const roles: string[] = [];
    for (let i: i32 = 0; i < m.roleCount(id); i++) roles.push(m.roleName(id, i));
    info.push(column([text("権限").bold(), show(permissions.length == 0, text("使いません").tone("muted")), column(permissions).gap(8)]).gap(6).key("detail-permissions"));
    if (roles.length > 0) info.push(column([text("役割").bold(), text(roles.join("、"))]).gap(6).key("detail-roles"));
    info.push(column([text("改ざんの検出").bold(), text(m.integrity(id) ? "ハッシュあり" : "ハッシュなし").tone(m.integrity(id) ? "" : "muted")]).gap(6).key("detail-integrity"));
  } else if (failure.length > 0) {
    info.push(text("詳細を取れませんでした: " + failure).small().tone("danger").key("detail-error"));
  } else if (m.list(id).length > 0) {
    info.push(row([spinner(), text("詳細を取っています…").small().tone("muted")]).gap(4).key("detail-loading"));
  }
  const update: View[] = [];
  if (state == "update" || state == "prepared") {
    const added: string[] = [];
    for (let i: i32 = 0; i < m.addedCount(id); i++) added.push(m.addedName(id, i));
    update.push(text("新しい版 " + m.version(id) + (state == "prepared" ? "（準備済み）" : "")).bold());
    if (added.length > 0) update.push(text("増える権限: " + added.join("、")).tone("danger"));
  }
  const actions: View[] = [];
  if (progress) actions.push(button("中止", cancel).variant("ghost").enabled(state != "saving").key("detail-cancel"));
  else if (removing) {
    if (present) actions.push(button("本体だけ消す", removeApp).key("detail-remove-app"));
    actions.push(button("データごと消す", removeWithData).tone("danger").key("detail-remove-data"));
    actions.push(button("やめる", keepApp).variant("ghost").key("detail-remove-cancel"));
  } else {
    if (listed && present && broken) actions.push(button("入れ直す", reinstall).variant("primary").enabled(yes(compatible)).key("detail-reinstall"));
    if (listed && (!present || state == "failed") && state != "prepared" && !broken) actions.push(button(removed ? "入れ直す" : state == "failed" && present ? "もう一度" : "入れる", install).variant("primary").enabled(yes(compatible)).key("detail-install"));
    if (state == "update" && !broken) actions.push(button("更新", install).variant("primary").enabled(yes(compatible)).key("detail-update"));
    if (state == "prepared" && !broken) actions.push(button("適用", apply).variant("primary").enabled(yes(compatible)).key("detail-apply"));
    if (m.removable(id) && (present || removed)) actions.push(button(removed ? "データを消す" : "削除", askRemove).variant("ghost").tone("danger").key("detail-remove"));
  }
  const error = m.error(id);
  return column([
    row([button("戻る", closeDetail).variant("ghost").key("detail-back")]),
    row([
      initial(m, id, 48),
      column([
        text(nameOf(m, id)).heading(1),
        show(source.length > 0, text(source).small().tone("muted")),
      ]).gap(2).grow(),
    ]).gap(12),
    column([
      show(description.length > 0, text(description)),
      text("版 " + (present ? m.installedVersion(id) : m.version(id)) + (removed ? "（データだけ）" : "")).small(),
      text(id).small().mono().tone("muted").key("detail-id"),
    ]).gap(6),
    show(!compatible, text(m.compatibilityError(id)).small().tone("danger").key("detail-compatibility")),
    show(broken, text(m.installedError(id)).small().tone("danger").key("detail-broken")),
    show(update.length > 0, column(update).gap(4).surface("card").key("detail-update-info")),
    show(yes(progress), row([spinner(), text(progressText(m, id)).small()]).gap(6).key("detail-progress")),
    show(state == "failed" && error.length > 0, text(error).small().tone("danger").key("detail-failure")),
    show(removing, text(present ? "本体だけを消すと、データは残ります。入れ直すと引き継ぎます。" : "残っているデータを消します。").small().tone("muted")),
    row(actions).gap(8).wrap().key("detail-actions"),
    show(present && listed, row([
      text("自動更新").grow(),
      button("このアプリを自動更新", toggleApp).toggle(yes(m.autoUpdateApp(id))).key("detail-auto"),
    ]).gap(8).key("detail-auto-row")),
    show(yes(present && listed && m.autoUpdates(id) && !m.autoUpdateApp(id)), text("リストか全体の設定で自動更新しています。").small().tone("muted")),
    column(info).gap(16).surface("card").key("detail-info"),
  ]).gap(16).key("apps-detail");
}

function hostOf(url: string): string {
  const start = url.indexOf("://");
  if (start < 0) return url;
  const rest = url.slice(start + 3);
  const end = rest.indexOf("/");
  return end < 0 ? rest : rest.slice(0, end);
}

export class Apps extends App {
  override onCreate(_last: Last, api: Api): void { manager = AppManagerApi.from(api); }

  override build(): View {
    const m = manager;
    if (m == null) return column([text("アプリ管理を使えません。")]).padding(16).key("apps-unavailable");
    rows = [];
    repos = [];
    if (detail.length > 0) return column([details(m, detail)]).padding(16).key("apps-root");
    const body = tab == 0 ? discover(m) : tab == 1 ? installed(m) : lists(m);
    const updates = m.updateCount();
    return column([
      text("アプリ").heading(1).key("apps-title"),
      tabs(["探す", updates > 0 ? "入っている（" + updates.toString() + "）" : "入っている", "リスト"], tab, selectTab).key("apps-tabs"),
      body,
    ]).gap(16).padding(16).key("apps-root");
  }
}
