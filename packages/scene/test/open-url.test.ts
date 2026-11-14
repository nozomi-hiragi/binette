import { assert, assertEquals } from "@std/assert";
import { Window } from "happy-dom";
import { createShellUi } from "../src/index.ts";

Deno.test("External pages require HTTPS and a confirmation click, and repeated requests are ignored", async () => {
  const window = new Window();
  const element = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.append(element as never);
  const opened: unknown[][] = [];
  window.open = (...args) => { opened.push(args); return null; };
  const ui = createShellUi(element, { installed: true });
  const dialog = element.querySelector<HTMLDialogElement>(".bina-shell-open-url")!;
  const button = (label: string) => [...dialog.querySelectorAll("button")].find(node => node.textContent === label)!;
  let active = true;
  const request = (url = "https://example.com/page") => ({ name: "Test <app>", url, isActive: () => active });
  try {
    for (const url of ["http://example.com", "javascript:alert(1)", "data:text/html,test", "file:///tmp/test", "/relative", "https://[", ""]) {
      ui.openUrl!(request(url)); assert(!dialog.open, url);
    }
    active = false; ui.openUrl!(request()); assert(!dialog.open); active = true;
    ui.openUrl!(request()); assert(dialog.open);
    assertEquals(dialog.querySelector("h2")!.textContent, "外のページを開きますか？");
    assertEquals([...dialog.querySelectorAll("p")].map(node => node.textContent), ["Test <app>", "https://example.com/page"]);
    assertEquals(opened, []);
    ui.openUrl!(request("https://other.test/"));
    button("開く").click(); assert(!dialog.open);
    assertEquals(opened, [["https://example.com/page", "_blank", "noopener,noreferrer"]]);
    ui.openUrl!(request()); button("やめる").click(); assert(!dialog.open); assertEquals(opened.length, 1);
    ui.openUrl!(request()); dialog.dispatchEvent(new window.Event("cancel", { cancelable: true }) as unknown as Event);
    assert(!dialog.open); assertEquals(opened.length, 1);
    ui.openUrl!(request()); active = false; button("開く").click(); assertEquals(opened.length, 1);
    active = true; ui.openUrl!(request()); ui.stop(); button("開く").click(); assertEquals(opened.length, 1);
  } finally { ui.stop(); await window.happyDOM.close(); }
});
