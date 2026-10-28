import { defineConfig } from "vite";

// このファイルのフォルダ。Vite は設定を Deno の上で読むので import.meta.dirname が使える
const here = import.meta.dirname!;

// ワークスペースのパッケージをビルドせずにソースから読む。ビルド済みのアプリだけを配る
export default defineConfig({
  base: "./",
  publicDir: "public",
  build: {
    assetsInlineLimit: 0,
    rollupOptions: { external: ["assemblyscript/asc"] },
  },
  resolve: {
    alias: {
      "@binette/core": `${here}/packages/core/src/index.ts`,
      "@binette/regie/build": `${here}/packages/regie/src/build.ts`,
      "@binette/regie/cli": `${here}/packages/regie/src/cli.ts`,
      "@binette/regie": `${here}/packages/regie/src/index.ts`,
      "@binette/scene": `${here}/packages/scene/src/index.ts`,
    },
  },
});
