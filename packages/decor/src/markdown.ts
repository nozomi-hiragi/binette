import { lexer, type MarkedToken, type Token } from "marked";

const alerts: Record<string, string> = { NOTE: "メモ", TIP: "ヒント", IMPORTANT: "重要", WARNING: "注意", CAUTION: "警告" };

/** Markdown owns only DOM nodes; the Worker receives no parser or HTML renderer. */
export function createMarkdown(root: HTMLElement, onLink: (url: string) => void) {
  const document = root.ownerDocument;
  let source: string | undefined;
  let base = "";
  const links = new Map<HTMLAnchorElement, string>();
  const headings = new Map<string, HTMLElement>();
  // Escape markup before decoding character references in an inert document.
  const decode = (value: string): string => {
    if (!value.includes("&")) return value;
    const parser = new document.defaultView!.DOMParser();
    return parser.parseFromString("<body>" + value.replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</body>", "text/html").body.textContent ?? "";
  };
  const resolve = (href: string): string => {
    try { return new URL(href, base || undefined).href; } catch { return href; }
  };
  const scroll = (id: string): void => {
    const heading = headings.get(id);
    if (!heading) return;
    for (let parent: HTMLElement | null = root; parent; parent = parent.parentElement) {
      const overflow = document.defaultView?.getComputedStyle(parent).overflowY;
      if (parent.classList.contains("bina-ui-scroll") || overflow === "auto" || overflow === "scroll") {
        parent.scrollTop += heading.getBoundingClientRect().top - parent.getBoundingClientRect().top - parent.clientTop;
        return;
      }
    }
    heading.scrollIntoView({ block: "start" });
  };
  const click = (event: Event): void => {
    const target = event.target as Element | null;
    const link = target?.closest?.("a") as HTMLAnchorElement | null;
    if (!link || !links.has(link)) return;
    event.preventDefault();
    if (event.type !== "click") return;
    const href = links.get(link)!;
    if (href.startsWith("#")) {
      let id = href.slice(1);
      try { id = decodeURIComponent(id); } catch { /* Keep a malformed fragment literal. */ }
      scroll(id);
    } else onLink(resolve(href));
  };
  root.addEventListener("click", click);
  root.addEventListener("auxclick", click);

  function render(parent: Node, tokens: Token[]): void {
    for (const raw of tokens) {
      // Only built-in tokens are emitted by this lexer (no extensions).
      const token = raw as MarkedToken;
      const element = (tag: string): HTMLElement => {
        const node = document.createElement(tag); parent.appendChild(node); return node;
      };
      switch (token.type) {
        case "space": case "def": break;
        case "html": parent.appendChild(document.createTextNode(token.text)); break;
        case "image": {
          const alt = document.createDocumentFragment();
          render(alt, token.tokens);
          parent.appendChild(document.createTextNode(alt.textContent ?? ""));
          break;
        }
        case "text":
          if (token.tokens) render(parent, token.tokens);
          else parent.appendChild(document.createTextNode(token.escaped ? token.text : decode(token.text)));
          break;
        case "escape": parent.appendChild(document.createTextNode(token.text)); break;
        case "codespan": element("code").textContent = token.text; break;
        case "code": {
          const code = document.createElement("code"); code.textContent = token.text;
          element("pre").append(code); break;
        }
        case "br": case "hr": element(token.type); break;
        case "em": case "strong": case "del": case "paragraph":
          render(element(token.type === "paragraph" ? "p" : token.type), token.tokens); break;
        case "heading": {
          const heading = element(`h${token.depth}`);
          render(heading, token.tokens);
          const slug = (heading.textContent ?? "").toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\-\s]/gu, "").replace(/ /g, "-");
          let id = slug;
          for (let i = 1; headings.has(id); i++) id = `${slug}-${i}`;
          heading.id = id; headings.set(id, heading); break;
        }
        case "link": {
          const link = element("a") as HTMLAnchorElement;
          const href = token.autolink ? token.href : decode(token.href);
          links.set(link, href); link.setAttribute("href", resolve(href));
          if (token.title) link.title = decode(token.title);
          render(link, token.tokens); break;
        }
        case "blockquote": {
          const quote = element("blockquote");
          const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i.exec(token.text);
          if (match) {
            const title = document.createElement("p"); title.className = "bina-ui-markdown-alert-title";
            title.textContent = alerts[match[1]!.toUpperCase()]!; quote.append(title);
            const body = token.tokens.slice();
            const first = body[0] as MarkedToken | undefined;
            if (first?.type === "paragraph") {
              const inline = first.tokens.slice();
              const line = inline[0] as MarkedToken | undefined;
              if (line?.type === "text") {
                inline[0] = { ...line, text: line.text.replace(/^\[!\w+\][ \t]*(?:\n)?/, "") };
                if ((inline[0] as typeof line).text === "") inline.shift();
                if (inline[0]?.type === "br") inline.shift();
              }
              if (inline.length) body[0] = { ...first, tokens: inline };
              else body.shift();
            }
            render(quote, body);
          } else render(quote, token.tokens);
          break;
        }
        case "list": {
          const list = element(token.ordered ? "ol" : "ul");
          if (token.ordered && token.start !== 1) list.setAttribute("start", String(token.start));
          for (const item of token.items) {
            const li = document.createElement("li"); list.append(li); render(li, item.tokens);
          }
          break;
        }
        case "list_item": render(element("li"), token.tokens); break;
        case "checkbox": {
          const box = element("input") as HTMLInputElement;
          box.type = "checkbox"; box.disabled = true; box.checked = token.checked;
          parent.appendChild(document.createTextNode(" ")); break;
        }
        case "table": {
          const wrap = element("div"); wrap.className = "bina-ui-markdown-table";
          const table = document.createElement("table"); wrap.append(table);
          const head = document.createElement("thead"); const body = document.createElement("tbody"); table.append(head, body);
          const row = (section: HTMLElement, cells: typeof token.header, tag: string): void => {
            const tr = document.createElement("tr"); section.append(tr);
            cells.forEach((cell, i) => {
              const td = document.createElement(tag); tr.append(td);
              if (token.align[i]) td.style.textAlign = token.align[i]!;
              render(td, cell.tokens);
            });
          };
          row(head, token.header, "th");
          for (const cells of token.rows) row(body, cells, "td");
          break;
        }
      }
    }
  }
  return {
    update(nextSource: string, nextBase: string): boolean {
      const changed = source !== nextSource;
      base = nextBase;
      if (changed) {
        source = nextSource; links.clear(); headings.clear();
        const tokens = lexer(source, { gfm: true });
        const fragment = document.createDocumentFragment(); render(fragment, tokens); root.replaceChildren(fragment);
      } else for (const [link, href] of links) link.setAttribute("href", resolve(href));
      return changed;
    },
    scroll,
    stop() { root.removeEventListener("click", click); root.removeEventListener("auxclick", click); },
  };
}
