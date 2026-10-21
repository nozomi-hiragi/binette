import type { BinetteAsset } from "@binette/core";

/** asset の中身を `Response` として返す関数 */
export type AssetResolver = (asset: BinetteAsset) => Promise<Response>;

/** {@link createResolver} の設定 */
export interface ResolverOptions {
  /** `src` を持つ asset を取る関数 */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}

const contentTypes: Record<string, string> = {
  js: "text/javascript", css: "text/css", html: "text/html", svg: "image/svg+xml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", json: "application/json",
};

/** asset を取る関数を作る。`content` はその文字列を、`src` は `fetch` で取ったものを返す */
export function createResolver(options: ResolverOptions): AssetResolver {
  return async (asset) => {
    if (asset.content !== undefined) {
      return new Response(asset.content, { headers: { "content-type": contentTypes[asset.type] ?? "text/plain" } });
    }
    return options.fetch(asset.src);
  };
}
