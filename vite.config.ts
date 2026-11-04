import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { resolve } from "node:path";

// The owner app (wall, This week, Setup, a post) is a Vite + Preact app
// built into dist/client, which the Worker serves as static assets.
export default defineConfig({
  plugins: [preact()],
  root: "src/app",
  publicDir: resolve(__dirname, "public"),
  resolve: { alias: { "@shared": resolve(__dirname, "src/shared") } },
  build: {
    outDir: resolve(__dirname, "dist/client"),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: { input: resolve(__dirname, "src/app/index.html") },
  },
});
