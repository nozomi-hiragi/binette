/**
 * ビネットと asset を配信する Coulisses。
 *
 * 配るものは {@link BinettePanoplie} にまとめて渡す。この入口は `node:fs` を使わないので、Node 以外（Cloudflare Workers など）でも動く。
 * フォルダから作るときは `@binette/coulisses/node` の `importPanoplie` を使う。
 *
 * @packageDocumentation
 */
import { parseBinette, type Binette } from "@binette/core";
import type { BinettePanoplie } from "./panoplie.ts";

export { contentTypeOf, createPanoplie, parsePanoplie } from "./panoplie.ts";
export type { BinettePanoplie, PanoplieFile, PanoplieFileInput } from "./panoplie.ts";

/**
 * ビネットを書くときの補助。形式を検査して、そのまま返す。
 *
 * @throws {BinetteError} 形式が正しくないとき
 */
export function defineBinette(value: unknown): Binette {
  return parseBinette(JSON.stringify(value));
}

/** {@link createCoulisses} の設定 */
export interface CoulissesOptions {
  /** 配るものの一式 */
  panoplie: BinettePanoplie;
  /** CORS で許可する origin。指定すると CORS ヘッダーと OPTIONS の応答を返す */
  cors?: string;
}

/**
 * パノプリの中身を配信する、標準の Fetch API の形のハンドラーを作る。
 *
 * GET と HEAD に応える。`/<名前>.bina` はパノプリのビネットを、ほかのパスはファイルを返す。無いものは 404。
 *
 * @example
 * ```ts
 * const handler = createCoulisses({ panoplie });
 * const response = await handler(new Request("http://localhost/index.bina"));
 * ```
 */
export function createCoulisses(options: CoulissesOptions): (request: Request) => Promise<Response> {
  const { binettes, files } = options.panoplie;
  const encoder = new TextEncoder();
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
    let key: string;
    try {
      key = decodeURIComponent(new URL(request.url).pathname).slice(1);
    } catch {
      return respond(404);
    }
    let body: Uint8Array;
    if (key.endsWith(".bina")) {
      const binette = Object.hasOwn(binettes, key.slice(0, -".bina".length)) ? binettes[key.slice(0, -".bina".length)] : undefined;
      if (!binette) return respond(404);
      body = encoder.encode(JSON.stringify(binette));
      headers.set("Content-Type", "application/json; charset=utf-8");
    } else {
      const file = Object.hasOwn(files, key) ? files[key] : undefined;
      if (!file) return respond(404);
      body = file.body;
      headers.set("Content-Type", file.type);
    }
    headers.set("Content-Length", String(body.byteLength));
    return respond(200, body);
  };
}
