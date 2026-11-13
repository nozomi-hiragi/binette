import type { SystemUi } from "@binette/regie";

type Request = Parameters<NonNullable<SystemUi["openUrl"]>>[0];

/** Keep window.open in the confirmation click, where browser activation is available. */
export function mountOpenUrl(stage: HTMLElement) {
  const document = stage.ownerDocument;
  const dialog = document.createElement("dialog");
  dialog.className = "bina-shell-install-dialog bina-shell-confirm bina-shell-open-url";
  const title = document.createElement("h2");
  title.id = `bina-open-url-${crypto.randomUUID()}`;
  title.textContent = "外のページを開きますか？";
  dialog.setAttribute("aria-labelledby", title.id);
  const name = document.createElement("p");
  name.className = "bina-shell-confirm-source";
  const url = document.createElement("p");
  url.style.overflowWrap = "anywhere";
  url.style.maxHeight = "40vh";
  url.style.overflow = "auto";
  const actions = document.createElement("div");
  actions.className = "bina-shell-confirm-actions";
  const cancel = document.createElement("button");
  cancel.type = "button"; cancel.className = "bina-shell-button"; cancel.textContent = "やめる";
  const accept = document.createElement("button");
  accept.type = "button"; accept.className = "bina-shell-button bina-shell-confirm-accept"; accept.textContent = "開く";
  actions.append(cancel, accept); dialog.append(title, name, url, actions); stage.append(dialog);
  let current: Request | undefined;
  let stopped = false;
  const close = () => {
    current = undefined;
    if (typeof dialog.close === "function") { if (dialog.open) dialog.close(); }
    else dialog.removeAttribute("open");
  };
  accept.addEventListener("click", () => {
    const request = current;
    // This must remain synchronous: awaiting a promise loses user activation.
    if (request?.isActive()) document.defaultView?.open(request.url, "_blank", "noopener,noreferrer");
    close();
  });
  cancel.addEventListener("click", close);
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  dialog.addEventListener("close", () => { if (!dialog.open) current = undefined; });
  return {
    show(request: Request): void {
      if (stopped || current || !request.isActive()) return;
      let target: URL;
      try { target = new URL(request.url); } catch { return; }
      if (target.protocol !== "https:") return;
      current = { ...request, url: target.href };
      name.textContent = request.name; url.textContent = target.href;
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    },
    stop() { stopped = true; close(); dialog.remove(); },
  };
}
