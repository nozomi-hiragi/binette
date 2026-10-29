import { relative, resolve } from "@std/path";
import lume from "lume/mod.ts";
import remark from "lume/plugins/remark.ts";
import resolveUrls from "lume/plugins/resolve_urls.ts";
import relativeUrls from "lume/plugins/relative_urls.ts";
import modifyUrls from "lume/plugins/modify_urls.ts";

const site = lume({
  src: "./docs",
  // Lume joins dest to cwd, even when given an absolute path.
  dest: relative(
    Deno.cwd(),
    resolve(Deno.env.get("BINETTE_DOCS_OUT") || "site"),
  ),
});
site.use(remark());
site.data("layout", "layout.vto");
site.preprocess([".md"], (pages) => {
  for (const page of pages) {
    if (page.src.path.endsWith("/README")) {
      page.data.url = page.src.path.slice(0, -"README".length);
    }
    const heading = String(page.data.content).match(/^#\s+(.+)$/m);
    page.data.title = heading?.[1].replaceAll("`", "") ?? "Binette";
  }
});
// Links to repository files stay on GitHub; never read outside docs/.
const branch = Deno.env.get("BINETTE_DOCS_BRANCH") || "v0.2.0";
site.use(modifyUrls({
  fn(url, page) {
    if (!url || /^(?:[a-z][a-z\d+.-]*:|\/|#|\?)/i.test(url)) return url;
    const source = new URL(url, `https://docs.invalid/docs${page.src.path}.md`);
    if (!source.pathname.startsWith("/docs/")) {
      return `https://github.com/nozomi-hiragi/binette/blob/${branch}${source.pathname}${source.search}${source.hash}`;
    }
    return url;
  },
}));
// Match the GitHub-style fragments already used in the specifications.
site.process([".html"], (pages) => {
  for (const page of pages) {
    const used = new Set<string>();
    for (
      const heading of page.document.querySelectorAll("h1, h2, h3, h4, h5, h6")
    ) {
      const slug = heading.textContent.toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\-\s]/gu, "")
        .replace(/ /g, "-");
      let id = slug;
      for (let suffix = 1; used.has(id); suffix++) id = `${slug}-${suffix}`;
      used.add(id);
      heading.id = id;
    }
  }
});
site.use(resolveUrls());
site.use(relativeUrls());
export default site;
