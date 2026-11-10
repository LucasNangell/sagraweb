import { Loader2, RefreshCw, Wrench, Zap } from "lucide-react";
import { useState } from "react";

import { useForceRefreshMutation } from "@/api/hooks/useUsuariosQueries";

import { useConfirm } from "./ConfirmDialog";
import { useFeedback } from "./Feedback";

/** Bloco "Manutenção": recarregar todos os clients conectados (antes em /usuarios). */
export function ManutencaoClients() {
  const confirm = useConfirm();
  const feedback = useFeedback();
  const forceRefreshMutation = useForceRefreshMutation();
  const [forceAction, setForceAction] = useState<"refresh" | "reset" | null>(null);

  const handleForceRefresh = async (overwriteConfig: boolean) => {
    const ok = await confirm(
      overwriteConfig
        ? {
            title: "Atualizar clients e resetar configuração global?",
            message:
              "Todos os dashboards serão recarregados e as configurações locais SOBRESCRITAS pelo arquivo global (config_painel_global.json).",
            confirmLabel: "Atualizar e resetar",
            danger: true,
          }
        : {
            title: "Recarregar todos os clients?",
            message:
              "A página de TODOS os usuários conectados será recarregada (espalhado em até ~20s).",
            confirmLabel: "Recarregar todos",
            danger: true,
          },
    );
    if (!ok) return;

    setForceAction(overwriteConfig ? "reset" : "refresh");
    try {
      const result = await forceRefreshMutation.mutateAsync({
        type: "force_refresh",
        action: "reload",
        id: 0,
        ano: 0,
        origem: "admin_panel",
        ...(overwriteConfig ? { overwriteConfig: true } : {}),
      });
      const listeners = result.listeners ?? 0;
      feedback.success(
        listeners === 0
          ? "Comando enviado. Nenhum client conectado agora; eles atualizam no próximo poll (até ~20s)."
          : "Comando enviado. Os clients atualizam espalhados em até ~20s.",
      );
    } catch (err) {
      const timeout =
        (err instanceof DOMException && err.name === "TimeoutError") ||
        (err instanceof Error && err.name === "AbortError");
      feedback.error(
        timeout
          ? "Tempo esgotado ao enviar o comando. Reinicie a API se o servidor estiver travado."
          : err instanceof Error
            ? err.message
            : "Erro de conexão ao enviar comando.",
      );
    } finally {
      setForceAction(null);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-800">
        <Wrench className="size-5 text-slate-500" aria-hidden />
        Manutenção
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Força o recarregamento das páginas abertas em todos os computadores e painéis.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleForceRefresh(false)}
          disabled={forceAction !== null}
          className="sagra-btn sagra-btn--danger sagra-btn--md disabled:opacity-60"
        >
          {forceAction === "refresh" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Zap className="size-4" aria-hidden />
          )}
          Atualizar clients
        </button>
        <button
          type="button"
          onClick={() => void handleForceRefresh(true)}
          disabled={forceAction !== null}
          className="inline-flex items-center gap-2 rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-amber-500 disabled:opacity-60"
        >
          {forceAction === "reset" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="size-4" aria-hidden />
          )}
          Atualizar + reset config. global
        </button>
      </div>
    </section>
  );
}
