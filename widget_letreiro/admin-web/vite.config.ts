import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, PreviewServer, ViteDevServer } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const appVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string;
const mockScreenshot = readFileSync(new URL("./tests/fixtures/desktop-preview.jpg", import.meta.url)).toString("base64");
const MOCK_MONITORS = [{ id: "DISPLAY1", name: "Monitor 1", primary: true }, { id: "DISPLAY2", name: "Monitor 2", primary: false }];
const MOCK_WINDOWS = [
  { handle: "108201", processId: 5472, processStart: "639000000000000000", title: "SAGRA - Painel de produção", processName: "chrome", state: "maximized", fullscreen: false, monitorId: "DISPLAY1" },
  { handle: "108202", processId: 24032, processStart: "639000000000000001", title: "Manual de produção - Word", processName: "WINWORD", state: "normal", fullscreen: false, monitorId: "DISPLAY2" },
  { handle: "108203", processId: 32848, processStart: "639000000000000002", title: "Notas da estação", processName: "ApplicationFrameHost", state: "minimized", fullscreen: false, monitorId: "DISPLAY1" },
];

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
    window: { width: 720, speedPxPerSec: 40, opacity: 0.95, transparentBg: false, notificationsEnabled: false, notificationWidth: 320, notificationHeight: 96, notificationAnimation: "fx-iris", tickerHtml: true, tickerCardModel: "fx-02-shimmer" },
  };
  const jobs: Record<string, unknown>[] = [];
  const desktopWindows: Record<string, typeof MOCK_WINDOWS> = {};
  const remoteByTarget: Record<string, unknown> = {
    "PC-DEV\nusr_sefoc": { ...config },
  };
  const configProfiles: { id: number; name: string; payload: unknown }[] = [];
  const profileAssignments: { hostName: string; windowsUser: string; profileId: number; profileName: string }[] = [];
  const stationGroups: { id: number; name: string; members: { hostName: string; windowsUser: string }[] }[] = [
    { id: 1, name: "SEFOC", members: [{ hostName: "PC-DEV", windowsUser: "usr_sefoc" }, { hostName: "PC-CARLOS", windowsUser: "carlos" }] },
  ];
  let nextProfileId = 1;
  let nextGroupId = 2;
  let jobId = 1;
  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const url = (req.url ?? "").split("?")[0];
    if (url === "/local/me") return sendJson(res, { isAdmin: process.env.LETREIRO_MOCK_ADMIN === "1" });
    if (url === "/api/letreiro/screenshot-capability") {
      if (process.env.LETREIRO_MOCK_LEGACY_CAPTURE === "1") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html");
        res.end("<!doctype html><html><body>SAGRA Web</body></html>");
        return;
      }
      return sendJson(res, { highQuality: true });
    }
    if (url === "/local/config" && req.method === "PUT") {
      const chunks: Buffer[] = [];
      req.on("data", chunk => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        try {
          Object.assign(config, JSON.parse(Buffer.concat(chunks).toString("utf8")));
          sendJson(res, config);
        } catch {
          res.statusCode = 400;
          res.end(JSON.stringify({ detail: "Configuração inválida" }));
        }
      });
      return;
    }
    if (url === "/local/restore-board") {
      config.board = structuredClone(MOCK_BOARD);
      return sendJson(res, config);
    }
    if (url === "/local/config") return sendJson(res, config);
    if (url === "/api/letreiro/sounds") return sendJson(res, { sounds: [] });
    if (url === "/local/config-profile-assignments") {
      if (req.method !== "PUT") return sendJson(res, { assignments: profileAssignments });
      const chunks: Buffer[] = [];
      req.on("data", chunk => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { hostName: string; windowsUser: string; profileId: number };
          const index = profileAssignments.findIndex(row => row.hostName === body.hostName && row.windowsUser === body.windowsUser);
          if (index >= 0) profileAssignments.splice(index, 1);
          const assignment = { ...body, profileName: configProfiles.find(row => row.id === body.profileId)?.name ?? "" };
          if (body.profileId) profileAssignments.push(assignment);
          sendJson(res, assignment);
        } catch {
          res.statusCode = 400;
          res.end(JSON.stringify({ detail: "Atribuição de perfil inválida" }));
        }
      });
      return;
    }
    if (url === "/local/preview-notification") return sendJson(res, { status: "ok" });
    if (url === "/local/config-profiles") {
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        req.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as { name?: string; payload?: unknown };
            const name = (body.name ?? "").trim();
            if (!name) {
              res.statusCode = 400;
              res.end(JSON.stringify({ detail: "Nome do perfil é obrigatório" }));
              return;
            }
            const existing = configProfiles.find((item) => item.name.toLowerCase() === name.toLowerCase());
            if (existing) {
              existing.name = name;
              existing.payload = body.payload ?? existing.payload;
              sendJson(res, existing);
              return;
            }
            const row = { id: nextProfileId++, name, payload: body.payload ?? { ...config } };
            configProfiles.push(row);
            sendJson(res, row);
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ detail: "perfil inválido" }));
          }
        });
        return;
      }
      return sendJson(res, { profiles: configProfiles });
    }
    const profileMatch = url.match(/^\/local\/config-profiles\/(\d+)$/);
    if (profileMatch) {
      const id = Number(profileMatch[1]);
      const idx = configProfiles.findIndex((item) => item.id === id);
      if (idx < 0) {
        res.statusCode = 404;
        res.end(JSON.stringify({ detail: "perfil não encontrado" }));
        return;
      }
      if (req.method === "DELETE") {
        configProfiles.splice(idx, 1);
        return sendJson(res, { status: "ok" });
      }
      if (req.method === "PUT") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        req.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as { name?: string; payload?: unknown };
            const row = configProfiles[idx];
            if (body.name?.trim()) row.name = body.name.trim();
            if (body.payload) row.payload = body.payload;
            sendJson(res, row);
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ detail: "perfil inválido" }));
          }
        });
        return;
      }
    }
    if (url === "/api/letreiro/painel-presets") {
      return sendJson(res, {
        presets: [
          {
            id: 1,
            nome: "TV SEFOC vermelho",
            payload: {
              cardStyle: {
                entryAnimation: "fx-mercury",
                models: { high: { effect: "v80", colors: { bg: "#b91c1c", border: "#fecaca", accent: "#fde047" } } },
                typography: { titleColor: "#fff7ed", situationColor: "#fecaca" },
              },
            },
          },
        ],
      });
    }
    if (url === "/local/setores") return sendJson(res, { setores: ["SEFOC", "Papelaria", "Gravação"] });
    if (url === "/local/situacoes") {
      return sendJson(res, { situacoes: ["Saída p/", "Em Execução", "Recebido", "Encam. de Docum."] });
    }
    if (url === "/api/letreiro/instances") {
      return sendJson(res, {
        instances: [
          { hostName: "PC-DEV", windowsUser: "usr_sefoc", nome: "Dev", setor: "SEFOC", version: "2.18.0", ponto: "654321", online: true, hasConfig: true },
          { hostName: "PC-SALA", windowsUser: "ana", nome: "Ana Souza", setor: "Papelaria", version: process.env.LETREIRO_MOCK_TRUNCATED_CAPTURE === "1" ? "2.40.2" : "2.15.0", ponto: "654321", online: true, hasConfig: true },
          { hostName: "PC-SALA", windowsUser: "bruno", nome: "Bruno Alves", setor: "Gravação", version: "2.18.0", ponto: "654321", online: true, hasConfig: false },
          { hostName: "PC-CARLOS", windowsUser: "carlos", nome: "Carlos Lima", setor: "SEFOC", version: "2.13.2", ponto: "654321", online: false, hasConfig: true },
        ],
      });
    }
    if (url === "/api/letreiro/groups") {
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        req.on("end", () => {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
            name?: string;
            members?: { hostName: string; windowsUser: string }[];
          };
          const id = nextGroupId++;
          stationGroups.push({ id, name: body.name?.trim() || `Grupo ${id}`, members: body.members ?? [] });
          sendJson(res, { status: "ok", id });
        });
        return;
      }
      return sendJson(res, { groups: stationGroups });
    }
    const groupMatch = url.match(/^\/api\/letreiro\/groups\/(\d+)$/);
    if (groupMatch) {
      const groupId = Number(groupMatch[1]);
      const index = stationGroups.findIndex((item) => item.id === groupId);
      if (req.method === "PUT") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        req.on("end", () => {
          if (index < 0) {
            res.statusCode = 404;
            return sendJson(res, { detail: "Grupo não encontrado." });
          }
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
            name?: string;
            members?: { hostName: string; windowsUser: string }[];
          };
          stationGroups[index] = {
            id: groupId,
            name: body.name?.trim() || stationGroups[index].name,
            members: body.members ?? stationGroups[index].members,
          };
          sendJson(res, { status: "ok" });
        });
        return;
      }
      if (req.method === "DELETE") {
        if (index >= 0) stationGroups.splice(index, 1);
        return sendJson(res, { status: "ok" });
      }
    }
    if (url === "/api/letreiro/commands") {
      return sendJson(res, { commands: MOCK_COMMANDS });
    }
    const runMatch = url.match(/^\/api\/letreiro\/commands\/(\d+)\/run$/);
    if (runMatch) {
      const command = MOCK_COMMANDS.find((item) => item.id === Number(runMatch[1]));
      const chunks: Buffer[] = [];
      req.on("data", chunk => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
          targets?: { hostName: string; windowsUser: string }[];
          groupIds?: number[];
        };
        const fromGroups = (body.groupIds ?? []).flatMap((id) => stationGroups.find((group) => group.id === id)?.members ?? []);
        const targets = [...(body.targets ?? []), ...fromGroups];
        const unique = new Map(targets.map((row) => [`${row.hostName}\n${row.windowsUser}`, row]));
        const resolved = [...unique.values()];
        if (!resolved.length) resolved.push({ hostName: "PC-DEV", windowsUser: "usr_sefoc" });
        for (const target of resolved) {
          jobs.unshift({
            id: jobId++,
            name: command?.name ?? "biblioteca",
            kind: command?.kind ?? "bat",
            ...target,
            status: "ok",
            exitCode: 0,
            stdout: command?.name === "Listar janelas" ? MOCK_WINDOW_TABLE : "Script da biblioteca executado.",
            stderr: "",
            createdAt: new Date().toISOString(),
          });
        }
        sendJson(res, { queued: resolved.length });
      });
      return;
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
            targets?: { hostName: string; windowsUser: string }[];
          };
          if (body.content) stdout = `Executado: ${body.content}`;
          if (body.name) name = body.name;
          if (body.kind) kind = body.kind;
          if (name.startsWith("sagra-desktop/")) {
            const target = body.targets?.[0] ?? { hostName: "PC-DEV", windowsUser: "usr_sefoc" };
            const key = `${target.hostName}\n${target.windowsUser}`;
            const windows = desktopWindows[key] ??= structuredClone(MOCK_WINDOWS);
            if (name.startsWith("sagra-desktop/windows/")) stdout = JSON.stringify({ type: "windows", windows, monitors: MOCK_MONITORS, capturedAt: new Date().toISOString(), truncated: false });
            else if (name.startsWith("sagra-desktop/screenshot")) stdout = name.startsWith("sagra-desktop/screenshot-hq/") && process.env.LETREIRO_MOCK_TRUNCATED_CAPTURE === "1"
              ? '{"type":"screenshot","image":"' + "A".repeat(65500) + '\n…[truncado]'
              : JSON.stringify({ type: "screenshot", mime: "image/jpeg", image: mockScreenshot, width: 1280, height: 720, originalWidth: 1920, originalHeight: 1080, capturedAt: new Date().toISOString() });
            else {
              const move = body.content?.match(/::Move\(\[long\](\d+), \[int\]\d+, \[long\]\d+, '([\w.\\-]+)'\)/);
              const moved = windows.find(item => item.handle === move?.[1]);
              if (moved && move && MOCK_MONITORS.some(m => m.id === move[2])) moved.monitorId = move[2];
              const action = body.content?.match(/::Act\(\[long\](\d+), \[int\]\d+, \[long\]\d+, '(\w+)'\)/);
              const row = windows.find(item => item.handle === action?.[1]);
              if (row && action) {
                if (action[2] === "close") windows.splice(windows.indexOf(row), 1);
                if (action[2] === "minimize") row.state = "minimized";
                if (action[2] === "maximize") row.state = "maximized";
                if (action[2] === "fullscreen") row.fullscreen = !row.fullscreen;
              }
              stdout = JSON.stringify({ type: "action", message: "Ação aplicada na estação simulada." });
            }
            jobs.unshift({ id: jobId++, name, kind, ...target, status: "ok", exitCode: 0, stdout, stderr: "", createdAt: new Date().toISOString() });
            sendJson(res, { queued: 1 });
            return;
          }
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
    const screenshotMatch = url.match(/^\/api\/letreiro\/jobs\/(\d+)\/result$/);
    if (screenshotMatch) return sendJson(res, { stdout: jobs.find(job => job.id === Number(screenshotMatch[1]))?.stdout ?? "" });
    if (url === "/api/letreiro/jobs") {
      if (req.method === "DELETE") {
        jobs.length = 0;
        return sendJson(res, { status: "ok" });
      }
      return sendJson(res, { jobs });
    }
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
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
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
