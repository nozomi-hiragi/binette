/** app.json のフォルダ内の相対パスに揃える。外に出るパスは受け付けない */
export function appPath(path: string): string | null {
  if (path.startsWith("/") || path.includes("\\") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)) return null;
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
