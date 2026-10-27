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
    window: { width: 720, speedPxPerSec: 40, opacity: 0.95, transparentBg: false },
  };
  const jobs: Record<string, unknown>[] = [];
  let jobId = 1;
  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const url = (req.url ?? "").split("?")[0];
    if (url === "/local/me") return sendJson(res, { isAdmin: process.env.LETREIRO_MOCK_ADMIN === "1" });
    if (url === "/local/config" || url === "/local/restore-board") return sendJson(res, config);
    if (url === "/local/setores") return sendJson(res, { setores: ["SEFOC", "Papelaria", "Gravação"] });
    if (url === "/local/situacoes") {
      return sendJson(res, { situacoes: ["Saída p/", "Em Execução", "Recebido", "Encam. de Docum."] });
    }
    if (url === "/api/letreiro/instances") {
      return sendJson(res, {
        instances: [{
          hostName: "PC-DEV",
          windowsUser: "usr_sefoc",
          nome: "Dev",
          setor: "SEFOC",
          version: "2.10.0",
          ponto: "654321",
          online: true,
          hasConfig: true,
        }],
      });
    }
    if (url === "/api/letreiro/commands") {
      return sendJson(res, {
        commands: [
          { id: 1, name: "Reiniciar spooler", kind: "bat", content: "net stop spooler", timeoutSec: 60 },
          { id: 2, name: "Listar processos", kind: "ps1", content: "Get-Process", timeoutSec: 60 },
        ],
      });
    }
    if (/^\/api\/letreiro\/commands\/\d+\/run$/.test(url)) {
      req.resume();
      jobs.unshift({
        id: jobId++,
        name: "biblioteca",
        kind: "bat",
        hostName: "PC-DEV",
        windowsUser: "usr_sefoc",
        status: "ok",
        exitCode: 0,
        stdout: "Script da biblioteca executado.",
        stderr: "",
        createdAt: new Date().toISOString(),
      });
      return sendJson(res, { queued: 1 });
    }
    if (url === "/api/letreiro/jobs/run") {
      req.resume();
      jobs.unshift({
        id: jobId++,
        name: "terminal",
        kind: "bat",
        hostName: "PC-DEV",
        windowsUser: "usr_sefoc",
        status: "ok",
        exitCode: 0,
        stdout: "Resposta de teste do letreiro.",
        stderr: "",
        createdAt: new Date().toISOString(),
      });
      return sendJson(res, { queued: 1 });
    }
    if (url === "/api/letreiro/jobs") return sendJson(res, { jobs });
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
