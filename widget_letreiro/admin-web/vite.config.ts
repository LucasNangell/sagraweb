import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, PreviewServer, ViteDevServer } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const MOCK_BOARD = {
  sector: "SEFOC",
  columnCount: 4,
  showOs: true,
  showSp: true,
  columns: [
    { id: "col_0", title: "p/ Triagem", statuses: ["Saída p/", "Saída parcial p/", "Entrada Inicial", "Tramit. de Prova p/", "Tramit. de Prévia p/", "Comentário"] },
    { id: "col_1", title: "p/ Execução", statuses: ["Em Execução", "Recebido"] },
    { id: "col_2", title: "Prob. Téc.", statuses: ["Problemas Técnicos", "Problema Técnico"] },
    { id: "col_3", title: "enviar E-mail", statuses: ["Encam. de Docum."] },
  ],
};

function sendJson(res: ServerResponse, data: unknown) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function localPreviewMock(): Connect.NextHandleFunction {
  const config = {
    apiBaseUrl: "https://cgrafsysvm.redecamara.camara.gov.br/sagra/api",
    ponto: "654321",
    nome: "usr_sefoc",
    sslVerify: false,
    board: MOCK_BOARD,
    window: { speedPxPerSec: 40, opacity: 0.95, transparentBg: false },
  };
  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const url = (req.url ?? "").split("?")[0];
    if (url === "/local/me") return sendJson(res, { isAdmin: process.env.LETREIRO_MOCK_ADMIN === "1" });
    if (url === "/local/config" || url === "/local/restore-board") return sendJson(res, config);
    if (url === "/local/setores") return sendJson(res, { setores: ["SEFOC", "Papelaria", "Gravação"] });
    if (url === "/local/situacoes") {
      return sendJson(res, { situacoes: ["Saída p/", "Em Execução", "Recebido", "Encam. de Docum."] });
    }
    if (url === "/api/letreiro/instances") return sendJson(res, { instances: [] });
    if (url === "/api/letreiro/commands") return sendJson(res, { commands: [] });
    if (url === "/api/letreiro/jobs") return sendJson(res, { jobs: [] });
    if (url === "/api/letreiro/settings") return sendJson(res, { commandPollIntervalSec: 10 });
    next();
  };
}

function attachMock(server: ViteDevServer | PreviewServer) {
  server.middlewares.use(localPreviewMock());
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "letreiro-local-mock",
      configureServer: attachMock,
      configurePreviewServer: attachMock,
    },
  ],
  base: "./",
  server: {
    port: 17891,
  },
  preview: {
    port: 17891,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
