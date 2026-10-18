import type { BinetteAsset } from "@binette/core";

export type AssetResolver = (asset: BinetteAsset) => Promise<Response>;

export interface ResolverOptions {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}

const contentTypes: Record<string, string> = {
  js: "text/javascript", css: "text/css", html: "text/html", svg: "image/svg+xml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", json: "application/json",
};

export function createResolver(options: ResolverOptions): AssetResolver {
  return async (asset) => {
    if (asset.content !== undefined) {
      return new Response(asset.content, { headers: { "content-type": contentTypes[asset.type] ?? "text/plain" } });
    }
    return options.fetch(asset.src);
  };
}
