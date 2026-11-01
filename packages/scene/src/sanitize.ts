const allowedTags = new Set("div span p h1 h2 h3 h4 h5 h6 button ul ol li img section header footer nav main article label strong em small br hr a table caption colgroup col thead tbody tfoot tr th td code pre blockquote dl dt dd b i u s sub sup time figure figcaption details summary".split(" "));
const removedSubtrees = new Set("script style iframe object embed link meta base form template svg math noscript noembed noframes xmp plaintext".split(" "));
const allowedAttributes = new Set(["id", "class", "title", "alt", "role", "bina"]);
const htmlNamespace = "http://www.w3.org/1999/xhtml";
const rasterDataUrl = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]+={0,2}$/i;

/** Parse app HTML in an inert template and copy only permitted content. */
export function sanitizeHtml(document: Document, html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  const result = document.createDocumentFragment();
  const copy = (source: Node, parent: Node) => {
    if (source.nodeType === 3) {
      parent.appendChild(document.createTextNode(source.textContent ?? ""));
      return;
    }
    if (source.nodeType !== 1) return;
    const element = source as Element;
    const tag = element.localName.toLowerCase();
    if (element.namespaceURI !== htmlNamespace || removedSubtrees.has(tag)) return;
    let destination = parent;
    if (allowedTags.has(tag)) {
      const clean = document.createElement(tag);
      for (const attribute of element.attributes) {
        const name = attribute.name.toLowerCase();
        if (attribute.namespaceURI !== null || name.startsWith("on")) continue;
        if (allowedAttributes.has(name) || /^(?:aria|bina|data)-[a-z0-9_-]+$/.test(name)) {
          clean.setAttribute(name, attribute.value);
        } else if (tag === "img" && name === "src" && rasterDataUrl.test(attribute.value)) {
          clean.setAttribute("src", attribute.value);
        }
      }
      if (tag === "button") clean.setAttribute("type", "button");
      parent.appendChild(clean);
      destination = clean;
    }
    for (const child of element.childNodes) copy(child, destination);
  };
  for (const child of template.content.childNodes) copy(child, result);
  return result;
}

/** CSS の構文上の境界と、外部読み込みにつながる指定を調べる */
function safeCss(css: string): boolean {
  let depth = 0;
  let code = "";
  for (let i = 0; i < css.length; i++) {
    const char = css[i]!;
    if (char === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end < 0) return false;
      // コメントを挟んだ識別子も、続けて検査する
      i = end + 1;
    } else if (char === '"' || char === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== char) {
        if (/[\n\r\f]/.test(css[j]!)) return false;
        j += css[j] === "\\" ? 2 : 1;
      }
      if (j >= css.length) return false;
      code += css.slice(i, j + 1);
      i = j;
    } else {
      // エスケープによる url や @ 規則の検査回避を認めない
      if (char === "\\") return false;
      if (char === "{") depth++;
      else if (char === "}" && --depth < 0) return false;
      code += char;
    }
  }
  if (depth !== 0 || /image-set\s*\(|expression\s*\(|<\/style/i.test(code)) return false;
  // 大域へ影響する @font-face・@property なども受け付けない
  if ([...code.matchAll(/@([\w-]+)/g)].some(match => !["media", "supports", "container", "scope"].includes(match[1]!.toLowerCase()))) return false;
  // url() は data: だけ。引用符の中のエスケープも読み込み先には使わせない
  return [...code.matchAll(/url\(\s*(["']?)\s*([^)"']*)/gi)].every(match => /^data:/i.test(match[2]!) && !match[2]!.includes("\\"));
}

/** アプリの CSS を、その表示先の中だけに効かせる。子のアプリの表示領域には効かない。
 * 構文の境界を越える指定や外部の読み込みがあるときは null */
export function scopeCss(css: string, id: string): string | null {
  return /^[0-9]+$/.test(id) && safeCss(css) ? `@scope ([data-bina-scope="${id}"]) to (.bina-ui-appArea) {\n${css}\n}` : null;
}
