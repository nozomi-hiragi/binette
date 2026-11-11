import type { RecoveryAction, SystemDistribution } from "@binette/regie";

/** アプリや Scene が動かなくても使える、カーネルの復旧画面。 */
export function showRecovery(container: HTMLElement, distribution: SystemDistribution, error?: unknown): void {
  const document = container.ownerDocument;
  const root = document.createElement("main");
  root.style.cssText = "padding:24px;overflow:auto;max-width:48rem;line-height:1.6";
  const title = document.createElement("h1");
  title.textContent = "Binette の復旧";
  const detail = document.createElement("p");
  detail.setAttribute("role", "alert");
  detail.style.overflowWrap = "anywhere";
  detail.textContent = error === undefined ? "復旧する操作を選んでください。" : `起動できませんでした: ${error instanceof Error ? error.message : String(error)}`;
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const buttons: HTMLButtonElement[] = [];
  const button = (label: string, action: () => Promise<void>) => {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = label;
    node.style.cssText = "display:block;margin:12px 0;padding:12px;font:inherit";
    node.addEventListener("click", () => {
      for (const button of buttons) button.disabled = true;
      status.textContent = "操作しています…";
      void action().then(() => { status.textContent = "操作が完了しました。「起動し直す」を押してください。"; }).catch((failure: unknown) => {
        status.textContent = "操作に失敗しました。";
        detail.textContent = failure instanceof Error ? failure.message : String(failure);
      }).finally(() => { for (const button of buttons) button.disabled = false; });
    });
    buttons.push(node);
    root.append(node);
  };
  root.append(title, detail);
  for (const [action, label] of [
    ["clear-user", "/user の変更を消す"],
    ["refetch-system", "/system を取り直す"],
    ["clear-all", "全部消す（アプリとデータを含む）"],
  ] as const satisfies readonly (readonly [RecoveryAction, string])[]) {
    button(label, () => distribution.recover(action));
  }
  button("起動し直す", () => {
    const url = new URL(location.href);
    url.searchParams.delete("recovery");
    location.assign(url);
    return Promise.resolve();
  });
  root.append(status);
  container.replaceChildren(root);
}
