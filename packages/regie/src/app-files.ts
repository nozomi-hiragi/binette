/** 空文字と相対パスを避け、通常の URI エンコードと衝突しない部品にする。 */
export function encodeAppPathSegment(value: string): string {
  if (value === "") return "%";
  if (value === "." || value === "..") return value.replaceAll(".", "%2E");
  return encodeURIComponent(value);
}

/** 保存先の部品を元の文字列に戻す。 */
export function decodeAppPathSegment(value: string): string {
  return value === "%" ? "" : decodeURIComponent(value);
}

/** アプリの ID と入手元から、記録とバイナリの保存先を求める。 */
export function appFilePaths(id: string, source: string): { record: string; wasm: string } {
  const directory = `/apps/${encodeAppPathSegment(id)}/${encodeAppPathSegment(source)}`;
  return { record: `${directory}/record.json`, wasm: `${directory}/app.wasm` };
}
