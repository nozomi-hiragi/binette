import type { SystemUi } from "@binette/regie";

type Request = Parameters<NonNullable<SystemUi["confirmNet"]>>[0];
type Answer = "allow" | "deny" | "later";

/** 更新で増えた通信先の確認。インストール確認と同じダイアログの部品を使う。 */
export function mountNetConfirm(stage: HTMLElement) {
  const document = stage.ownerDocument;
  const dialog = document.createElement("dialog");
  dialog.className = "bina-shell-install-dialog bina-shell-confirm bina-shell-net-confirm";
  const title = document.createElement("h2");
  title.id = `bina-net-confirm-${crypto.randomUUID()}`;
  dialog.setAttribute("aria-labelledby", title.id);
  const source = document.createElement("p");
  source.className = "bina-shell-confirm-source";
  const list = document.createElement("ul");
  list.className = "bina-shell-confirm-permissions";
  list.style.maxHeight = "40vh";
  list.style.overflow = "auto";
  list.style.overflowWrap = "anywhere";
  const actions = document.createElement("div");
  actions.className = "bina-shell-confirm-actions";
  dialog.append(title, source, list, actions);
  stage.append(dialog);
  const queue: { request: Request; resolve: (answer: Answer) => void }[] = [];
  let current: typeof queue[number] | undefined;
  let stopped = false;
  const close = () => {
    if (typeof dialog.close === "function") { if (dialog.open) dialog.close(); }
    else dialog.removeAttribute("open");
  };
  const next = () => {
    if (stopped || current) return;
    current = queue.shift();
    if (!current) { close(); return; }
    title.textContent = `${current.request.name}が、更新で追加された通信先につなごうとしています`;
    source.textContent = current.request.source;
    list.replaceChildren(...current.request.urls.map(url => {
      const item = document.createElement("li"); item.textContent = url; return item;
    }));
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
  };
  const answer = (value: Answer) => {
    const entry = current;
    if (!entry) return;
    current = undefined;
    entry.resolve(value);
    if (!queue.length) close();
    next();
  };
  for (const [label, value] of [["許可", "allow"], ["拒否", "deny"], ["あとで", "later"]] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bina-shell-button" + (value === "allow" ? " bina-shell-confirm-accept" : "");
    button.textContent = label;
    button.addEventListener("click", () => answer(value));
    actions.append(button);
  }
  dialog.addEventListener("cancel", event => { event.preventDefault(); answer("later"); });
  dialog.addEventListener("close", () => { if (!dialog.open) answer("later"); });
  return {
    confirm(request: Request): Promise<Answer> {
      if (stopped) return Promise.resolve("later");
      return new Promise(resolve => { queue.push({ request, resolve }); next(); });
    },
    stop() {
      stopped = true;
      current?.resolve("later"); current = undefined;
      for (const entry of queue.splice(0)) entry.resolve("later");
      close(); dialog.remove();
    },
  };
}
