import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  build: {
    target: "es2023",
    sourcemap: false,
    rollupOptions: {
      input: {
        studio: path.resolve(import.meta.dirname, "index.html"),
        "render-worker": path.resolve(
          import.meta.dirname,
          "render-worker.html",
        ),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:4100", ws: true },
      "/bootstrap": { target: "http://127.0.0.1:4100" },
    },
  },
});
