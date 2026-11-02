/** SW と目録が同じカーネルを指すために、キャッシュ名の全文を使う。 */
export function kernelVersion(source: string): string {
  const version = source.match(/const CACHE = "([^"]+)";/)?.[1];
  if (!version) throw new Error("sw.js にキャッシュの版がありません。");
  return version;
}

/** system と kernel のどちらが変わっても、表示する版を変える。 */
export async function systemLabel(packageVersion: string, version: string, kernel: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([version, kernel]));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${packageVersion}+${hash.slice(0, 8)}`;
}
