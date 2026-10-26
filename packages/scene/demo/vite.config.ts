import { fileURLToPath } from "node:url";
import { defaultClientConditions, defineConfig } from "vite";

// ワークスペースのパッケージをビルドせずにソースから読む。アプリの例（examples/）はそのまま GET で取れるようにする
export default defineConfig({
  publicDir: fileURLToPath(new URL("../../../examples", import.meta.url)),
  resolve: { conditions: ["@binette/source", ...defaultClientConditions] },
});
