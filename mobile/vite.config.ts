import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const PROD_ORIGIN = "https://cgrafsysvm.camara.leg.br";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
  },
  server: {
    port: 5180,
    host: true,
    proxy: {
      "/sagra/api/ws": {
        target: PROD_ORIGIN,
        changeOrigin: true,
        secure: false,
        ws: true,
      },
      "/sagra/api": {
        target: PROD_ORIGIN,
        changeOrigin: true,
        secure: false,
        cookieDomainRewrite: "",
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
