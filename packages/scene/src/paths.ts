/**
 * app.json のフォルダ内の相対パスに揃える。外に出るパスは受け付けない。
 * `%2e%2e` のようなエンコードは URL で読むと `..` になるので、`%` を含むパスも受け付けない
 */
export function appPath(path: string): string | null {
  if (path.includes("%") || path.startsWith("/") || path.includes("\\") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)) return null;
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

/** AS の入口と同じフォルダに置く生成ファイルのパス */
export function bindingsPath(entry: string): string {
  return entry.slice(0, entry.lastIndexOf("/") + 1) + "bina.ts";
}

/** app.json の入口のパスを整え、生成する bina.ts のパスと合わせて返す */
export function entryPaths(entry: { html: string; as: string }): { html: string; as: string; bindings: string } {
  const html = appPath(entry.html);
  const as = appPath(entry.as);
  if (!html || !as) throw new Error("アプリの入口は app.json のフォルダ内の相対パスにしてください。");
  const bindings = bindingsPath(as);
  // 入口が bina.ts だと、生成したファイルで入口を上書きしてしまう
  if (bindings === as) throw new Error("entry.as に bina.ts という名前は使えません。bina.ts は HTML から自動生成するファイルです。");
  return { html, as, bindings };
}
