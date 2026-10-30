import { assert, assertEquals } from "@std/assert";
import type { DomOp } from "@binette/core";
import { Window } from "happy-dom";
import { createUiDom } from "../src/index.ts";
// AS のアプリを Régie で組み立て、本物の Worker を経て描く。Régie はテストでだけ使う
import { type RegieWorker, startProcess } from "../../regie/src/index.ts";
import { buildApp } from "../../regie/src/build.ts";
import { workerSource } from "../../regie/src/worker.ts";

const libraries = { "jsr:@binette/replique": await Deno.readTextFile(new URL("../../replique/src/index.ts", import.meta.url)) };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = performance.now() + 10000;
  while (!condition() && performance.now() < deadline) await sleep(5);
  assert(condition(), "待っても状態が変わりませんでした");
}
function realWorker(): RegieWorker {
  const url = URL.createObjectURL(new Blob([workerSource()], { type: "text/javascript" }));
  try { return new Worker(url, { type: "module" }); }
  finally { URL.revokeObjectURL(url); }
}

Deno.test("AS の見た目の修飾は Worker を経てクラスと属性になり、状態の変化で付け外しされる", async () => {
  const code = `import { App, launch } from "jsr:@binette/replique";
import { View, button, column, input, row, text } from "jsr:@binette/replique/ui";
let on = false;
function flip(): void { on = !on; }
function typed(_s: string): void {}
class Demo extends App {
  build(): View {
    const header = row([text("デザイナー").bold(), text("保存しません").tone(on ? "" : "muted").small()]).divider("bottom").surface("surface");
    const stepper = row([button("−", flip).variant("subtle"), input("16", typed).mono().placeholder("なし"), button("＋", flip)]).surface("field").width(160);
    const body = row([column([button("木", flip).variant("ghost").selected(on).grow()]).scroll().fill().width(240), column([stepper]).fill().grow().center().surface("sunken")]).fill().collapse();
    const code = column([input("column([])", typed).multiline().mono().height(120)]).surface("dark").minHeight(130);
    return column([header, body, code, button("grow", flip).toggle(on).label("伸ばす")]).fill();
  }
}
launch(new Demo());`;
  const files: Record<string, string> = {
    "app.json": JSON.stringify({ id: "looks", name: "見た目", entry: { as: "main.ts" } }),
    "main.ts": code,
  };
  const built = await buildApp(path => Promise.resolve(files[path]!), { libraries });
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  const process = await startProcess(built.wasm, { createWorker: realWorker });
  const dom = createUiDom(host, process);
  const batches: DomOp[][] = [];
  try {
    process.attach(ops => { batches.push(ops); dom.apply(ops); });
    await process.begin();
    const toggle = host.querySelector('[role="switch"]') as HTMLButtonElement | null;
    assert(toggle);
    assertEquals([toggle.getAttribute("aria-checked"), toggle.getAttribute("aria-label"), toggle.textContent], ["false", "伸ばす", ""]);
    const root = host.querySelector(".bina-ui-column")!;
    assert(root.classList.contains("bina-ui-fill"));
    const muted = host.querySelector(".bina-ui-tone-muted")!;
    assert(muted.classList.contains("bina-ui-small"));
    assert(host.querySelector(".bina-ui-bold"));
    assert(host.querySelector(".bina-ui-surface-surface.bina-ui-divider-bottom"));
    const field = host.querySelector(".bina-ui-surface-field") as HTMLElement;
    assertEquals(field.style.getPropertyValue("--bina-ui-width"), "160px");
    assertEquals(host.querySelector("input")!.getAttribute("placeholder"), "なし");
    assert(host.querySelector("input")!.classList.contains("bina-ui-mono"));
    const tree = host.querySelector(".bina-ui-variant-ghost")!;
    assertEquals([tree.getAttribute("aria-pressed"), tree.classList.contains("bina-ui-selected")], ["false", false]);
    assert(host.querySelector(".bina-ui-collapse.bina-ui-fill"));
    assert(host.querySelector(".bina-ui-scroll.bina-ui-fill.bina-ui-width"));
    assert(host.querySelector(".bina-ui-surface-sunken.bina-ui-center.bina-ui-grow"));
    const textarea = host.querySelector("textarea")!;
    assertEquals(textarea.style.getPropertyValue("--bina-ui-height"), "120px");
    assertEquals((host.querySelector(".bina-ui-surface-dark") as HTMLElement).style.getPropertyValue("min-height"), "130px");

    toggle.click();
    await waitFor(() => toggle.getAttribute("aria-checked") === "true");
    assertEquals([tree.getAttribute("aria-pressed"), tree.classList.contains("bina-ui-selected")], ["true", true]);
    assertEquals(muted.classList.contains("bina-ui-tone-muted"), false);
    assert(muted.classList.contains("bina-ui-small"));
    assertEquals(host.querySelector('[role="switch"]'), toggle);
    assert(batches.flat().some(op => op.op === "ui-update" && op.toggle === true));
  } finally { process.stop(); dom.clear(); dom.stop(); await window.happyDOM.close(); }
});
