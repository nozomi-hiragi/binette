import { startSystem, type BinetteSystem, type SystemView } from "@binette/regie";
import { createShellUi, type ShellOptions, type MountedShell } from "../src/index.ts";

const systems = new WeakMap<HTMLElement, { system: BinetteSystem; view: SystemView }>();
/** Scene の表示と公開システム API をつなぐ。ライフサイクルの試験はバーの実装に依存しない。 */
export async function mountSystem(element: HTMLElement, options: ShellOptions): Promise<MountedShell> {
  const previous = [...element.childNodes];
  const ui = createShellUi(element, options);
  let view: SystemView = { instances: [], front: undefined, apps: [], clearError: false };
  const update = ui.update;
  ui.update = next => { view = next; const entry = systems.get(element); if (entry) entry.view = next; update(next); };
  try {
    const system = await startSystem({ ...options, ui });
    systems.set(element, { system, view });
    ui.bind(system);
    return { requireInstall: ui.requireInstall, stop() { system.stop(); ui.stop(); systems.delete(element); } };
  } catch (error) { ui.stop(); element.replaceChildren(...previous); throw error; }
}
export function systemView(element: HTMLElement): SystemView { return systems.get(element)!.view; }
export function operate(element: HTMLElement, name: string, action: "開く" | "閉じる"): void {
  const { system, view } = systems.get(element)!;
  if (name === "ホーム" && action === "開く") { void system.openHome(); return; }
  const instance = view.instances.find(instance => !instance.home && instance.name === name);
  if (!instance) throw new Error(`インスタンス ${name} がありません`);
  if (action === "閉じる") void system.close(instance.id);
  else void system.open(instance.key);
}
