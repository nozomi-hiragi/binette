// Converts docs/**/*.md into the content module of the bundled docs app.
// The output is committed so the app builds from source without this step.
import { fromFileUrl, join, relative } from "@std/path";

/** Separators that cannot appear in the docs; control characters are removed from the source first. */
export const BLOCK = "\u001e";
export const FIELD = "\u001f";
export const SPAN = "\u001d";
export const TARGET = "\u001c";

/** Pages links outside docs/ point to, matching the Lume site. */
const REPOSITORY = "https://github.com/nozomi-hiragi/binette/blob/v0.2.0";
const API = "https://nozomi-hiragi.github.io/binette/api/v0.2.0/";

export interface Page {
  /** Path from docs/ without ".md"; README and index become their folder ("" or "spec/"). */
  id: string;
  title: string;
  /** Blocks joined by BLOCK; see catalog/docs/src/main.ts for the layout. */
  body: string;
}

/** Turns the path of a Markdown file under docs/ into its page ID. */
export function pageId(path: string): string {
  const name = path.replace(/\.md$/, "");
  if (name === "index" || name === "README") return "";
  if (name.endsWith("/README") || name.endsWith("/index")) return name.slice(0, name.lastIndexOf("/") + 1);
  return name;
}

/** GitHub-style heading fragment, the same rule as _config.ts. */
export function slug(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\-\s]/gu, "").replace(/ /g, "-");
}

/** Resolves a link from the page at `from` (path under docs/). */
export function resolveLink(href: string, from: string, ids: Set<string>): { page: string; anchor: string } | { url: string } {
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) return { url: href };
  if (href.startsWith("#")) return { page: pageId(from), anchor: decodeURIComponent(href.slice(1)) };
  const url = new URL(href, `https://docs.invalid/docs/${from}`);
  const anchor = decodeURIComponent(url.hash.slice(1));
  if (url.pathname === "/docs/api/" || url.pathname === "/docs/api") return { url: API };
  if (url.pathname.startsWith("/docs/")) {
    const path = url.pathname.slice("/docs/".length);
    const id = path === "" || path.endsWith("/") ? path : pageId(path);
    if (ids.has(id)) return { page: id, anchor };
  }
  return { url: `${REPOSITORY}${url.pathname}${url.hash}` };
}

const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯]/u;
function joinLines(lines: string[]): string {
  let out = "";
  for (const line of lines.map((line) => line.trim())) {
    if (line === "") continue;
    if (out === "") out = line;
    else out += cjk.test(out.at(-1)!) || cjk.test(line[0]) ? line : ` ${line}`;
  }
  return out;
}

/** Encodes inline Markdown as spans: "t" text, "c" code, "b" bold, "l" page link, "x" external link. */
export function inline(source: string, from: string, ids: Set<string>): string {
  const spans: string[] = [];
  const push = (kind: string, value: string) => {
    if (value === "") return;
    if (kind === "t" && spans.length > 0 && spans.at(-1)![0] === "t") spans[spans.length - 1] += value;
    else spans.push(kind + value);
  };
  const plain = (text: string) => text.replace(/\\([\\`*_{}[\]()#+\-.!|<>])/g, "$1");
  let i = 0;
  let text = "";
  const flush = () => { push("t", plain(text)); text = ""; };
  while (i < source.length) {
    const rest = source.slice(i);
    if (rest[0] === "\\" && rest.length > 1) { text += rest.slice(0, 2); i += 2; continue; }
    const code = rest.match(/^(`+)([\s\S]*?[^`])\1(?!`)/);
    if (code) { flush(); push("c", code[2].replace(/^ (.*) $/, "$1")); i += code[0].length; continue; }
    const link = rest.match(/^\[((?:[^\]\\]|\\.)*)\]\(([^)\s]*)\)/);
    if (link) {
      flush();
      const label = plain(link[1].replace(/\*\*|`/g, ""));
      const target = resolveLink(link[2], from, ids);
      if ("url" in target) spans.push(`x${target.url}${TARGET}${label}`);
      else spans.push(`l${target.page}#${target.anchor}${TARGET}${label}`);
      i += link[0].length;
      continue;
    }
    const bold = rest.match(/^\*\*(.+?)\*\*/);
    if (bold) { flush(); push("b", plain(bold[1].replace(/`/g, ""))); i += bold[0].length; continue; }
    const em = rest.match(/^\*([^*\s][^*]*)\*/);
    if (em) { text += em[1]; i += em[0].length; continue; }
    text += rest[0];
    i++;
  }
  flush();
  return spans.join(SPAN);
}

function cells(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);
  const out: string[] = [];
  let cell = "";
  let code = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "\\" && body[i + 1] === "|") { cell += "|"; i++; continue; }
    if (c === "`") code = !code;
    if (c === "|" && !code) { out.push(cell.trim()); cell = ""; continue; }
    cell += c;
  }
  out.push(cell.trim());
  return out;
}

const listItem = /^(\s*)([-*+]|(\d+)[.)])\s+(.*)$/;
const alerts: Record<string, string> = { NOTE: "メモ", TIP: "ヒント", IMPORTANT: "重要", WARNING: "注意", CAUTION: "警告" };

/** Parses one Markdown file into encoded blocks. */
export function blocks(markdown: string, from: string, ids: Set<string>): string[] {
  // deno-lint-ignore no-control-regex
  const lines = markdown.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  const used = new Set<string>();
  const span = (text: string) => inline(text, from, ids);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }
    const fence = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(fence[2])) {
        code.push(lines[i].startsWith(fence[1]) ? lines[i].slice(fence[1].length) : lines[i].trimStart());
        i++;
      }
      i++;
      out.push(["c", code.join("\n")].join(FIELD));
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      const encoded = span(heading[2]);
      const plainText = encoded.split(SPAN).map((s) => s[0] === "l" || s[0] === "x" ? s.slice(s.indexOf(TARGET) + 1) : s.slice(1)).join("");
      const base = slug(plainText);
      let id = base;
      for (let n = 1; used.has(id); n++) id = `${base}-${n}`;
      used.add(id);
      out.push(["h", String(heading[1].length), id, encoded].join(FIELD));
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push("-"); i++; continue; }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) { quote.push(lines[i].replace(/^>\s?/, "")); i++; }
      let label = "";
      const alert = quote[0]?.match(/^\[!(\w+)\]\s*$/);
      if (alert) { label = alerts[alert[1].toUpperCase()] ?? alert[1]; quote.shift(); }
      let paragraph: string[] = [];
      const flush = () => {
        if (paragraph.length > 0) out.push(["q", label, span(joinLines(paragraph))].join(FIELD));
        paragraph = []; label = "";
      };
      for (const q of quote) {
        if (q.trim() === "") flush();
        else if (listItem.test(q) && paragraph.length > 0) { flush(); paragraph.push(q); }
        else paragraph.push(q);
      }
      flush();
      continue;
    }
    if (line.trimStart().startsWith("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const header = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trimStart().startsWith("|")) { rows.push(cells(lines[i])); i++; }
      const widths = header.map((cell, column) => {
        const longest = Math.max(...[cell, ...rows.map((row) => row[column] ?? "")].map((value) => [...value].reduce((n, c) => n + (cjk.test(c) ? 2 : 1), 0)));
        return Math.min(320, Math.max(96, Math.round(longest * 7.5) + 16));
      });
      out.push(["t", widths.join(","), ...header.map(span)].join(FIELD));
      for (const row of rows) out.push(["r", ...header.map((_, column) => span(row[column] ?? ""))].join(FIELD));
      continue;
    }
    const item = line.match(listItem);
    if (item) {
      while (i < lines.length) {
        const current = lines[i].match(listItem);
        if (!current) break;
        const depth = current[1].replace(/\t/g, "  ").length >= 2 ? 1 : 0;
        const body = [current[4]];
        i++;
        while (i < lines.length && lines[i].trim() !== "" && !listItem.test(lines[i]) && /^\s+\S/.test(lines[i])) { body.push(lines[i]); i++; }
        out.push(current[3] === undefined
          ? ["u", String(depth), span(joinLines(body))].join(FIELD)
          : ["o", String(depth), current[3], span(joinLines(body))].join(FIELD));
        // A blank line between items keeps the same list.
        if (i < lines.length && lines[i].trim() === "" && i + 1 < lines.length && listItem.test(lines[i + 1])) i++;
      }
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,6}\s|>|\s*(`{3,}|~{3,}))/.test(lines[i]) && !listItem.test(lines[i]) &&
      !(lines[i].trimStart().startsWith("|") && paragraph.length === 0)) {
      paragraph.push(lines[i]);
      i++;
    }
    if (paragraph.length === 0) { paragraph.push(lines[i]); i++; }
    out.push(["p", span(joinLines(paragraph))].join(FIELD));
  }
  return out;
}

async function files(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory) out.push(...await files(root, path));
    else if (entry.name.endsWith(".md")) out.push(relative(root, path).replaceAll("\\", "/"));
  }
  return out;
}

/** Table-of-contents order: a folder's README first, then its pages, then its subfolders. */
function order(path: string): string {
  return path.split("/").map((part, i, parts) => i === parts.length - 1 ? (part === "README.md" || part === "index.md" ? "0" : `1${part}`) : `2${part}`).join("/");
}

export async function readPages(root: string): Promise<Page[]> {
  const paths = (await files(root)).sort((a, b) => order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0);
  const ids = new Set(paths.map(pageId));
  const pages: Page[] = [];
  for (const path of paths) {
    const markdown = await Deno.readTextFile(join(root, path));
    const title = markdown.match(/^#\s+(.+)$/m)?.[1].replaceAll("`", "").trim() ?? path;
    pages.push({ id: pageId(path), title, body: blocks(markdown, path, ids).join(BLOCK) });
  }
  return pages;
}

const literal = (value: string) => JSON.stringify(value).replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);

export function render(pages: Page[]): string {
  return [
    "// Generated by `deno task docs:app` from docs/. Do not edit.",
    `export const ids: string[] = [${pages.map((page) => literal(page.id)).join(", ")}];`,
    `export const titles: string[] = [${pages.map((page) => literal(page.title)).join(", ")}];`,
    "export const bodies: string[] = [",
    ...pages.map((page) => `  ${literal(page.body)},`),
    "];",
    "",
  ].join("\n");
}

export const OUTPUT = new URL("../catalog/docs/src/content.ts", import.meta.url);
export const DOCS = new URL("../docs/", import.meta.url);

if (import.meta.main) {
  await Deno.writeTextFile(OUTPUT, render(await readPages(fromFileUrl(DOCS))));
}
