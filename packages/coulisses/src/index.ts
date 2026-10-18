import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { parseBinette, type Binette } from "@binette/core";

export function defineBinette(value: unknown): Binette {
  return parseBinette(value);
}

export interface CoulissesOptions {
  root: string;
  cors?: string;
}

const contentTypes: Record<string, string> = {
  ".bina": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function isInside(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== ".." && !child.startsWith("../") && !child.startsWith("..\\") && !isAbsolute(child);
}

export function createCoulisses(options: CoulissesOptions): (request: Request) => Promise<Response> {
  const root = resolve(options.root);
  return async request => {
    const headers = new Headers();
    if (options.cors !== undefined) headers.set("Access-Control-Allow-Origin", options.cors);
    const respond = (status: number, body: string | Uint8Array = "") =>
      new Response(request.method === "HEAD" || status === 204 ? null : body, { status, headers });
    if (request.method === "OPTIONS" && options.cors !== undefined) {
      headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      return respond(204);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      headers.set("Allow", options.cors === undefined ? "GET, HEAD" : "GET, HEAD, OPTIONS");
      return respond(405, "許可されていないメソッドです。");
    }
    let path: string;
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname);
      if (pathname.includes("\\") || pathname.includes("\0")) return respond(403);
      path = resolve(root, `.${pathname}`);
      if (!isInside(root, path)) return respond(403);
    } catch {
      return respond(403);
    }
    try {
      // シンボリックリンク経由でも公開ディレクトリの外へ出さない。
      const [actualRoot, actualPath] = await Promise.all([realpath(root), realpath(path)]);
      if (!isInside(actualRoot, actualPath)) return respond(403);
      if (!(await stat(actualPath)).isFile()) return respond(404);
      const body = await readFile(actualPath);
      const extension = extname(path).toLowerCase();
      if (extension === ".bina") {
        try {
          const value = parseBinette(JSON.parse(body.toString("utf8")));
          if (value.settings !== undefined && pathname !== "/index.bina") throw new Error("settings は入口 /index.bina にだけ書けます。");
        } catch (error) {
          headers.set("Content-Type", "text/plain; charset=utf-8");
          return respond(500, `Binette の形式が不正です: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      headers.set("Content-Type", contentTypes[extension] ?? "application/octet-stream");
      headers.set("Content-Length", String(body.byteLength));
      return respond(200, body);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return respond(404);
      return respond(500, "ファイルを読み込めませんでした。");
    }
  };
}
