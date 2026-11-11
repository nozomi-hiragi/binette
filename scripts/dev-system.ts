import type { Plugin } from "vite";

export function devSystem(): Plugin {
  let publicDir = "";
  return {
    name: "binette-dev-system",
    apply: "serve",
    configResolved(config) { publicDir = config.publicDir; },
    async transformIndexHtml() {
      const { version } = JSON.parse(await Deno.readTextFile(`${publicDir}/manifest.json`));
      if (typeof version !== "string" || !/^[0-9a-f]{64}$/.test(version)) {
        throw new Error("開発用のシステムの版が不正です。build:system を実行してください。");
      }
      return [{ tag: "meta", attrs: { name: "binette-dev-system", content: version }, injectTo: "head" }];
    },
  };
}
