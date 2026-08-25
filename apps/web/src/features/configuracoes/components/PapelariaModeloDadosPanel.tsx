import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import { Loader2, Save, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  deletePapelariaAdminModelo,
  savePapelariaAdminNomeExibicao,
} from "@/api/adminSystem";
import type { PapelariaAdminModelRecord } from "@/features/configuracoes/types";

export function PapelariaModeloDadosPanel({
  modelo,
  onDeleted,
}: {
  modelo: PapelariaAdminModelRecord;
  onDeleted?: (modeloId: number) => void;
}) {
  const qc = useQueryClient();
  const [nome, setNome] = useState(modelo.nome_exibicao);
  const [localMsg, setLocalMsg] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: () => {
      const trimmed = nome.trim();
      return savePapelariaAdminNomeExibicao(modelo.id, trimmed || null);
    },
    onSuccess: (data) => {
      setLocalMsg("Nome salvo.");
      setNome(data.nome_exibicao);
      void qc.invalidateQueries({ queryKey: ["admin", "papelaria-modelos"] });
    },
    onError: (err: Error) => setLocalMsg(err.message),
  });

  const dirty = nome.trim() !== modelo.nome_exibicao.trim();

  const deleteMutation = useMutation({
    mutationFn: () => deletePapelariaAdminModelo(modelo.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "papelaria-modelos"] });
      onDeleted?.(modelo.id);
    },
    onError: (err: Error) => setLocalMsg(err.message),
  });

  const handleDelete = () => {
    const label = modelo.nome_exibicao || modelo.arquivo_modelo;
    if (
      !window.confirm(
        `Excluir o modelo "${label}"?\n\nEle deixará de aparecer na Papelaria. Jobs já gerados não são afetados.`,
      )
    ) {
      return;
    }
    deleteMutation.mutate();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Arquivo Corel
          </p>
          <p className="mt-1 font-mono text-[11px] text-slate-700">{modelo.arquivo_modelo}</p>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Variação
          </p>
          <p className="mt-1 text-slate-700">
            {modelo.frente_versao || "—"}
            {modelo.cores ? ` · ${modelo.cores}` : ""}
          </p>
        </div>
      </div>

      <label className="flex max-w-xl flex-col gap-1 text-xs text-slate-600">
        Nome de exibição
        <input
          type="text"
          className="rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-800"
          value={nome}
          maxLength={255}
          placeholder="Nome exibido na página Papelaria"
          onChange={(e) => {
            setNome(e.target.value);
            setLocalMsg(null);
          }}
        />
        <span className="text-[10px] text-slate-500">
          Deixe em branco e salve para voltar ao nome automático (produto + frente/verso + cores).
        </span>
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={cn(
            "inline-flex items-center justify-center gap-1 rounded px-3 py-1.5 text-xs font-semibold",
            dirty
              ? "bg-secondary-blue text-white hover:bg-secondary-blue/90"
              : "border border-slate-300 text-slate-500",
          )}
          disabled={!dirty || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Save className="size-3.5" aria-hidden />
          )}
          Salvar nome
        </button>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-1 rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
          disabled={deleteMutation.isPending || saveMutation.isPending}
          onClick={handleDelete}
        >
          {deleteMutation.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Trash2 className="size-3.5" aria-hidden />
          )}
          Excluir modelo
        </button>
      </div>

      {localMsg ? (
        <p
          className={cn(
            "text-xs",
            saveMutation.isError || deleteMutation.isError ? "text-red-600" : "text-emerald-700",
          )}
        >
          {localMsg}
        </p>
      ) : null}
    </div>
  );
}
