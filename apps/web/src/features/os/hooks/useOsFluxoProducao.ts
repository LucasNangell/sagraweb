import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { fetchOsFluxoProducao } from "@/api/osFluxoProducao";
import { queryKeys } from "@/api/query-keys";
import { useSagraWebSocket } from "@/hooks/useSagraWebSocket";

type SystemUpdateMsg = {
  type?: string;
  id?: number | string | null;
  ano?: number | string | null;
};

function toNum(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function useOsFluxoProducao(
  ano: number,
  osId: number,
  enabled: boolean,
) {
  const qc = useQueryClient();
  const queryKey = queryKeys.os.fluxoProducao(ano, osId);

  const query = useQuery({
    queryKey,
    queryFn: () => fetchOsFluxoProducao(ano, osId),
    enabled,
    refetchInterval: enabled ? 60_000 : false,
  });

  useSagraWebSocket<SystemUpdateMsg>({
    path: "/ws",
    enabled,
    onMessage: (data) => {
      if (!data || data.type !== "system_update") return;
      const msgAno = toNum(data.ano);
      const msgId = toNum(data.id);
      if (msgAno === ano && msgId === osId) {
        void qc.invalidateQueries({ queryKey });
      }
    },
  });

  const serverAgora = query.data?.resumo.agora ?? null;
  const pausaAtiva = Boolean(query.data?.resumo.pausa_cliente?.ativa);
  const [tickOffsetMs, setTickOffsetMs] = useState(0);

  useEffect(() => {
    setTickOffsetMs(0);
  }, [serverAgora]);

  useEffect(() => {
    if (!enabled || !serverAgora || pausaAtiva) return;
    const id = window.setInterval(() => {
      setTickOffsetMs((prev) => prev + 30_000);
    }, 30_000);
    return () => window.clearInterval(id);
  }, [enabled, serverAgora, pausaAtiva]);

  const agoraLocal = useMemo(() => {
    if (!serverAgora) return null;
    // Interpreta o "agora" do servidor como horário de Brasília (naive).
    const normalized = serverAgora.replace(" ", "T");
    const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
    const base = hasTz
      ? new Date(normalized)
      : new Date(
          `${normalized}${normalized.includes("T") ? "" : "T00:00:00"}-03:00`,
        );
    if (Number.isNaN(base.getTime())) return serverAgora;
    const tick = new Date(base.getTime() + tickOffsetMs);
    // Exibe/propaga em horário de Brasília, sem toISOString (UTC).
    return tick.toLocaleString("sv-SE", {
      timeZone: "America/Sao_Paulo",
      hour12: false,
    }).replace(" ", "T");
  }, [serverAgora, tickOffsetMs]);

  return {
    query,
    agoraLocal,
  };
}
