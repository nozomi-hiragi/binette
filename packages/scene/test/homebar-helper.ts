/** Cadre の枠（ホーム・ドック・時計）を操作する、テスト用の手順。 */

/** 枠に見えているボタンの aria-label を、置き場と並びの順に返す */
export function barLabels(element: HTMLElement): string[] {
  return [...element.querySelectorAll<HTMLElement>("[data-bina-reserve] button")]
    .filter(button => !button.closest("[hidden]")).map(button => button.getAttribute("aria-label") ?? "");
}

/** ドックのアプリのボタンを右クリックし、メニューの項目を押す */
export function chooseFromMenu(element: HTMLElement, name: string, item: "開く" | "閉じる"): void {
  const button = element.querySelector<HTMLElement>(`[data-bina-key=dock] [aria-label="${name}を開く"]`);
  if (!button) throw new Error(`ドックに ${name} がありません`);
  const window = element.ownerDocument.defaultView!;
  button.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  const found = [...element.querySelectorAll<HTMLElement>('.bina-ui-menu [role="menuitem"]')].find(node => node.textContent === item);
  if (!found) throw new Error(`メニューに「${item}」がありません`);
  found.click();
}
