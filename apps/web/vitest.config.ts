import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@sagra/ui/styles.css": path.resolve(__dirname, "../../packages/ui/src/styles.css"),
      "@sagra/ui": path.resolve(__dirname, "../../packages/ui/src/index.ts"),
      "@sagra/api-types": path.resolve(
        __dirname,
        "../../packages/api-types/src/index.ts",
      ),
      "virtual:pwa-register/react": path.resolve(
        __dirname,
        "./src/test/mocks/virtual-pwa-register-react.ts",
      ),
    },
  },
});
