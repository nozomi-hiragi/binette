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
