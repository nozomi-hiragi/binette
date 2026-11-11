/** ホームバーを操作する、テスト用の手順。 */

/** ホームバーに見えているボタンの aria-label を並びの順に返す */
export function barLabels(element: HTMLElement): string[] {
  return [...element.querySelectorAll<HTMLElement>("[data-bina-key=homebar] button")]
    .filter(button => !button.closest("[hidden]")).map(button => button.getAttribute("aria-label") ?? "");
}

/** ホームバーのアプリのボタンを右クリックし、メニューの項目を押す */
export function chooseFromMenu(element: HTMLElement, name: string, item: "開く" | "閉じる"): void {
  const button = element.querySelector<HTMLElement>(`[data-bina-key=homebar] [aria-label="${name}を開く"]`);
  if (!button) throw new Error(`ホームバーに ${name} がありません`);
  const window = element.ownerDocument.defaultView!;
  button.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  const found = [...element.querySelectorAll<HTMLElement>('.bina-ui-menu [role="menuitem"]')].find(node => node.textContent === item);
  if (!found) throw new Error(`メニューに「${item}」がありません`);
  found.click();
}
