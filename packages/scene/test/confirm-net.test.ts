import { assert, assertEquals } from "@std/assert";
import { Window } from "happy-dom";
import { createShellUi } from "../src/index.ts";

Deno.test("通信先の確認は一覧をスクロールでき、許可・拒否・あとで・Esc と終了を返す", async () => {
  const window = new Window();
  const element = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.append(element as never);
  const ui = createShellUi(element, { installed: true });
  try {
    const request = { name: "資料", source: "https://provider.test/", urls: Array.from({ length: 80 }, (_, i) => `https://example.com/${i}/`) };
    const dialog = element.querySelector<HTMLDialogElement>(".bina-shell-net-confirm")!;
    for (const [label, expected] of [["許可", "allow"], ["拒否", "deny"], ["あとで", "later"], ["Esc", "later"]]) {
      const result = ui.confirmNet!(request);
      assert(dialog.open);
      assertEquals(dialog.querySelector("h2")!.textContent, "資料が、更新で追加された通信先につなごうとしています");
      assertEquals(dialog.querySelectorAll("li").length, 80);
      assertEquals(dialog.querySelector("ul")!.style.maxHeight, "40vh");
      assertEquals(dialog.querySelector("ul")!.style.overflow, "auto");
      if (label === "Esc") dialog.dispatchEvent(new window.Event("cancel", { cancelable: true }) as unknown as Event);
      else [...dialog.querySelectorAll("button")].find(button => button.textContent === label)!.click();
      assertEquals(await result, expected);
      assert(!dialog.open);
    }
    const first = ui.confirmNet!(request); const second = ui.confirmNet!(request);
    ui.stop();
    assertEquals(await first, "later"); assertEquals(await second, "later");
  } finally { ui.stop(); await window.happyDOM.close(); }
});
