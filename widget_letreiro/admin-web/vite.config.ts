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

const MOCK_WINDOW_TABLE = `   Id ProcessName           MainWindowTitle
   -- -----------           ---------------
32848 ApplicationFrameHost  Notas Autoadesivas
 5472 chrome                Administração do letreiro - Google Chrome
52344 Cursor                Windows taskbar widget - SagraWeb (Workspace) - Cursor
 4592 SAGRA-Letreiro        SAGRA Letreiro
24032 WINWORD               Manual-Desktop-Widgets-3.7.2.docx  -  Modo de Compatibilidade - Word`;

const MOCK_COMMANDS = [
  { id: 1, name: "Reiniciar spooler", kind: "bat", content: "net stop spooler", timeoutSec: 60 },
  { id: 2, name: "Listar janelas", kind: "ps1", content: "# letreiro-capture: janela_id\nGet-Process | Where-Object { $_.MainWindowTitle } | Select-Object Id, ProcessName, MainWindowTitle | Format-Table -AutoSize", timeoutSec: 60 },
  { id: 3, name: "Ping host", kind: "bat", content: "ping {{host}} -n {{count}}", timeoutSec: 60 },
  { id: 4, name: "Ativar janela", kind: "ps1", content: "$wshell = New-Object -ComObject wscript.shell; if ($wshell.AppActivate({{janela_id}})) { Start-Sleep -Milliseconds 500; $wshell.SendKeys('{F5}') } else { Write-Warning \"Não foi possível ativar a janela do processo {{janela_id}}.\" }", timeoutSec: 60 },
  { id: 5, name: "Alterar monitor", kind: "ps1", content: `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Api {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
"@
$proc = Get-Process -Id {{janela_id}} -ErrorAction Stop
$hWnd = $proc.MainWindowHandle
$telas = [System.Windows.Forms.Screen]::AllScreens
$alvo = $telas[{{monitor_id}}]
[Win32Api]::ShowWindow($hWnd, 1) | Out-Null
[Win32Api]::SetWindowPos($hWnd, [IntPtr]::Zero, $alvo.Bounds.X, $alvo.Bounds.Y, $alvo.Bounds.Width, $alvo.Bounds.Height, 0x0040) | Out-Null
"Janela {{janela_id}} movida para o monitor {{monitor_id}}."`, timeoutSec: 60 },
];

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
  const remoteByTarget: Record<string, unknown> = {
    "PC-DEV\nusr_sefoc": { ...config },
  };
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
        instances: [
          { hostName: "PC-DEV", windowsUser: "usr_sefoc", nome: "Dev", setor: "SEFOC", version: "2.18.0", ponto: "654321", online: true, hasConfig: true },
          { hostName: "PC-SALA", windowsUser: "ana", nome: "Ana Souza", setor: "Papelaria", version: "2.18.0", ponto: "654321", online: true, hasConfig: true },
          { hostName: "PC-SALA", windowsUser: "bruno", nome: "Bruno Alves", setor: "Gravação", version: "2.18.0", ponto: "654321", online: true, hasConfig: false },
          { hostName: "PC-CARLOS", windowsUser: "carlos", nome: "Carlos Lima", setor: "SEFOC", version: "2.13.2", ponto: "654321", online: false, hasConfig: true },
        ],
      });
    }
    if (url === "/api/letreiro/commands") {
      return sendJson(res, { commands: MOCK_COMMANDS });
    }
    const runMatch = url.match(/^\/api\/letreiro\/commands\/(\d+)\/run$/);
    if (runMatch) {
      req.resume();
      const command = MOCK_COMMANDS.find((item) => item.id === Number(runMatch[1]));
      jobs.unshift({
        id: jobId++,
        name: command?.name ?? "biblioteca",
        kind: command?.kind ?? "bat",
        hostName: "PC-DEV",
        windowsUser: "usr_sefoc",
        status: "ok",
        exitCode: 0,
        stdout: command?.name === "Listar janelas" ? MOCK_WINDOW_TABLE : "Script da biblioteca executado.",
        stderr: "",
        createdAt: new Date().toISOString(),
      });
      return sendJson(res, { queued: 1 });
    }
    if (url === "/api/letreiro/jobs/run") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        let stdout = "Resposta de teste do letreiro.";
        let name = "terminal";
        let kind = "bat";
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
            content?: string;
            name?: string;
            kind?: string;
          };
          if (body.content) stdout = `Executado: ${body.content}`;
          if (body.name) name = body.name;
          if (body.kind) kind = body.kind;
        } catch {
          /* keep defaults */
        }
        jobs.unshift({
          id: jobId++,
          name,
          kind,
          hostName: "PC-DEV",
          windowsUser: "usr_sefoc",
          status: "ok",
          exitCode: 0,
          stdout,
          stderr: "",
          createdAt: new Date().toISOString(),
        });
        sendJson(res, { queued: 1 });
      });
      return;
    }
    if (url === "/api/letreiro/jobs") return sendJson(res, { jobs });
    if (url === "/api/letreiro/settings") return sendJson(res, { commandPollIntervalSec: 10 });
    if (url === "/api/letreiro/config") {
      if (req.method === "PUT") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        req.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
              payload?: unknown;
              hostName?: string;
              targetUser?: string;
              applyToAll?: boolean;
            };
            if (!body.applyToAll && body.hostName && body.targetUser) {
              remoteByTarget[`${body.hostName}\n${body.targetUser}`] = body.payload ?? {};
            }
            sendJson(res, { ok: true });
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ detail: "payload inválido" }));
          }
        });
        return;
      }
      const query = new URL(req.url ?? "/", "http://letreiro.local").searchParams;
      const key = `${query.get("host") ?? ""}\n${query.get("user") ?? ""}`;
      return sendJson(res, { payload: remoteByTarget[key] ?? { ...config } });
    }
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
