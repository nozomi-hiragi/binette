import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// ワークスペースのパッケージをビルドせずにソースから読む。アプリの例（examples/）はそのまま GET で取れるようにする
export default defineConfig({
  publicDir: fileURLToPath(new URL("../../../examples", import.meta.url)),
  resolve: {
    alias: {
      "@binette/core": fileURLToPath(new URL("../../core/src/index.ts", import.meta.url)),
      "@binette/regie": fileURLToPath(new URL("../../regie/src/index.ts", import.meta.url)),
      "@binette/scene": fileURLToPath(new URL("../src/index.ts", import.meta.url)),
    },
  },
});
