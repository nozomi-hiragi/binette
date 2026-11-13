import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { Window } from "happy-dom";
import { column, markdown, mount } from "../src/index.ts";

function setup() {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.append(host as never);
  const root = mount(host);
  return { window, host, root, async stop() { root.unmount(); await window.happyDOM.close(); } };
}

Deno.test("Markdown renders supported blocks and inline elements without HTML or images", async () => {
  const { host, root, stop } = setup();
  try {
    root.render(markdown(`# Title &amp; *em*
## Second
### Third
#### Fourth
##### Fifth
###### Sixth

A **strong** ~~deleted~~ paragraph with \`inline <code>\`, &copy; and &#65;.
hard  
break

\`\`\`ts
const html = "<img src=x>";
\`\`\`

3. first
   - nested
4. second

- [x] done
- [ ] todo

> plain quote

| Left | Right |
| :--- | ---: |
| *cell* | value |

---

<script>alert(1)</script>

<img src="https://example.com/raw.png" onerror="alert(1)">

![**alternative** &amp; text](https://example.com/image.png)

Raw <b>markup</b> stays visible.`, () => {}));
    const node = host.querySelector(".bina-ui-markdown")!;
    for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6", "p", "em", "strong", "del", "code", "pre", "ol", "ul", "li", "blockquote", "table", "thead", "tbody", "th", "td", "hr", "br"]) assert(node.querySelector(tag), tag);
    assertEquals(node.querySelector("h1")!.textContent, "Title & em");
    assertEquals(node.querySelector("ol")!.getAttribute("start"), "3");
    assert(node.querySelector("ol ul li"));
    const boxes = [...node.querySelectorAll<HTMLInputElement>("input")];
    assertEquals(boxes.map(box => [box.disabled, box.checked]), [[true, true], [true, false]]);
    assertEquals(node.querySelector("pre code")!.textContent, 'const html = "<img src=x>";');
    assertEquals(node.querySelectorAll("img, script, b").length, 0);
    assert(node.textContent?.includes('<script>alert(1)</script>'));
    assert(node.textContent?.includes('Raw <b>markup</b> stays visible.'));
    assert(node.textContent?.includes("alternative & text"));
    assert(node.textContent?.includes("© and A"));
    assertEquals((node.querySelector("td:last-child") as HTMLElement).style.textAlign, "right");
    assert(node.querySelector(".bina-ui-markdown-table > table"));
  } finally { await stop(); }
});

Deno.test("Markdown alerts preserve inline formatting, definitions and nested blocks", async () => {
  const { host, root, stop } = setup();
  try {
    const types = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"];
    root.render(markdown(types.map(type => `> [!${type}]
> **Details** [reference][ref]
>
> - nested`).join("\n\n") + "\n\n[ref]: https://example.com/\n\n> [!UNKNOWN]\n> normal", () => {}));
    assertEquals([...host.querySelectorAll(".bina-ui-markdown-alert-title")].map(node => node.textContent), ["メモ", "ヒント", "重要", "注意", "警告"]);
    assertEquals(host.querySelectorAll("blockquote strong").length, 5);
    assertEquals(host.querySelectorAll("blockquote a").length, 5);
    assertEquals(host.querySelectorAll("blockquote li").length, 5);
    assert(host.querySelector("blockquote:last-child")!.textContent?.includes("[!UNKNOWN]"));
  } finally { await stop(); }
});

Deno.test("Markdown uses GitHub heading IDs and scrolls fragments locally without sending links", async () => {
  const { window, host, root, stop } = setup();
  const events: string[] = [];
  try {
    root.render(column([markdown(`# Hello, *World*!
## Hello, World!
## Hello, World!-1
## Hello, World!
## 日本語_見出し

[jump](#日本語_見出し) [encoded](#%E6%97%A5%E6%9C%AC%E8%AA%9E_%E8%A6%8B%E5%87%BA%E3%81%97) [missing](#missing)`, url => events.push(url))]).scroll());
    assertEquals([...host.querySelectorAll("h1,h2")].map(node => node.id), ["hello-world", "hello-world-1", "hello-world-1-1", "hello-world-2", "日本語_見出し"]);
    const scroller = host.querySelector<HTMLElement>(".bina-ui-scroll")!;
    const heading = host.querySelector<HTMLElement>('[id="日本語_見出し"]')!;
    scroller.getBoundingClientRect = () => ({ top: 20 } as DOMRect);
    heading.getBoundingClientRect = () => ({ top: 220 } as DOMRect);
    for (const a of host.querySelectorAll("a")) {
      const click = new window.MouseEvent("click", { bubbles: true, cancelable: true });
      a.dispatchEvent(click as unknown as Event); assert(click.defaultPrevented);
    }
    assertEquals(scroller.scrollTop, 400);
    assertEquals(events, []);
  } finally { await stop(); }
});

Deno.test("Markdown resolves links and changes the base without rebuilding the source", async () => {
  const { host, root, stop } = setup();
  const events: string[] = [];
  const source = "[relative](../next.md) [external](https://other.test/) [invalid](http://[) [raw](plain.md)";
  const draw = (base: string) => root.render(markdown(source, url => events.push(url)).base(base));
  try {
    draw("https://example.com/docs/current.md");
    const p = host.querySelector("p")!;
    const first = p.querySelector("a")!;
    assertEquals(first.getAttribute("href"), "https://example.com/next.md");
    for (const a of p.querySelectorAll("a")) a.click();
    assertEquals(events, ["https://example.com/next.md", "https://other.test/", "http://[", "https://example.com/docs/plain.md"]);
    draw("https://example.com/another/current.md");
    assertStrictEquals(host.querySelector("p"), p);
    assertStrictEquals(p.querySelector("a"), first);
    assertEquals(p.querySelectorAll("a")[3]!.getAttribute("href"), "https://example.com/another/plain.md");
    draw(""); first.click(); assertEquals(events.at(-1), "../next.md");
    draw("invalid base"); first.click(); assertEquals(events.at(-1), "../next.md");
    root.render(markdown("Changed", () => {}));
    assert(host.querySelector("p") !== p);
  } finally { await stop(); }
});

Deno.test("Markdown anchor scrolls after insertion, only when the source or anchor changes", async () => {
  const { window, host, root, stop } = setup();
  const scrolled: string[] = [];
  const original = window.HTMLElement.prototype.scrollIntoView;
  window.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this.id); assert(this.isConnected); };
  const draw = (source: string, anchor: string, base = "") => root.render(markdown(source, () => {}).anchor(anchor).base(base));
  try {
    draw("# First\n\n# Second", "second"); assertEquals(scrolled, ["second"]);
    const heading = host.querySelector("h1");
    draw("# First\n\n# Second", "second");
    draw("# First\n\n# Second", "second", "https://example.com/");
    assertEquals(scrolled, ["second"]); assertStrictEquals(host.querySelector("h1"), heading);
    draw("# First\n\n# Second", "first"); assertEquals(scrolled, ["second", "first"]);
    draw("# First\n\n# Second\n\nchanged", "first"); assertEquals(scrolled, ["second", "first", "first"]);
    draw("# First", "missing"); assertEquals(scrolled.length, 3);
  } finally { window.HTMLElement.prototype.scrollIntoView = original; await stop(); }
});
