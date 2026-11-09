/**
 * index.html の静的なブート画面の段階と進み具合を書き換える。
 * 画面が無ければ何もしない。
 */

const MB = 1024 * 1024;

function screen(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>(".boot-screen");
}

/** 段階を一行に出し、棒を不定の動きに戻す。 */
export function setBootStage(stage: string, root: ParentNode = document): void {
  const view = screen(root);
  if (!view) return;
  const stageEl = view.querySelector(".boot-stage");
  // 同じ文言を書き直すと読み上げが繰り返されるので、変わったときだけ書く
  if (stageEl && stageEl.textContent !== stage) stageEl.textContent = stage;
  const detail = view.querySelector(".boot-detail");
  if (detail) detail.textContent = "";
  view.classList.remove("boot-determinate");
  const bar = view.querySelector<HTMLElement>(".boot-bar");
  if (bar) bar.style.width = "";
  const note = view.querySelector<HTMLElement>(".boot-note");
  if (note) note.hidden = true;
}

/** システムの取得の進み具合を棒とバイト数に出す。 */
export function setBootProgress(
  progress: { loaded: number; total: number },
  root: ParentNode = document,
): void {
  const view = screen(root);
  if (!view) return;
  const { loaded, total } = progress;
  view.classList.add("boot-determinate");
  const stage = "システムを取得中";
  const stageEl = view.querySelector(".boot-stage");
  if (stageEl && stageEl.textContent !== stage) stageEl.textContent = stage;
  // 数字は aria-hidden の欄に書き、更新のたびに読み上げさせない
  const detail = view.querySelector(".boot-detail");
  if (detail) detail.textContent = ` ${(loaded / MB).toFixed(1)} / ${(total / MB).toFixed(1)} MB`;
  const bar = view.querySelector<HTMLElement>(".boot-bar");
  if (bar) bar.style.width = `${total > 0 ? Math.min(100, Math.max(0, loaded / total * 100)) : 0}%`;
  const note = view.querySelector<HTMLElement>(".boot-note");
  if (note) note.hidden = false;
}
