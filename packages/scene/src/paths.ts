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

/** app.json の入口をフォルダ内の相対パスに整える */
export function entryPaths(entry: { html: string; as: string }): { html: string; as: string } {
  const html = appPath(entry.html);
  const as = appPath(entry.as);
  if (!html || !as) throw new Error("アプリの入口は app.json のフォルダ内の相対パスにしてください。");
  return { html, as };
}

/** アイコンのパスを整える。指定が無ければ読まない */
export function iconPath(icon?: string): string | undefined {
  if (icon === undefined) return undefined;
  const path = appPath(icon);
  if (!path) throw new Error("アプリのアイコンは app.json のフォルダ内の相対パスにしてください。");
  return path;
}
