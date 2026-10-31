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

/** ライブモードの状態と操作。インストールのボタンはホームバーが描く */
export interface LiveMode {
  /** インストール済みか。true ならボタンを出さない */
  readonly installed: boolean;
  /** prompt の結果を待っている間は true。ボタンを押せなくする */
  readonly busy: boolean;
  /** インストールのボタンを押したときの処理 */
  install(): Promise<void>;
  requireInstall(reason: string): boolean;
  stop(): void;
}

/** OS の枠にライブモードの透かしと手順を作る。installed・busy が変わったら onChange を呼ぶ。アプリには渡さない */
export function mountLiveMode(stage: HTMLElement, installedOverride?: boolean, onChange: () => void = () => {}): LiveMode {
  const document = stage.ownerDocument;
  const window = document.defaultView;
  const queries = installedOverride === undefined ? displayModes(window) : [];
  let installed = installedOverride ?? isInstalled(window);
  let prompt: InstallPromptEvent | undefined;
  let stopped = false;
  let busy = false;
  const watermark = document.createElement("span");
  watermark.className = "bina-shell-live";
  watermark.textContent = "ライブモード";
  watermark.setAttribute("aria-hidden", "true");
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
    if (installed) { prompt = undefined; closeDialog(); }
    if (!stopped) onChange();
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
    busy = true; onChange();
    try { await pending.prompt(); }
    catch { if (!installed) showInstructions(); }
    finally { busy = false; if (!stopped) onChange(); }
  };
  for (const query of queries) query.addEventListener?.("change", updateMode);
  window?.addEventListener("beforeinstallprompt", beforeInstall);
  if (installedOverride === undefined) window?.addEventListener("appinstalled", appInstalled);
  watermark.hidden = installed;
  return {
    get installed() { return installed; },
    get busy() { return busy; },
    install,
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
      close.removeEventListener("click", closeDialog);
      closeDialog();
      watermark.remove(); dialog.remove();
    },
  };
}
