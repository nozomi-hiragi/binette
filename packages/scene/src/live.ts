/** インストール済みとみなす表示モード。fullscreen は通常のタブでも使えるので含めない */
const DISPLAY_MODES = ["standalone", "minimal-ui", "window-controls-overlay"];

function displayModes(window: Window | null): MediaQueryList[] {
  return DISPLAY_MODES.flatMap(mode => {
    try {
      const query = window?.matchMedia?.(`(display-mode: ${mode})`);
      return query ? [query] : [];
    } catch { return []; }
  });
}

/** ページの表示モードと iPhone の standalone から、インストール済みかを返す */
export function isInstalled(window: Window | null): boolean {
  return (window?.navigator as (Navigator & { standalone?: boolean }) | undefined)?.standalone === true ||
    displayModes(window).some(query => query.matches === true);
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
}

/** OS の枠にライブモードの表示を作る。アプリには渡さない */
export function mountLiveMode(stage: HTMLElement, installedOverride?: boolean): {
  button: HTMLButtonElement;
  requireInstall(reason: string): boolean;
  stop(): void;
} {
  const document = stage.ownerDocument;
  const window = document.defaultView;
  const queries = installedOverride === undefined ? displayModes(window) : [];
  let installed = installedOverride ?? isInstalled(window);
  let prompt: InstallPromptEvent | undefined;
  let stopped = false;
  const watermark = document.createElement("span");
  watermark.className = "bina-shell-live";
  watermark.textContent = "ライブモード";
  watermark.setAttribute("aria-hidden", "true");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bina-shell-button bina-shell-install";
  button.textContent = "インストール";
  button.setAttribute("aria-label", "ライブモード：Binette をインストール");
  const dialog = document.createElement("dialog");
  dialog.className = "bina-shell-install-dialog";
  const title = document.createElement("h2");
  title.id = `bina-install-${crypto.randomUUID()}`;
  title.textContent = "Binette のインストール";
  dialog.setAttribute("aria-labelledby", title.id);
  const reason = document.createElement("p");
  const steps = document.createElement("p");
  const userAgent = window?.navigator.userAgent ?? "";
  steps.textContent = /iPhone|iPad|iPod/.test(userAgent)
    ? "Safari の共有 → ホーム画面に追加を選んでください。"
    : "ブラウザのメニューから「アプリをインストール」または「ホーム画面に追加」を選んでください。";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "bina-shell-button";
  close.textContent = "閉じる";
  const closeDialog = () => {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  };
  close.addEventListener("click", closeDialog);
  dialog.append(title, reason, steps, close);
  stage.append(watermark, dialog);
  const showInstructions = (message = "") => {
    if (stopped) return;
    reason.textContent = message;
    reason.hidden = !message;
    if (dialog.open) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  };
  const render = () => {
    watermark.hidden = installed;
    button.hidden = installed;
    if (installed) { prompt = undefined; closeDialog(); }
  };
  const updateMode = () => { installed = isInstalled(window); render(); };
  const appInstalled = () => { installed = true; render(); };
  const beforeInstall = (event: Event) => {
    event.preventDefault();
    if (!installed && typeof (event as InstallPromptEvent).prompt === "function") prompt = event as InstallPromptEvent;
  };
  const install = async () => {
    if (installed || stopped) return;
    const pending = prompt;
    prompt = undefined;
    if (!pending) { showInstructions(); return; }
    button.disabled = true;
    try { await pending.prompt(); }
    catch { if (!installed) showInstructions(); }
    finally { button.disabled = false; }
  };
  button.addEventListener("click", install);
  for (const query of queries) query.addEventListener?.("change", updateMode);
  window?.addEventListener("beforeinstallprompt", beforeInstall);
  if (installedOverride === undefined) window?.addEventListener("appinstalled", appInstalled);
  render();
  return {
    button,
    requireInstall(message) {
      if (installed) return true;
      showInstructions(message);
      return false;
    },
    stop() {
      stopped = true;
      prompt = undefined;
      for (const query of queries) query.removeEventListener?.("change", updateMode);
      window?.removeEventListener("beforeinstallprompt", beforeInstall);
      window?.removeEventListener("appinstalled", appInstalled);
      button.removeEventListener("click", install);
      close.removeEventListener("click", closeDialog);
      closeDialog();
      watermark.remove(); dialog.remove(); button.remove();
    },
  };
}
