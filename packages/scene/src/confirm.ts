import type { InstallConfirmation } from "@binette/regie";

/** インストールと権限が増える更新の確認。カーネルが画面の上に直接出し、アプリは飛ばせない */
export interface InstallConfirm {
  confirm(request: InstallConfirmation): Promise<boolean>;
  stop(): void;
}

function host(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

export function mountInstallConfirm(stage: HTMLElement): InstallConfirm {
  const document = stage.ownerDocument;
  const dialog = document.createElement("dialog");
  dialog.className = "bina-shell-install-dialog bina-shell-confirm";
  const title = document.createElement("h2");
  title.id = `bina-confirm-${crypto.randomUUID()}`;
  dialog.setAttribute("aria-labelledby", title.id);
  const source = document.createElement("p");
  source.className = "bina-shell-confirm-source";
  const lead = document.createElement("p");
  const list = document.createElement("ul");
  list.className = "bina-shell-confirm-permissions";
  const actions = document.createElement("div");
  actions.className = "bina-shell-confirm-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "bina-shell-button";
  cancel.textContent = "やめる";
  const accept = document.createElement("button");
  accept.type = "button";
  accept.className = "bina-shell-button bina-shell-confirm-accept";
  accept.textContent = "許可して入れる";
  actions.append(cancel, accept);
  dialog.append(title, source, lead, list, actions);
  stage.append(dialog);

  // 確認は 1 つずつ出す。並列のインストールでも順に聞く
  const queue: { request: InstallConfirmation; resolve: (ok: boolean) => void }[] = [];
  let current: { request: InstallConfirmation; resolve: (ok: boolean) => void } | undefined;
  let stopped = false;

  const close = () => {
    if (typeof dialog.close === "function") { if (dialog.open) dialog.close(); }
    else dialog.removeAttribute("open");
  };
  const render = (request: InstallConfirmation) => {
    const update = request.added !== undefined;
    title.textContent = update ? `${request.name}を更新しますか？` : `${request.name}を入れますか？`;
    const from = request.list ? host(request.list) : "";
    source.textContent = request.listName ? `${request.listName}（${from}）` : from;
    source.hidden = source.textContent === "";
    const added = new Set(request.added ?? []);
    const names = Object.keys(request.permissions);
    if (update && added.size) lead.textContent = "この更新で、次の権限が増えます。";
    else if (names.length) lead.textContent = "このアプリは次の権限を使います。";
    else lead.textContent = "このアプリは権限を使いません。";
    list.replaceChildren();
    // 増える権限を先に並べて強調する
    const ordered = [...names.filter(name => added.has(name)), ...names.filter(name => !added.has(name))];
    for (const name of ordered) {
      const item = document.createElement("li");
      const label = document.createElement(added.has(name) ? "strong" : "span");
      label.textContent = added.has(name) ? `${name}（増える）` : name;
      item.append(label);
      const reason = request.permissions[name];
      if (reason) {
        const detail = document.createElement("span");
        detail.className = "bina-shell-confirm-reason";
        detail.textContent = `：${reason}`;
        item.append(detail);
      }
      list.append(item);
    }
    list.hidden = ordered.length === 0;
    accept.textContent = update ? "許可して更新する" : "許可して入れる";
  };
  const next = () => {
    if (stopped || current) return;
    current = queue.shift();
    if (!current) { close(); return; }
    render(current.request);
    if (dialog.open) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  };
  const answer = (ok: boolean) => {
    const entry = current;
    if (!entry) return;
    current = undefined;
    entry.resolve(ok);
    if (!queue.length) close();
    next();
  };
  accept.addEventListener("click", () => answer(true));
  cancel.addEventListener("click", () => answer(false));
  // Esc で閉じたときは、やめたとみなす
  dialog.addEventListener("cancel", event => { event.preventDefault(); answer(false); });

  return {
    confirm(request) {
      if (stopped) return Promise.resolve(false);
      return new Promise<boolean>(resolve => { queue.push({ request, resolve }); next(); });
    },
    stop() {
      if (stopped) return;
      stopped = true;
      current?.resolve(false);
      current = undefined;
      for (const entry of queue.splice(0)) entry.resolve(false);
      close();
      dialog.remove();
    },
  };
}
