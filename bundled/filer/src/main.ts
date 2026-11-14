// deno-lint-ignore-file no-import-prefix no-unversioned-import
import { App, Api, Last, PigeonApi, SharesApi, StorageApi, launch } from "jsr:@binette/replique";
import { View, column, row, text, button, buttonOf, input, tabs, listTile, menuItem, filePick, image, chip, progress, space } from "jsr:@binette/replique-ui@^0.1";
import { args, Json, parseJson } from "./json.ts";

const base = "/data/filer";
class Entry {
  path: string = ""; name: string = ""; size: string = ""; modified: string = "";
  share: string = ""; sharePath: string = ""; folder: bool = false; marker: bool = false; shareRoot: bool = false;
}
class Pending { constructor(public id: i32, public kind: string, public path: string = "", public extra: string = "") {} }
let shares = new SharesApi(); let storage = new StorageApi(); let pigeon = new PigeonApi();
const pending: Pending[] = []; let entries: Entry[] = []; let sharedEntries: Entry[] = [];
let place = 0; let directory = ""; let selected = -1; let rename = -1; let draft = "";
let confirm = -1; let notice = ""; let capacity = ""; let preview = "ファイルを選ぶと、ここにプレビューが表示されます。";
let capacityFraction: f64 = -1;
let pickFrom = ""; let copySource: Entry | null = null; let newFolder = false; let previewImage = "";
function request(kind: string, values: string[], path: string = "", extra: string = ""): void {
  pending.push(new Pending(shares.request(kind, args(values)), kind, path, extra));
}
function refresh(): void { request("ownList", [base]); request("list", []); request("estimate", []); }
function current(): Entry[] { return place == 0 ? entries : sharedEntries; }
function parent(path: string): string { const i = path.lastIndexOf("/"); return i < 0 ? "" : path.substring(0, i); }
function basename(path: string): string { return path.substring(path.lastIndexOf("/") + 1); }
function clean(name: string): bool { return name.length > 0 && name != "." && name != ".." && name.indexOf("/") < 0 && name.indexOf("\\") < 0; }
function localPath(name: string): string { return base + directory + "/" + name; }
function exists(path: string): bool { for (let i = 0; i < entries.length; i++) if (entries[i].path == path) return true; return false; }
function unique(path: string): string {
  if (!exists(path)) return path;
  const name = basename(path), dot = name.lastIndexOf("."), prefix = path.substring(0, path.length - name.length);
  const stem = dot > 0 ? name.substring(0, dot) : name, ext = dot > 0 ? name.substring(dot) : "";
  let n = 2; let result = ""; do { result = prefix + stem + " (" + n.toString() + ")" + ext; n++; } while (exists(result)); return result;
}
function addParents(out: Entry[], path: string): void {
  let p = parent(path);
  while (p.length > base.length) {
    let found = false; for (let i = 0; i < out.length; i++) if (out[i].path == p) found = true;
    if (!found) { const e = new Entry(); e.path = p; e.name = basename(p); e.folder = true; out.push(e); }
    p = parent(p);
  }
}
function parseOwn(list: Json): void {
  const out: Entry[] = [];
  for (let i = 0; i < list.children.length; i++) {
    const item = list.children[i], path = item.string("path");
    if (!path.startsWith(base + "/")) continue;
    if (basename(path) == ".filer-folder") { addParents(out, path); const dir = parent(path); for (let j = 0; j < out.length; j++) if (out[j].path == dir) out[j].marker = true; continue; }
    const e = new Entry(); e.path = path; e.name = basename(path); e.size = item.string("size"); e.modified = item.string("modified"); e.share = item.string("share"); e.sharePath = item.string("sharePath"); out.push(e); addParents(out, path);
    if (e.share.length > 0) request("fileInfo", [e.share, e.sharePath], e.share, e.sharePath);
  }
  entries = out;
  const oldKeys: string[] = []; for (let i = 0; i < storage.count(); i++) { const key = storage.name(i); if (key.startsWith("filer-ref:")) oldKeys.push(key); }
  for (let i = 0; i < oldKeys.length; i++) {
    const key = oldKeys[i];
    const raw = storage.read(key); if (raw === null) continue;
    const ref = parseJson(raw), path = key.substring(10), id = ref.string("share"), sharedPath = ref.string("path");
    if (id.length == 0 || sharedPath.length == 0) continue;
    let found = false;
    for (let j = 0; j < out.length; j++) if (out[j].path == path) {
      found = true;
      if (out[j].share == id && out[j].sharePath == sharedPath) storage.remove(key);
      else notice = "旧形式の参照と同じ名前のファイルがあります。";
      break;
    }
    if (found) continue;
    let requested = false; for (let j = 0; j < pending.length; j++) if (pending[j].kind == "ownReference" && pending[j].extra == key) requested = true;
    if (!requested) request("ownReference", [path, id, sharedPath], path, key);
  }
}
function changePlace(i: i32): void { place = i; directory = ""; selected = -1; rename = -1; }
function up(): void { if (directory.length > 0) directory = parent(directory); selected = -1; }
function open(i: i32): void {
  const items = current(); if (i < 0 || i >= items.length) return; const e = items[i]; selected = i;
  if (e.folder) { directory = place == 0 ? e.path.substring(base.length) : e.path.substring("/shared".length); selected = -1; return; }
  if (pickFrom.length > 0 && place == 0) { choose(i); return; }
  preview = "読み込み中…"; previewImage = "";
  if (e.share.length > 0) request("readBase64", [e.share, e.sharePath], e.path, "preview");
  else request("ownRead", [e.path], e.path, "preview");
}
function edit(value: string): void { draft = value; }
function folder(): void { newFolder = true; draft = ""; }
function saveFolder(): void {
  if (!clean(draft)) { notice = "フォルダー名を入力してください。"; return; }
  const path = unique(localPath(draft)); request("ownWrite", [path + "/.filer-folder", ""]); newFolder = false; draft = "";
}
function renameSave(): void {
  if (rename < 0 || rename >= current().length || !clean(draft)) { notice = "名前を入力してください。"; return; }
  const e = current()[rename], next = parent(e.path) + "/" + draft;
  if ((e.shareRoot && draft == e.name) || (!e.shareRoot && next == e.path)) { rename = -1; return; }
  if (place == 0 && exists(next)) { notice = "同じ名前があります。"; return; }
  if (place == 1) {
    if (e.shareRoot) {
      for (let i = 0; i < sharedEntries.length; i++) if (sharedEntries[i].shareRoot && sharedEntries[i].share != e.share && sharedEntries[i].name == draft) { notice = "同じ名前があります。"; return; }
      request("folderRename", [e.share, draft]); rename = -1; return;
    }
    if (e.folder) {
      const target = parent(e.sharePath) + "/" + draft;
      for (let i = 0; i < sharedEntries.length; i++) if (sharedEntries[i].share == e.share && sharedEntries[i].sharePath == target) { notice = "同じ名前があります。"; return; }
      request("sharedFolderRename", [e.share, e.sharePath, target]); rename = -1; return;
    }
    const target = parent(e.sharePath) + "/" + draft;
    for (let i = 0; i < sharedEntries.length; i++) if (sharedEntries[i].share == e.share && sharedEntries[i].sharePath == target) { notice = "同じ名前があります。"; return; }
    request("sharedRename", [e.share, e.sharePath, target]);
    rename = -1; return;
  }
  if (place == 0 && e.folder) {
    for (let i = 0; i < entries.length; i++) { const child = entries[i]; if (!child.path.startsWith(e.path + "/")) continue; if (child.folder) { if (child.marker) request("ownMove", [child.path + "/.filer-folder", next + child.path.substring(e.path.length) + "/.filer-folder"]); continue; } const target = next + child.path.substring(e.path.length); request("ownMove", [child.path, target]); }
    if (e.marker) request("ownMove", [e.path + "/.filer-folder", next + "/.filer-folder"]);
  } else if (place == 0) request("ownMove", [e.path, next]);
  rename = -1;
}
function cancel(): void { rename = -1; confirm = -1; newFolder = false; }
function removeConfirmed(): void {
  if (confirm < 0 || confirm >= current().length) return; const e = current()[confirm];
  if (place == 0 && e.folder) {
    for (let i = 0; i < entries.length; i++) { const child = entries[i]; if (!child.path.startsWith(e.path + "/")) continue; if (child.folder) { if (child.marker) request("ownRemove", [child.path + "/.filer-folder"]); continue; } request("ownRemove", [child.path]); }
    if (e.marker) request("ownRemove", [e.path + "/.filer-folder"]);
  } else if (place == 0) request("ownRemove", [e.path]);
  else if (e.shareRoot) request("folderLeave", [e.share]);
  else if (e.folder) request("sharedFolderDelete", [e.share, e.sharePath]);
  else request("sharedDelete", [e.share, e.sharePath]);
  confirm = -1; selected = -1;
}
function action(code: i32): void {
  const i = code / 10, op = code % 10; const items = current(); if (i < 0 || i >= items.length) return; const e = items[i];
  if (op == 0) open(i);
  else if (op == 1) { rename = i; draft = e.name; }
  else if (op == 2 || op == 3) { copySource = e; notice = op == 2 ? "移動先を開いて「ここへ移動」を押してください。" : "コピー先を開いて「ここへコピー」を押してください。"; moveMode = op; }
  else if (op == 4) confirm = i;
  else if (op == 5) { if (e.share.length > 0) request("readBase64", [e.share, e.sharePath], e.name, "export"); else request("ownRead", [e.path], e.name, "export"); }
  else if (op == 6 && place == 0 && !e.folder) {
    if (e.share.length > 0) request("ownShareOff", [e.path]);
    else request("ownShareOn", [e.path, "/" + basename(e.path)], e.path, "on");
  }
}
let moveMode = 0;
function transfer(e: Entry, target: string): void {
  if (e.folder) {
    if (e.marker) { if (moveMode == 2) request("ownMove", [e.path + "/.filer-folder", target + "/.filer-folder"]); else request("ownWrite", [target + "/.filer-folder", ""]); }
    return;
  }
  if (e.share.length > 0) {
    if (moveMode == 2 && e.path.startsWith(base + "/")) request("ownMove", [e.path, target]);
    else if (moveMode == 2) request("ownReference", [target, e.share, e.sharePath]);
    else request("readBase64", [e.share, e.sharePath], target, "copy");
  } else if (moveMode == 2) request("ownMove", [e.path, target]);
  else request("ownRead", [e.path], target, "copy");
}
function paste(): void {
  const e = copySource; if (e === null || place != 0) return;
  if (e.folder && (base + directory).startsWith(e.path + "/")) { notice = "フォルダーの中には移動できません。"; return; }
  const target = unique(localPath(e.name));
  if (e.folder) {
    const source = e.path.startsWith("/shared/") ? sharedEntries : entries;
    for (let i = 0; i < source.length; i++) if (source[i].path.startsWith(e.path + "/")) transfer(source[i], target + source[i].path.substring(e.path.length));
  }
  transfer(e, target); refresh(); copySource = null; notice = "";
}
function imported(value: string): void {
  const files = parseJson(value);
  for (let i = 0; i < files.children.length; i++) { const item = files.children[i], name = item.string("name"); if (clean(name)) { const path = unique(localPath(name)); const e = new Entry(); e.path = path; entries.push(e); request("ownWrite", [path, item.string("data")]); } }
}
function choose(i: i32): void {
  if (i < 0 || i >= entries.length) return; const e = entries[i];
  if (e.share.length > 0) request("pickReply", [pickFrom, e.share, e.sharePath]);
  else request("ownShareOn", [e.path, "/" + basename(e.path)], e.path, "pick");
}
function inbox(): void {
  for (let i = 0; i < pigeon.count(); i++) if (pigeon.kind(i) == "pick") { pickFrom = pigeon.from(i); pigeon.done(i); place = 0; directory = ""; break; }
}
function decode(value: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"; const bytes: u8[] = []; let acc = 0, bits = 0;
  for (let i = 0; i < value.length; i++) { const n = alphabet.indexOf(value.charAt(i)); if (n < 0) break; acc = (acc << 6) | n; bits += 6; if (bits >= 8) { bits -= 8; bytes.push(<u8>((acc >> bits) & 255)); } }
  const array = new Uint8Array(bytes.length); for (let i = 0; i < bytes.length; i++) array[i] = bytes[i]; return String.UTF8.decode(array.buffer);
}
function formatBytes(bytes: f64): string {
  if (bytes < 1024) return (<i64>bytes).toString() + " B";
  let value = bytes / 1024; let unit = "KB";
  if (value >= 1024) { value /= 1024; unit = "MB"; }
  if (value >= 1024) { value /= 1024; unit = "GB"; }
  if (value >= 1024) { value /= 1024; unit = "TB"; }
  const tenths = <i64>Math.round(value * 10);
  return (tenths / 10).toString() + "." + (tenths % 10).toString() + " " + unit;
}
function completed(): void {
  for (let i = pending.length - 1; i >= 0; i--) {
    const p = pending[i], result = shares.result(p.id); if (result === null) continue; pending.splice(i, 1);
    const response = parseJson(result); if (response.string("ok") != "true") { notice = response.string("error"); if (notice.length == 0) notice = "操作できませんでした。"; continue; }
    const value = response.get("value"); if (value === null) continue;
    if (p.kind == "ownList") { parseOwn(value); }
    else if (p.kind == "fileInfo") {
      for (let j = 0; j < entries.length; j++) if (entries[j].share == p.path && entries[j].sharePath == p.extra) { entries[j].size = value.string("size"); entries[j].modified = value.string("modified"); }
      for (let j = 0; j < sharedEntries.length; j++) if (sharedEntries[j].share == p.path && sharedEntries[j].sharePath == p.extra) { sharedEntries[j].size = value.string("size"); sharedEntries[j].modified = value.string("modified"); }
    } else if (p.kind == "estimate") {
      const usageText = value.string("usage"), quotaText = value.string("quota");
      if (usageText.length > 0 && quotaText.length > 0) {
        const usage = F64.parseFloat(usageText), quota = F64.parseFloat(quotaText);
        if (isFinite(usage) && isFinite(quota) && usage >= 0 && quota > 0) { capacity = formatBytes(usage) + " / " + formatBytes(quota) + " 使用中"; capacityFraction = Math.min(1, usage / quota); }
      }
    }
    else if (p.kind == "list") {
      sharedEntries = [];
      for (let j = 0; j < value.children.length; j++) {
        const item = value.children[j], id = item.string("id"); if (id.length == 0 || item.string("filerIsCreator") == "true") continue;
        if (item.string("filerState") == "joined") {
          const root = new Entry(); root.path = "/shared/" + id; root.name = item.string("creatorName"); if (root.name.length == 0) root.name = id; root.folder = true; root.shareRoot = true; root.share = id; sharedEntries.push(root);
          request("files", [id, "/"], id);
        } else if (item.string("filerState") == "invited") request("join", [id]);
      }
    } else if (p.kind == "files") {
      for (let j = 0; j < value.children.length; j++) {
        const path = value.children[j].value; const e = new Entry(); e.path = "/shared/" + p.path + path; e.name = basename(path); e.share = p.path; e.sharePath = path; sharedEntries.push(e); request("fileInfo", [e.share, e.sharePath], e.share, e.sharePath);
        let dir = parent(e.path); while (dir.length > "/shared".length) { let found = false; for (let k = 0; k < sharedEntries.length; k++) if (sharedEntries[k].path == dir) found = true; if (!found) { const folder = new Entry(); folder.path = dir; folder.name = basename(dir); folder.folder = true; folder.share = p.path; folder.sharePath = dir.substring(("/shared/" + p.path).length); sharedEntries.push(folder); } dir = parent(dir); }
      }
    } else if (p.kind == "ownRead" || p.kind == "readBase64") {
      if (p.extra == "preview") {
        const lower = p.path.toLowerCase(); let mime = "";
        if (lower.endsWith(".png")) mime = "png"; else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) mime = "jpeg"; else if (lower.endsWith(".gif")) mime = "gif"; else if (lower.endsWith(".webp")) mime = "webp";
        if (mime.length > 0) { previewImage = "data:image/" + mime + ";base64," + value.value; preview = ""; }
        else if (lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".json") || lower.endsWith(".csv")) preview = decode(value.value).substring(0, 4000);
        else preview = "この形式のプレビューはありません。";
      }
      else if (p.extra == "export") request("export", [p.path, value.value]);
      else if (p.extra == "copy") {
        if (value.kind == "literal" && value.value == "null") notice = "共有ファイルが見つかりません。";
        else request("ownWrite", [p.path, value.value]);
      }

    } else if (p.kind == "ownShareOn") {
      const id = value.string("id"), sharedPath = "/" + basename(p.path);
      if (p.extra == "pick") request("pickReply", [pickFrom, id, sharedPath]);
      refresh();
    } else if (p.kind == "ownReference") {
      if (p.extra.startsWith("filer-ref:")) storage.remove(p.extra);
      refresh();
    } else if (p.kind == "pickReply") { pickFrom = ""; notice = "ファイルを渡しました。"; }
    else if (p.kind != "export") refresh();
  }
}
function placeButtons(): View { return column([text("場所").small().tone("muted").padding(space.sm), button("マイファイル", changePlace).arg(0).variant("ghost").selected(place == 0), button("共有", changePlace).arg(1).variant("ghost").selected(place == 1)]).gap(space.xs).padding(space.sm).width(190).surface("surface").align("top").key("filer-places"); }
function sizeLabel(e: Entry): string { if (e.folder) return e.shareRoot ? "共有フォルダー" : "フォルダー"; let label = e.size.length > 0 ? e.size + " B" : "ファイル"; if (e.modified.length > 0) label += "  ·  " + e.modified; return label; }
function icon(e: Entry): View {
  let kind = "file"; const name = e.name.toLowerCase();
  if (e.folder) kind = "folder";
  else if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".gif") || name.endsWith(".webp")) kind = "image";
  else if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".json") || name.endsWith(".csv")) kind = "text";
  return text("").key("filer-icon-" + kind);
}
function breadcrumb(): string {
  let label = place == 0 ? "マイファイル" : "共有";
  if (place == 0) return label + directory.replaceAll("/", " / ");
  const parts = directory.split("/");
  for (let i = 1; i < parts.length; i++) {
    let name = parts[i]; if (i == 1) for (let j = 0; j < sharedEntries.length; j++) if (sharedEntries[j].shareRoot && sharedEntries[j].share == name) { name = sharedEntries[j].name; break; }
    if (name.length > 0) label += " / " + name;
  }
  return label;
}
function rows(): View {
  const views: View[] = []; const list = current(); const parentPath = place == 0 ? base + directory : "/shared" + directory;
  for (let i = 0; i < list.length; i++) {
    const e = list[i]; if (parent(e.path) != parentPath) continue;
    if (rename == i) { views.push(row([input(draft, edit).label("新しい名前").grow(), button("保存", renameSave), button("キャンセル", cancel).variant("ghost")]).gap(space.sm)); continue; }
    const menu: View[] = []; const labels = ["開く", "名前の変更", "移動", "コピー", "削除", "書き出し", e.share.length > 0 ? "共有 OFF" : "共有 ON"];
    for (let j = 0; j < labels.length; j++) menu.push(menuItem(labels[j], action).arg(i * 10 + j));
    const trailing = e.share.length > 0 && !e.folder ? chip("共有 ON").tone("muted") : null;
    views.push(buttonOf([listTile(e.name, sizeLabel(e), icon(e), trailing)], open).arg(i).variant("ghost").menu(menu).selected(selected == i).label(e.name).key("filer-entry-" + i.toString()));
  }
  if (views.length == 0) return column([text("").key("filer-icon-folder"), text("ここにはまだファイルがありません。").tone("muted")]).gap(space.md).center().fill().grow().key("filer-empty");
  return column(views).gap(space.xs).padding(space.sm).list().fill().grow().scroll().key("filer-list");
}
class Filer extends App {
  override onCreate(_last: Last, api: Api): void { shares = SharesApi.from(api)!; storage = StorageApi.from(api)!; pigeon = PigeonApi.from(api)!; inbox(); refresh(); }
  override onPigeon(): void { inbox(); }
  override onShare(): void { completed(); }
  override build(): View {
    const toolbar: View[] = [row([button("↑", up).variant("ghost").label("上のフォルダーへ"), text(breadcrumb()).bold().grow()]).gap(space.sm).grow().key("filer-crumb")];
    if (place == 0) toolbar.push(row([button("新規フォルダー", folder).variant("ghost"), filePick("読み込む", imported)]).gap(space.sm).key("filer-actions"));
    const main: View[] = [row(toolbar).gap(space.sm).wrap().key("filer-toolbar").padding(space.md).surface("surface").divider("bottom"), tabs(["マイファイル", "共有"], place, changePlace).key("filer-tabs"), rows()];
    if (newFolder) main.push(row([input(draft, edit).label("フォルダー名").grow(), button("作成", saveFolder), button("キャンセル", cancel).variant("ghost")]).gap(space.sm).padding(space.sm));
    if (copySource !== null) main.push(button(moveMode == 2 ? "ここへ移動" : "ここへコピー", paste));
    if (confirm >= 0) main.push(row([text(place == 1 && confirm < current().length && current()[confirm].shareRoot ? "この共有から退出しますか？" : "この項目を削除しますか？").grow(), button("削除", removeConfirmed).variant("danger"), button("キャンセル", cancel).variant("ghost")]).gap(space.sm).padding(space.md).divider("top"));
    if (notice.length > 0) main.push(text(notice).small().tone("muted").padding(space.sm));
    const previewViews: View[] = [text("プレビュー").small().bold()];
    if (previewImage.length > 0) previewViews.push(image(previewImage).label("選択した画像").height(100)); else previewViews.push(text(preview).small().tone("muted"));
    if (capacity.length > 0) { previewViews.push(text(capacity).small().tone("muted")); if (capacityFraction >= 0) previewViews.push(progress(capacityFraction).label("ストレージ使用量").key("filer-capacity")); }
    main.push(column(previewViews).gap(space.xs).padding(space.md).surface("surface").divider("top").key("filer-preview"));
    return column([row([text("Filer").heading(2).grow().key("filer-title"), text(pickFrom.length > 0 ? "渡すファイルを選択" : "ファイルを整理").small().tone("muted")]).padding(space.md).surface("surface").divider("bottom"), row([placeButtons(), column(main).fill().grow()]).fill().grow().collapse()]).fill();
  }
}
launch(new Filer());
