import { assertEquals } from "@std/assert";
import { scopeCss } from "../src/sanitize.ts";

Deno.test("CSS の外部読み込みと scope からの脱出を拒む", () => {
  for (const css of [
    'p { content: "\n} } body { color: red } /*" }',
    "} body { color: red }", "p {", "/* 未完", 'p { content: "未完 }',
    '@import "https://example.com/a.css";', '@namespace svg "https://example.com";',
    'p { background: url(https://example.com/a.png) }', 'p { background: url("/a.png") }',
    String.raw`p { background: u\72l(https://example.com/a.png) }`,
    String.raw`@\69mport "https://example.com/a.css";`,
    'p { background: image-set("https://example.com/a.png" 1x) }',
    'p { background: url/**/(https://example.com/a.png) }',
    '@font-face { font-family: remote; src: url(data:font/woff;base64,AA==) }',
    '@property --global { syntax: "<color>"; inherits: true; initial-value: red }',
  ]) assertEquals(scopeCss(css, "1"), null, css);
});

Deno.test("CSS の条件規則・文字列・data URL を保つ", () => {
  for (const css of [
    ':scope { color: var(--bina-ui-color) }',
    '@media (width > 500px) { p { color: red } }',
    '@container bar (width < 720px) { p { display: none } }',
    '@supports (color: light-dark(white, black)) { p { color: red } }',
    'p::before { content: "}"; background: url("data:image/png;base64,AA==") }',
    '/* { */ p { color: red }',
  ]) assertEquals(scopeCss(css, "1")?.includes(css), true, css);
  assertEquals(scopeCss("p {}", '\"] body {'), null);
});
