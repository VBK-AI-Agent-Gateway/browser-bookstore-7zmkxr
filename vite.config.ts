import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  build: { outDir: "dist", assetsDir: "assets", sourcemap: false, chunkSizeWarningLimit: 1500 },
  worker: { format: "es" },
});