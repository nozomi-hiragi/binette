import { defineConfig } from "vite";
import { kernelIntegrity } from "./scripts/kernel-integrity.ts";

// このファイルのフォルダ。Vite は設定を Deno の上で読むので import.meta.dirname が使える
const here = import.meta.dirname!;

// ワークスペースのパッケージをビルドせずにソースから読む。ビルド済みのアプリだけを配る
export default defineConfig({
  base: "./",
  // build:system が静的ファイルと生成した目録をここにまとめる。
  publicDir: ".binapp/public",
  plugins: [kernelIntegrity()],
  worker: {
    format: "es",
    rollupOptions: { output: { entryFileNames: "regie-worker.js" } },
  },
  build: {
    minify: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      external: ["assemblyscript/asc"],
      output: { entryFileNames: "regie.js", codeSplitting: false },
    },
  },
  resolve: {
    alias: {
      "@binette/decor/as": `${here}/packages/decor/src/as.ts?raw`,
      "@binette/decor/parts": `${here}/packages/decor/src/parts.ts?raw`,
      "@binette/decor": `${here}/packages/decor/src/index.ts`,
      "@binette/core": `${here}/packages/core/src/index.ts`,
      "@binette/regie/build": `${here}/packages/regie/src/build.ts`,
      "@binette/regie/cli": `${here}/packages/regie/src/cli.ts`,
      "@binette/regie": `${here}/packages/regie/src/index.ts`,
      "@binette/scene": `${here}/packages/scene/src/index.ts`,
    },
  },
});
