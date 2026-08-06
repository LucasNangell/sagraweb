import { useCallback, useEffect, useMemo, useState } from "react";

import type { WebSocketStatus } from "@/hooks/useSagraWebSocket";
import { resolveSagraApiPrefix } from "@/lib/api";
import { resolveWebSocketUrl } from "@/lib/websocket";

import {
  buildWsProbeCandidates,
  describeWsProbe,
  probeHttpUrl,
  probeWebSocketUrl,
  toHttpProbeUrl,
  type HttpProbeResult,
} from "../diagnosticsProbe";

export interface TabletDiagnosticsPanelProps {
  open: boolean;
  onClose: () => void;
  wsStatus: WebSocketStatus;
  wsLastError: string | null;
  wsReconnectAttempt: number;
  wsReconnect: () => void;
  lastSyncAt: number | null;
  fetchError: string | null;
}

function formatSyncAt(epochMs: number | null): string {
  if (epochMs == null) {
    return "(nunca)";
  }
  return new Date(epochMs).toLocaleString("pt-BR");
}

function formatHttpProbe(result: HttpProbeResult): string[] {
  if (result.error) {
    return [`  ${result.url} -> falhou: ${result.error}`];
  }
  const lines = [
    `  ${result.url} -> HTTP ${result.status} ${result.statusText}`.trimEnd(),
  ];
  if (result.redirected) {
    lines.push(`  redirecionado para: ${result.finalUrl}`);
  }
  for (const header of result.headers) {
    lines.push(`    ${header}`);
  }
  return lines;
}

export function TabletDiagnosticsPanel({
  open,
  onClose,
  wsStatus,
  wsLastError,
  wsReconnectAttempt,
  wsReconnect,
  lastSyncAt,
  fetchError,
}: TabletDiagnosticsPanelProps) {
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState<null | "http" | "ws">(null);
  const [httpLines, setHttpLines] = useState<string[]>([]);
  const [wsLines, setWsLines] = useState<string[]>([]);

  const report = useMemo(() => {
    if (typeof window === "undefined") {
      return "";
    }
    const lines = [
      `origin: ${window.location.origin}`,
      `href: ${window.location.href}`,
      `apiPrefix: ${resolveSagraApiPrefix()}`,
      `wsUrl: ${resolveWebSocketUrl("/ws")}`,
      `wsStatus: ${wsStatus}`,
      `wsLastError: ${wsLastError ?? "(none)"}`,
      `wsReconnectAttempt: ${wsReconnectAttempt}`,
      `lastSyncAt: ${formatSyncAt(lastSyncAt)}`,
      `fetchError: ${fetchError ?? "(none)"}`,
      `navigator.onLine: ${String(navigator.onLine)}`,
      `userAgent: ${navigator.userAgent}`,
    ];
    if (httpLines.length > 0) {
      lines.push("", "-- rota /ws via HTTP --", ...httpLines);
    }
    if (wsLines.length > 0) {
      lines.push("", "-- URLs de WebSocket --", ...wsLines);
    }
    return lines.join("\n");
  }, [
    fetchError,
    httpLines,
    lastSyncAt,
    wsLastError,
    wsLines,
    wsReconnectAttempt,
    wsStatus,
  ]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copie o diagnóstico:", report);
    }
  }, [report]);

  const handleHttpProbe = useCallback(async () => {
    setRunning("http");
    setHttpLines(["  testando..."]);
    const wsUrl = resolveWebSocketUrl("/ws");
    const targets = [toHttpProbeUrl(wsUrl), `${resolveSagraApiPrefix()}/health`];
    const lines: string[] = [];
    for (const target of targets) {
      const result = await probeHttpUrl(target);
      lines.push(...formatHttpProbe(result));
    }
    setHttpLines(lines);
    setRunning(null);
  }, []);

  const handleWsProbe = useCallback(async () => {
    setRunning("ws");
    setWsLines(["  testando..."]);
    const candidates = buildWsProbeCandidates(resolveWebSocketUrl("/ws"));
    const lines: string[] = [];
    for (const candidate of candidates) {
      const result = await probeWebSocketUrl(candidate);
      lines.push(`  ${candidate} -> ${describeWsProbe(result)}`);
      setWsLines([...lines]);
    }
    setRunning(null);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="tablet-diagnostics-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Diagnóstico do painel"
    >
      <div className="tablet-diagnostics-panel">
        <header className="tablet-diagnostics-header">
          <h2>Diagnóstico</h2>
          <button type="button" onClick={onClose} aria-label="Fechar">
            Fechar
          </button>
        </header>
        <pre className="tablet-diagnostics-body">{report}</pre>
        <footer className="tablet-diagnostics-footer">
          <button type="button" onClick={() => void handleCopy()}>
            {copied ? "Copiado" : "Copiar"}
          </button>
          <button
            type="button"
            onClick={() => {
              wsReconnect();
            }}
          >
            Reconectar WebSocket
          </button>
          <button
            type="button"
            disabled={running != null}
            onClick={() => void handleHttpProbe()}
          >
            {running === "http" ? "Testando..." : "Testar rota /ws (HTTP)"}
          </button>
          <button
            type="button"
            disabled={running != null}
            onClick={() => void handleWsProbe()}
          >
            {running === "ws" ? "Testando..." : "Testar URLs de WS"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** True se a URL pede o painel de diagnóstico (?diag=1). */
export function isDiagQueryEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return new URLSearchParams(window.location.search).get("diag") === "1";
  } catch {
    return false;
  }
}
