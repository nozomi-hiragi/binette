import { defineConfig } from "vite";

// このファイルのフォルダ。Vite は設定を Deno の上で読むので import.meta.dirname が使える
const here = import.meta.dirname!;

// ワークスペースのパッケージをビルドせずにソースから読む。アプリの例（examples/）はそのまま GET で取れるようにする
export default defineConfig({
  publicDir: `${here}/../../../examples`,
  resolve: {
    alias: {
      "@binette/core": `${here}/../../core/src/index.ts`,
      "@binette/regie": `${here}/../../regie/src/index.ts`,
      "@binette/scene": `${here}/../src/index.ts`,
    },
  },
});
