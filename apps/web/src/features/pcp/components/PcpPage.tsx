import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import { ClipboardList, RefreshCw, Settings } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { fetchAndamentos } from "@/api/pcp";
import { pcpQueueKey } from "@/api/hooks/usePcpQueue";
import { fetchSetores } from "@/api/auxLookups";
import { useSagraWebSocket } from "@/hooks/useSagraWebSocket";
import { usePcpConfigStore } from "../pcpConfigStore";
import { PcpColumnWrapper } from "./PcpColumnWrapper";
import { PcpSettingsModal } from "./PcpSettingsModal";

interface PcpWsMessage {
  type?: string;
  setor?: string;
}

export function PcpPage() {
  const queryClient = useQueryClient();
  const config = usePcpConfigStore((s) => s.config);
  const setConfig = usePcpConfigStore((s) => s.setConfig);

  const [setores, setSetores] = useState<string[]>([]);
  const [andamentos, setAndamentos] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [lastUpdated, setLastUpdated] = useState("—");
  const [nowMs, setNowMs] = useState(Date.now());
  const [loadingAny, setLoadingAny] = useState(false);

  const selectedSetores = config.selectedSetores;

  useEffect(() => {
    void fetchSetores().then((s) => {
      setSetores(s);
      if (config.selectedSetores.length === 0 && s.length > 0) {
        setConfig({ ...config, selectedSetores: s.slice(0, 3) });
      }
    });
    void fetchAndamentos().then(setAndamentos);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const invalidateSetor = useCallback(
    (setor: string) => {
      void queryClient.invalidateQueries({ queryKey: pcpQueueKey(setor) });
      setLastUpdated(new Date().toLocaleTimeString("pt-BR"));
    },
    [queryClient],
  );

  const refreshAll = useCallback(() => {
    for (const setor of selectedSetores) {
      invalidateSetor(setor);
    }
  }, [invalidateSetor, selectedSetores]);

  const { status: wsStatus } = useSagraWebSocket<PcpWsMessage>({
    path: "/ws",
    onMessage: (data) => {
      if (
        data.type === "pcp_queue_update" ||
        data.type === "system_update"
      ) {
        if (data.setor && selectedSetores.includes(data.setor)) {
          invalidateSetor(data.setor);
        } else {
          refreshAll();
        }
      }
    },
  });

  const wsConnected = wsStatus === "connected";

  const handleSaveSettings = (next: typeof config) => {
    setConfig(next);
    setShowSettings(false);
    refreshAll();
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-sagra-border bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <ClipboardList className="size-8 text-primary-green" />
          <div>
            <h1 className="text-xl font-semibold text-secondary-blue">
              PCP — Planejamento e Controle da Produção
            </h1>
            <p className="text-sm text-neutral-600">
              Fila visual por setor com drag-and-drop
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
              wsConnected
                ? "bg-green-100 text-green-800"
                : "bg-amber-100 text-amber-800",
            )}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                wsConnected ? "bg-primary-green" : "bg-amber-500",
              )}
            />
            {wsConnected ? "Em tempo real" : "Reconectando…"}
          </span>
          <span className="text-neutral-500">Atualizado: {lastUpdated}</span>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="inline-flex items-center gap-1 rounded border border-sagra-border px-3 py-1.5 hover:bg-slate-50"
          >
            <Settings className="size-4" />
            Configurações
          </button>
          <button
            type="button"
            onClick={() => {
              setLoadingAny(true);
              refreshAll();
              window.setTimeout(() => setLoadingAny(false), 500);
            }}
            disabled={loadingAny}
            className="inline-flex items-center gap-1 rounded bg-primary-green px-3 py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            <RefreshCw className={cn("size-4", loadingAny && "animate-spin")} />
            Atualizar
          </button>
        </div>
      </header>

      {selectedSetores.length === 0 ? (
        <div className="rounded-lg border border-dashed border-sagra-border bg-white p-12 text-center text-neutral-500">
          Selecione setores em Configurações para exibir as filas.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-4">
          {selectedSetores.map((setor) => (
            <PcpColumnWrapper
              key={setor}
              setor={setor}
              filters={config.filters}
              nowMs={nowMs}
              onRefresh={() => invalidateSetor(setor)}
            />
          ))}
        </div>
      )}

      <PcpSettingsModal
        open={showSettings}
        setores={setores}
        andamentos={andamentos}
        config={config}
        onClose={() => setShowSettings(false)}
        onSave={handleSaveSettings}
      />
    </div>
  );
}
