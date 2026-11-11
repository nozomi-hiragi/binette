// deno-lint-ignore-file no-import-prefix no-unversioned-import
import { App, Api, Last, StorageApi, launch } from "jsr:@binette/replique";
import { View, column, row, text, button, buttonOf, space } from "jsr:@binette/replique-ui@^0.1";
import { ids, titles, bodies } from "./content.ts";

// Layout of content.ts (scripts/docs-app.ts writes it):
// a page is blocks joined by BLOCK, a block is fields joined by FIELD, the first field is its kind:
//   h level slug spans | p spans | u depth spans | o depth number spans | q label spans | c code | - |
//   t widths(comma) cell... (table header) | r cell... (table row)
// spans are joined by SPAN; the first character is the kind: t text, c code, b bold,
//   l page link ("id#anchor" TARGET label), x outside link (url TARGET label).
const BLOCK = "\u001e";
const FIELD = "\u001f";
const SPAN = "\u001d";
const TARGET = "\u001c";
const NBSP = " ";

let storage: StorageApi | null = null;
let current = 0;
/** First block to show; a link with an anchor starts the page at that heading. */
let start = 0;
let blocks: string[] = [];
let toc = false;
/** Link targets of the last build, indexed by the buttons' arg. */
let links: string[] = [];

function find(id: string): i32 {
  for (let i = 0; i < ids.length; i++) if (ids[i] == id) return i;
  return -1;
}
function open(target: string): void {
  const hash = target.indexOf("#");
  const id = hash < 0 ? target : target.substring(0, hash);
  const anchor = hash < 0 ? "" : target.substring(hash + 1);
  const index = find(id);
  if (index < 0) return;
  if (index != current || blocks.length == 0) { current = index; blocks = bodies[index].split(BLOCK); }
  start = 0;
  if (anchor.length > 0) {
    for (let i = 0; i < blocks.length; i++) {
      const fields = blocks[i].split(FIELD);
      if (fields[0] == "h" && fields[2] == anchor) { start = i; break; }
    }
  }
  toc = false;
  const saved = storage;
  if (saved !== null) saved.write("page", id + "#" + anchor);
}
function openLink(i: i32): void { if (i >= 0 && i < links.length) open(links[i]); }
function openPage(i: i32): void { if (i >= 0 && i < ids.length) open(ids[i]); }
function fromTop(): void { start = 0; }
function toggleToc(): void { toc = !toc; }

/** Plain text of spans; page links are collected for the buttons under the block. */
function plain(spans: string, found: string[], labels: string[]): string {
  if (spans.length == 0) return "";
  const parts = spans.split(SPAN);
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const kind = part.charAt(0);
    const value = part.substring(1);
    if (kind == "l" || kind == "x") {
      const split = value.indexOf(TARGET);
      const label = value.substring(split + 1);
      out += label;
      if (kind == "l" && found.indexOf(value.substring(0, split)) < 0) { found.push(value.substring(0, split)); labels.push(label); }
    } else out += value;
  }
  return out;
}
function linkRow(found: string[], labels: string[]): View | null {
  if (found.length == 0) return null;
  const buttons: View[] = [];
  for (let i = 0; i < found.length; i++) {
    buttons.push(button("→ " + labels[i], openLink).arg(links.length).variant("ghost").small().label(labels[i] + " を開く"));
    links.push(found[i]);
  }
  return row(buttons).gap(space.xs).wrap();
}
function withLinks(view: View, found: string[], labels: string[]): View {
  const more = linkRow(found, labels);
  if (more === null) return view;
  return column([view, more]).gap(space.xs);
}
function code(source: string): View {
  const lines = source.split("\n");
  const views: View[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    let lead = 0;
    while (lead < line.length && line.charAt(lead) == " ") lead++;
    line = NBSP.repeat(lead) + line.substring(lead);
    views.push(text(line.length > 0 ? line : NBSP).mono().small());
  }
  return column(views).surface("sunken").padding(space.sm);
}
function table(at: i32, out: View[]): i32 {
  const header = blocks[at].split(FIELD);
  const widthText = header[1].split(",");
  const widths: f64[] = [];
  for (let i = 0; i < widthText.length; i++) widths.push(parseFloat(widthText[i]));
  const found: string[] = [];
  const labels: string[] = [];
  const rows: View[] = [];
  let i = at;
  while (i < blocks.length) {
    const fields = blocks[i].split(FIELD);
    if (i > at && fields[0] != "r") break;
    const cells: View[] = [];
    for (let c = 0; c < widths.length; c++) {
      const value = c + 2 - (i == at ? 0 : 1) < fields.length ? fields[c + 2 - (i == at ? 0 : 1)] : "";
      const cell = text(plain(value, found, labels)).small().width(widths[c]).padding(space.xs);
      cells.push(i == at ? cell.bold() : cell);
    }
    rows.push(row(cells).divider("bottom"));
    i++;
  }
  out.push(withLinks(row([column(rows).divider("top")]).scroll(), found, labels));
  return i;
}
function body(): View[] {
  links = [];
  const out: View[] = [];
  if (start > 0) out.push(button("↑ ページの先頭から読む", fromTop).variant("ghost").small());
  let i = start;
  while (i < blocks.length) {
    const fields = blocks[i].split(FIELD);
    const kind = fields[0];
    const found: string[] = [];
    const labels: string[] = [];
    if (kind == "t") { i = table(i, out); continue; }
    if (kind == "h") {
      const level = i32(parseInt(fields[1]));
      const value = text(plain(fields[3], found, labels));
      out.push(withLinks(level <= 3 ? value.heading(level) : value.bold(), found, labels));
    } else if (kind == "p") {
      const value = plain(fields[1], found, labels);
      // A paragraph that is only a page link becomes the link button itself.
      if (found.length == 1 && value == labels[0]) {
        out.push(button("→ " + labels[0], openLink).arg(links.length).variant("ghost").label(labels[0] + " を開く"));
        links.push(found[0]);
      } else out.push(withLinks(text(value), found, labels));
    } else if (kind == "u" || kind == "o") {
      const depth = i32(parseInt(fields[1]));
      const mark = kind == "u" ? (depth == 0 ? "•" : "◦") : fields[2] + ".";
      const item = row([text(mark).width(24).align("top"), text(plain(fields[kind == "u" ? 2 : 3], found, labels)).grow()]).gap(space.xs);
      out.push(withLinks(depth > 0 ? row([text("").width(20), item.grow()]) : item, found, labels));
    } else if (kind == "q") {
      const parts: View[] = [];
      if (fields[1].length > 0) parts.push(text(fields[1]).small().bold().tone("accent"));
      parts.push(text(plain(fields[2], found, labels)).tone("muted"));
      out.push(withLinks(column(parts).gap(space.xs).padding(space.sm).divider("left"), found, labels));
    } else if (kind == "c") {
      out.push(code(fields[1]));
    } else if (kind == "-") {
      out.push(column([]).divider("bottom"));
    }
    i++;
  }
  return out;
}
function contents(): View {
  const items: View[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    let depth = 0;
    for (let c = 0; c < id.length - 1; c++) if (id.charAt(c) == "/") depth++;
    const label = row([text("").width(f64(depth * 14)), text(titles[i]).grow()]).align("start");
    items.push(buttonOf([label], openPage).arg(i).variant("ghost").selected(i == current).label(titles[i]).key("page-" + id));
  }
  return column([column(items).gap(space.xs).padding(space.sm).width(760).align("center")]).fill().grow().scroll().label("目次").key("toc");
}

class Docs extends App {
  override onCreate(_last: Last, api: Api): void {
    storage = StorageApi.from(api);
    const saved = storage !== null ? storage!.read("page") : null;
    open(ids[0]);
    if (saved !== null) open(saved);
  }
  override build(): View {
    const header = row([
      button(toc ? "目次を閉じる" : "目次", toggleToc).variant("ghost").selected(toc),
      text(titles[current]).bold().truncate().grow(),
    ]).gap(space.sm).padding(space.sm).surface("surface").divider("bottom");
    const page = toc ? column([]) : column([column(body()).gap(space.md).padding(space.md).width(760).align("center")]).fill().grow().scroll().key("body-" + ids[current] + "-" + start.toString());
    // The table of contents replaces the page instead of sitting beside it, so on every width the page
    // (or the contents) owns its scroll and a new page always opens at the top.
    return column([header, toc ? contents() : page]).fill();
  }
}
launch(new Docs());
