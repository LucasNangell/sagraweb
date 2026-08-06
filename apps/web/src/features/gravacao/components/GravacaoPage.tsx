import { cn } from "@sagra/ui";
import { Disc3, Wifi, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useSagraWebSocket } from "@/hooks/useSagraWebSocket";
import type { GravacaoLogEntry, GravacaoWsPayload } from "../types";
import { GravacaoJobsTable } from "./GravacaoJobsTable";
import { GravacaoLogPanel } from "./GravacaoLogPanel";

let logSeq = 0;

function pushLog(
  entries: GravacaoLogEntry[],
  level: GravacaoLogEntry["level"],
  message: string,
  max = 200,
): GravacaoLogEntry[] {
  const next: GravacaoLogEntry = {
    id: String(++logSeq),
    at: new Date().toLocaleTimeString("pt-BR"),
    level,
    message,
  };
  return [...entries, next].slice(-max);
}

export function GravacaoPage() {
  const [tickets, setTickets] = useState<GravacaoWsPayload["tickets"]>([]);
  const [paths, setPaths] = useState<GravacaoWsPayload["paths"]>([]);
  const [meta, setMeta] = useState<GravacaoWsPayload["meta"]>();
  const [logs, setLogs] = useState<GravacaoLogEntry[]>([]);
  const [lastUpdated, setLastUpdated] = useState("—");

  const onMessage = useCallback((data: GravacaoWsPayload) => {
    if (data.tickets || data.paths) {
      setTickets(data.tickets ?? []);
      setPaths(data.paths ?? []);
      setMeta(data.meta);
      setLastUpdated(new Date().toLocaleTimeString("pt-BR"));
      const errCount = data.meta?.errors?.length ?? 0;
      setLogs((prev) =>
        pushLog(
          prev,
          errCount ? "warn" : "info",
          `Xpose: ${data.tickets?.length ?? 0} jobs, ${data.paths?.length ?? 0} paths` +
            (errCount ? ` (${errCount} avisos)` : ""),
        ),
      );
      return;
    }
    if (data.jobs || data.printed_jobs) {
      const q = Array.isArray(data.jobs) ? data.jobs.length : 0;
      const p = Array.isArray(data.printed_jobs) ? data.printed_jobs.length : 0;
      setLogs((prev) =>
        pushLog(prev, "info", `Payload legado PrintQ: ${q} na fila, ${p} impressos`),
      );
    }
  }, []);

  const { status, lastError, reconnectAttempt, reconnect } =
    useSagraWebSocket<GravacaoWsPayload>({
      path: "/api/ws/jobs",
      onMessage,
    });

  useEffect(() => {
    if (status === "connected") {
      setLogs((prev) => pushLog(prev, "info", "WebSocket conectado a /api/ws/jobs"));
    } else if (status === "error" && lastError) {
      setLogs((prev) => pushLog(prev, "error", lastError));
    }
  }, [lastError, status]);

  const wsConnected = status === "connected";

  const statusLabel = useMemo(() => {
    switch (status) {
      case "connected":
        return "Conectado";
      case "connecting":
        return "Conectando…";
      case "error":
        return lastError ?? "Erro";
      default:
        return reconnectAttempt > 0
          ? `Reconectando (tentativa ${reconnectAttempt})…`
          : "Desconectado";
    }
  }, [lastError, reconnectAttempt, status]);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-sagra-border bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <Disc3 className="size-8 text-primary-green" />
          <div>
            <h1 className="text-xl font-semibold text-secondary-blue">
              Gravação — Monitor Xpose
            </h1>
            <p className="text-sm text-neutral-600">
              Tempo real via WebSocket <code className="text-xs">/api/ws/jobs</code>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
              wsConnected
                ? "bg-green-100 text-green-800"
                : "bg-amber-100 text-amber-800",
            )}
          >
            {wsConnected ? (
              <Wifi className="size-4" />
            ) : (
              <WifiOff className="size-4" />
            )}
            {statusLabel}
          </span>
          <span className="text-neutral-500">Atualizado: {lastUpdated}</span>
          {status !== "connected" && (
            <button
              type="button"
              onClick={reconnect}
              className="rounded border border-sagra-border px-3 py-1 hover:bg-slate-50"
            >
              Reconectar
            </button>
          )}
        </div>
      </header>

      {meta?.errors && meta.errors.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {meta.errors.join(" · ")}
        </div>
      )}

      <GravacaoJobsTable tickets={tickets ?? []} paths={paths ?? []} />

      <GravacaoLogPanel entries={logs} />
    </div>
  );
}
