/**
 * ビネットと asset を配信する Coulisses。
 *
 * 配るものは {@link BinettePanoplie} にまとめて渡し、あとから足すこともできる。
 * 配る部分はファイルシステムを使わない。`node:fs` が要るのはフォルダから作る {@link importPanoplie} だけ。
 *
 * @packageDocumentation
 */
import { parseBinette, type Binette } from "@binette/core";
import { addBinette, addFile, createPanoplie, type BinettePanoplie, type PanoplieFileInput } from "./panoplie.ts";

export { addBinette, addFile, contentTypeOf, createPanoplie, importPanoplie, parsePanoplie } from "./panoplie.ts";
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
  /** 最初に配るものの一式。省略すると空から始める */
  panoplie?: BinettePanoplie;
  /** CORS で許可する origin。指定すると CORS ヘッダーと OPTIONS の応答を返す */
  cors?: string;
}

/** パノプリの中身を配る Coulisses */
export interface Coulisses {
  /** リクエストに応える。標準の Fetch API の形なので、そのままサーバーにつなげる */
  fetch(request: Request): Promise<Response>;
  /** あとからビネットを足す。同じ名前があれば置き換える。検査は {@link addBinette} と同じ */
  addBinette(name: string, value: unknown): void;
  /** あとからファイルを足す。同じパスがあれば置き換える */
  addFile(path: string, file: PanoplieFileInput): void;
}

/**
 * パノプリの中身を配る Coulisses を作る。
 *
 * GET と HEAD に応える。`/<名前>.bina` はパノプリのビネットを、ほかのパスはファイルを返す。無いものは 404。
 *
 * @example
 * ```ts
 * const coulisses = createCoulisses({ panoplie: await importPanoplie("/srv/site") });
 * coulisses.addBinette("hello", { binette: "0.1", redirect: "/home" });
 * const response = await coulisses.fetch(new Request("http://localhost/index.bina"));
 * ```
 */
export function createCoulisses(options: CoulissesOptions = {}): Coulisses {
  // 渡されたパノプリを書き換えないよう写しを持つ
  const panoplie = createPanoplie();
  Object.assign(panoplie.binettes, options.panoplie?.binettes);
  Object.assign(panoplie.files, options.panoplie?.files);
  const { binettes, files } = panoplie;
  const encoder = new TextEncoder();
  const fetch = async (request: Request): Promise<Response> => {
    const headers = new Headers();
    if (options.cors !== undefined) headers.set("Access-Control-Allow-Origin", options.cors);
    const respond = (status: number, body: string | Uint8Array<ArrayBuffer> = "") =>
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
    let body: Uint8Array<ArrayBuffer>;
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
  return {
    fetch,
    addBinette: (name, value) => addBinette(panoplie, name, value),
    addFile: (path, file) => addFile(panoplie, path, file),
  };
}
