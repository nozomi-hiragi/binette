import { defaultClientConditions, defineConfig } from "vite";

// ワークスペースの @binette/core をビルドせずにソースから読む
export default defineConfig({
  resolve: { conditions: ["@binette/source", ...defaultClientConditions] },
});
