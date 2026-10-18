/**
 * Node 専用。フォルダからパノプリを作る。
 *
 * @packageDocumentation
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { createPanoplie, type BinettePanoplie } from "./panoplie.ts";

/**
 * フォルダの中身からパノプリを作る。`.bina` はビネットとして検査し、ほかはファイルとして入れる。
 *
 * 読むのは呼んだときの 1 回だけ。シンボリックリンクと隠しファイル（`.` 始まり）は入れない。
 *
 * @param root 読むフォルダ
 * @throws {Error} ビネットの形式が正しくないときなど、{@link createPanoplie} と同じ理由のとき
 *
 * @example
 * ```ts
 * import { importPanoplie } from "@binette/coulisses/node";
 * const panoplie = await importPanoplie("/srv/site");
 * ```
 */
export async function importPanoplie(root: string): Promise<BinettePanoplie> {
  const binettes: Record<string, unknown> = {};
  const files: Record<string, Uint8Array> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const key = relative(root, path).split(sep).join("/");
    if (key.split("/").some(part => part.startsWith("."))) continue;
    const body = await readFile(path);
    if (key.endsWith(".bina")) {
      try {
        binettes[key.slice(0, -".bina".length)] = JSON.parse(body.toString("utf8"));
      } catch {
        throw new Error(`/${key}: JSON として読めません。`);
      }
    } else {
      files[key] = new Uint8Array(body);
    }
  }
  return createPanoplie(binettes, files);
}
