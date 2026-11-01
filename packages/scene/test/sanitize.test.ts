import { assertEquals } from "@std/assert";
import type { DomOp } from "@binette/core";
import type { Process } from "@binette/regie";
import { Window } from "happy-dom";
import { mountApp } from "../src/mount.ts";
import { scopeCss } from "../src/sanitize.ts";

Deno.test("initial HTML removes executable content, unsafe attributes, and external URLs silently", async () => {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.append(host as never);
  const errors: unknown[] = [];
  const process = { attach() {}, dispatch() {} } as unknown as Process;
  const mounted = mountApp(host, `
    <script>bad()</script><style>body { display: none }</style>
    <iframe src="https://example.com"><p>iframe child</p></iframe>
    <object><p>object child</p></object><embed src="https://example.com">
    <link href="https://example.com"><meta http-equiv="refresh" content="0;url=https://example.com"><base href="https://example.com">
    <form><button>form child</button></form><template><p>template child</p></template>
    <math><mtext>math child</mtext></math>
    <p id="safe" style="background:url(https://example.com)" ONCLICK="bad()" srcset="https://example.com 1x">safe</p>
    <img id="remote" src="https://example.com/p.png" onerror="bad()" srcset="/local.png 1x">
    <img id="relative" src="/local.png"><img id="svg" src="data:image/svg+xml;base64,PHN2Zz4=">
    <a id="link" href="javascript:bad()" ping="https://example.com" target="_blank">link</a>
    <button id="button" type="submit" formaction="https://example.com" autofocus>button</button>
    <video poster="https://example.com"><p id="fallback">fallback</p></video>
    <!-- hidden comment -->
    <svg><script>bad()</script><a href="https://example.com">svg child</a></svg>
  `, process, { onError: error => errors.push(error) });
  try {
    assertEquals(host.querySelector("script,style,iframe,object,embed,link,meta,base,form,template,svg,math,video"), null);
    assertEquals(host.querySelector("#safe")!.outerHTML, '<p id="safe">safe</p>');
    for (const id of ["remote", "relative", "svg"]) {
      assertEquals(host.querySelector(`#${id}`)!.outerHTML, `<img id="${id}">`);
    }
    assertEquals(host.querySelector("#link")!.outerHTML, '<a id="link">link</a>');
    assertEquals(host.querySelector("#button")!.outerHTML, '<button id="button" type="button">button</button>');
    assertEquals(host.querySelector("#fallback")!.textContent, "fallback");
    assertEquals(host.textContent!.includes("child"), false);
    assertEquals(host.innerHTML.includes("hidden comment"), false);
    assertEquals(errors, []);
  } finally { mounted.stop(); await window.happyDOM.close(); }
});

Deno.test("initial HTML preserves allowed content, raster data URLs, byId, and click", async () => {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  let apply: (ops: DomOp[]) => void = () => {};
  const events: number[] = [];
  const process = { attach(sink: typeof apply) { apply = sink; }, dispatch(id: number) { events.push(id); } } as unknown as Process;
  const mounted = mountApp(host, `
    <section id="root" class="content" title="Title" aria-label="Content" role="region" bina="root" bina-kind="panel" data-key="value">
      <unknown><button id="button">Click <strong>here</strong></button></unknown>
      <table><tbody><tr><td><code>code</code></td></tr></tbody></table><pre>pre</pre><blockquote>quote</blockquote>
      <img id="png" src="data:image/png;base64,AA==" alt="PNG">
      <img id="jpeg" src="DATA:IMAGE/JPEG;BASE64,AA==">
      <img id="gif" src="data:image/gif;base64,AA=="><img id="webp" src="data:image/webp;base64,AA==">
    </section>`, process);
  try {
    const root = host.querySelector("#root")!;
    assertEquals(Array.from(root.attributes, attribute => [attribute.name, attribute.value]), [
      ["id", "root"], ["class", "content"], ["title", "Title"], ["aria-label", "Content"], ["role", "region"],
      ["bina", "root"], ["bina-kind", "panel"], ["data-key", "value"],
    ]);
    assertEquals(root.querySelector("unknown"), null);
    assertEquals(root.querySelector("table td code")!.textContent, "code");
    assertEquals(root.querySelector("pre")!.textContent, "pre");
    assertEquals(root.querySelector("blockquote")!.textContent, "quote");
    for (const id of ["png", "jpeg", "gif", "webp"]) assertEquals(root.querySelector(`#${id}`)!.hasAttribute("src"), true);
    assertEquals(root.querySelector("#png")!.getAttribute("alt"), "PNG");
    apply([{ op: "byId", handle: 1, id: "button" }, { op: "listen", handle: 1, type: "click", listener: 7 }]);
    const button = host.querySelector<HTMLButtonElement>("#button")!;
    button.querySelector<HTMLElement>("strong")!.click();
    assertEquals(events, [7]);
    apply([{ op: "text", handle: 1, value: "Updated" }]);
    assertEquals(button.textContent, "Updated");
    assertEquals(button.type, "button");
    mounted.stop(); button.click(); assertEquals(events, [7]);
  } finally { mounted.stop(); await window.happyDOM.close(); }
});

Deno.test("CSS は表示先ごとの scope と子アプリの境界を持つ", async () => {
  const window = new Window();
  const process = { attach() {}, dispatch() {} } as unknown as Process;
  const hosts = [window.document.createElement("div"), window.document.createElement("div")];
  const mounted = hosts.map(host => mountApp(host as unknown as HTMLElement, "<p>アプリ</p>", process, { css: "p { color: red }" }));
  try {
    const ids = hosts.map(host => host.getAttribute("data-bina-scope"));
    assertEquals(ids[0] === ids[1], false);
    for (const host of hosts) {
      assertEquals(host.querySelector("style")!.textContent, `@scope ([data-bina-scope="${host.getAttribute("data-bina-scope")}"]) to (.bina-ui-appArea) {\np { color: red }\n}`);
    }
    const errors: unknown[] = [];
    const rejected = mountApp(hosts[0] as unknown as HTMLElement, "<p>残る</p>", process, { css: '} body { display: none }', onError: error => errors.push(error) });
    assertEquals(hosts[0]!.querySelector("style"), null);
    assertEquals(hosts[0]!.querySelector("p")!.textContent, "残る");
    assertEquals(errors.length, 1);
    rejected.stop();
  } finally { mounted.forEach(app => app.stop()); await window.happyDOM.close(); }
});

Deno.test("他アプリと名前を共有する keyframes と layer を拒む", () => {
  for (const css of [
    "@keyframes shared { from { opacity: 0 } to { opacity: 1 } }",
    "@-webkit-keyframes shared { from { opacity: 0 } to { opacity: 1 } }",
    "@layer shared { p { color: red } }",
    "@layer first, second;",
    "@media (width > 100px) { @keyframes shared { to { opacity: 1 } } }",
    "@supports (display: grid) { @layer shared { p { color: red } } }",
  ]) assertEquals(scopeCss(css, "1"), null, css);
});
