import type { IncomingMessage } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import type { Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Producao (intranet + cgraf.online): VITE_BASE_PATH=/sagra/; API em /sagra/api */
const basePath = process.env["VITE_BASE_PATH"]?.trim() || "/";

const pwaScope = basePath.endsWith("/") ? basePath : `${basePath}/`;

/** Rotas que o SW nao deve tratar como navegacao SPA. */
const pwaNavigateDenylist: RegExp[] = [
  /^\/api\//,
  /^\/sagra\/api\//,
  /^\/ws(\/|$)/,
  /^\/sagra\/ws(\/|$)/,
  /^\/meet(\/|$)/,
  /^\/host(\/|$)/,
  /^\/client(\/|$)/,
  /^\/shared(\/|$)/,
  /^\/vendor(\/|$)/,
  /^\/saagi(\/|$)/,
  /^\/apogee(\/|$)/,
  /^\/backup(\/|$)/,
  /\.html$/,
  /\/[^/]+\.[^/]+$/,
];
if (basePath !== "/" && basePath !== "") {
  const escaped = basePath.replace(/\/$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  pwaNavigateDenylist.unshift(new RegExp(`^${escaped}/api/`));
}

/**
 * Fallback só quando o browser acessa via localhost no próprio servidor dev.
 * Acesso LAN (outra máquina → http://10.120.2.11:5173) usa o IP real do cliente.
 */
const devClientIp = process.env["VITE_DEV_CLIENT_IP"]?.trim() || "10.120.2.11";

function normalizeClientIp(raw: string | undefined): string | null {
  if (!raw) return null;
  return raw.startsWith("::ffff:") ? raw.slice(7) : raw;
}

function isLoopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1";
}

/** IP do browser visto pelo Vite; repassado ao FastAPI em X-Forwarded-For. */
function resolveForwardedClientIp(req: IncomingMessage): string {
  const direct = normalizeClientIp(req.socket?.remoteAddress);
  if (direct && !isLoopback(direct)) {
    return direct;
  }
  return devClientIp;
}

function proxyWithClientIp(target: string) {
  let lastResetLogAt = 0;
  return {
    target,
    changeOrigin: true,
    ws: true,
    timeout: 120_000,
    proxyTimeout: 120_000,
    configure: (proxy: { on: (event: string, fn: (...args: unknown[]) => void) => void }) => {
      proxy.on("error", (...args: unknown[]) => {
        const err = args[0] as NodeJS.ErrnoException;
        const res = args[2] as { writeHead?: (code: number, h: Record<string, string>) => void; end?: (b: string) => void; headersSent?: boolean } | undefined;
        if (err?.code === "ECONNRESET" || err?.code === "ECONNREFUSED") {
          const now = Date.now();
          if (now - lastResetLogAt > 10_000) {
            lastResetLogAt = now;
            console.warn(
              "[vite proxy] API indisponível ou reiniciando (",
              err.code,
              ") — confira a janela SAGRA-API",
            );
          }
          if (res && !res.headersSent && typeof res.writeHead === "function") {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                detail:
                  "API indisponível (502). Reinicie com iniciar-api.bat restart se persistir.",
              }),
            );
          }
          return;
        }
        console.error("[vite proxy]", err);
      });
      proxy.on(
        "proxyReq",
        (...args: unknown[]) => {
          const proxyReq = args[0] as { setHeader: (k: string, v: string) => void };
          const req = args[1] as IncomingMessage;
          const clientIp = resolveForwardedClientIp(req);
          proxyReq.setHeader("X-Forwarded-For", clientIp);
          proxyReq.setHeader("X-Real-IP", clientIp);
        },
      );
    },
  };
}

function createSagraBuildId(): string {
  const fromEnv = process.env["VITE_SAGRA_BUILD_ID"]?.trim();
  if (fromEnv) return fromEnv;
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `build_${stamp}_${suffix}`;
}

/** Grava build-id.txt no dist (copiado para app/frontend no empacote). */
function sagraBuildIdPlugin(buildId: string): Plugin {
  return {
    name: "sagra-build-id",
    apply: "build",
    closeBundle() {
      const outDir = path.resolve(__dirname, "dist");
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, "build-id.txt"), `${buildId}\n`, "utf8");
    },
  };
}

export default defineConfig(({ mode }) => {
  const repoRoot = path.resolve(__dirname, "../..");
  const env = {
    ...loadEnv(mode, repoRoot, ""),
    ...loadEnv(mode, path.join(repoRoot, "config"), ""),
  };
  const apiPort = Number(env.PORT || env.VITE_API_PORT || 8001);
  const apiTarget = `http://127.0.0.1:${apiPort}`;
  const sagraBuildId = createSagraBuildId();

  return {
  envDir: path.join(repoRoot, "config"),
  base: basePath,
  define: {
    "import.meta.env.VITE_SAGRA_BUILD_ID": JSON.stringify(sagraBuildId),
  },
  plugins: [
    TanStackRouterVite({
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    react(),
    tailwindcss(),
    sagraBuildIdPlugin(sagraBuildId),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: [
        "favicon.ico",
        "icons/favicon-32.png",
        "icons/icon-192.png",
        "icons/icon-512.png",
        "icons/icon-maskable-512.png",
        "manifest-painel-os.webmanifest",
        "icons/painel-os-192.png",
        "icons/painel-os-512.png",
        "icons/painel-os-maskable-512.png",
      ],
      manifest: {
        id: "/sagra-web",
        name: "SAGRA Web",
        short_name: "SAGRA",
        description: "Sistema SAGRA Web — DEAPA",
        lang: "pt-BR",
        dir: "ltr",
        display: "standalone",
        orientation: "any",
        theme_color: "#121214",
        background_color: "#121214",
        scope: pwaScope,
        start_url: pwaScope,
        categories: ["business", "productivity"],
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        importScripts: ["push-sw.js"],
        clientsClaim: false,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        globIgnores: ["**/pdf.worker*.mjs", "**/sw-root-unregister.js"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: "index.html",
        navigateFallbackDenylist: pwaNavigateDenylist,
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith("/api/") ||
              url.pathname.startsWith("/sagra/api/"),
            handler: "NetworkOnly",
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-stylesheets",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      devOptions: {
        enabled: env.VITE_PWA_DEV === "true",
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    /** Permite acesso via IP da LAN (ex.: http://10.120.2.11:5173) */
    host: process.env["VITE_DEV_HOST"] !== "false",
    port: Number(process.env["VITE_DEV_PORT"]) || 5173,
    strictPort: true,
    proxy: {
      // Rotas WS antes de /api — senão /api/ws cai no proxy HTTP genérico e o upgrade falha.
      "/api/ws": proxyWithClientIp(apiTarget),
      "/ws": proxyWithClientIp(apiTarget),
      "/api": proxyWithClientIp(apiTarget),
      "/manual": proxyWithClientIp(apiTarget),
      ...(basePath !== "/"
        ? (() => {
            const prefix = basePath.replace(/\/$/, "");
            const rewriteToApi = (path: string) =>
              path.startsWith(prefix) ? path.slice(prefix.length) : path;
            return {
              [`${prefix}/api`]: {
                ...proxyWithClientIp(apiTarget),
                rewrite: rewriteToApi,
              },
              [`${prefix}/api/ws`]: {
                ...proxyWithClientIp(apiTarget),
                rewrite: rewriteToApi,
              },
            };
          })()
        : {}),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: process.env["NODE_ENV"] !== "production",
    emptyOutDir: true,
  },
};
});
