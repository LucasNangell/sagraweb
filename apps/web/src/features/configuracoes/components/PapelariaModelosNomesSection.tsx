import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import { Loader2, Save, Tag, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  deletePapelariaAdminModelo,
  fetchPapelariaAdminModelos,
  savePapelariaAdminNomeExibicao,
} from "@/api/adminSystem";
import type { PapelariaAdminModelRecord } from "@/features/configuracoes/types";

import {
  ConfigSection,
  ConfigSectionBody,
  ConfigSectionHeader,
} from "./ConfigSectionLayout";

function NomeExibicaoRow({ modelo }: { modelo: PapelariaAdminModelRecord }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState(modelo.nome_exibicao);
  const [localMsg, setLocalMsg] = useState<string | null>(null);

  useEffect(() => {
    setNome(modelo.nome_exibicao);
  }, [modelo.nome_exibicao]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const trimmed = nome.trim();
      return savePapelariaAdminNomeExibicao(
        modelo.id,
        trimmed || null,
      );
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
    <li className="border-b border-slate-100 px-3 py-2.5">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
        <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-xs text-slate-600">
          <span className="sr-only">Nome de exibição — {modelo.arquivo_modelo}</span>
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
        </label>
        <button
          type="button"
          className={cn(
            "inline-flex shrink-0 items-center justify-center gap-1 rounded px-3 py-1.5 text-xs font-semibold",
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
          Salvar
        </button>
        <button
          type="button"
          className="inline-flex shrink-0 items-center justify-center gap-1 rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
          disabled={deleteMutation.isPending || saveMutation.isPending}
          title="Excluir modelo"
          onClick={handleDelete}
        >
          {deleteMutation.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Trash2 className="size-3.5" aria-hidden />
          )}
          Excluir
        </button>
      </div>
      <p className="mt-1 text-[10px] text-slate-500">
        {modelo.produto}
        {modelo.frente_versao ? ` · ${modelo.frente_versao}` : ""}
        {modelo.cores ? ` · ${modelo.cores}` : ""}
      </p>
      <p className="font-mono text-[10px] text-slate-400">{modelo.arquivo_modelo}</p>
      {localMsg ? (
        <p
          className={cn(
            "mt-1 text-[10px]",
            saveMutation.isError ? "text-red-600" : "text-emerald-700",
          )}
        >
          {localMsg}
        </p>
      ) : null}
    </li>
  );
}

export function PapelariaModelosNomesSection() {
  const modelosQuery = useQuery({
    queryKey: ["admin", "papelaria-modelos"],
    queryFn: fetchPapelariaAdminModelos,
  });

  const modelos = modelosQuery.data ?? [];

  return (
    <ConfigSection variant="papelaria">
      <ConfigSectionHeader
        title="Nomes de exibição dos modelos"
        description="Defina o nome amigável de cada modelo. Esse nome aparece na página Papelaria para o usuário escolher o template — o arquivo .cdr permanece apenas como referência técnica."
        icon={<Tag className="size-4" aria-hidden />}
      />

      <ConfigSectionBody>
        {modelosQuery.isLoading ? (
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Carregando modelos...
          </p>
        ) : modelos.length === 0 ? (
          <p className="text-xs text-slate-500">Nenhum modelo ativo cadastrado.</p>
        ) : (
          <div className="overflow-hidden rounded border border-slate-200">
            <p className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {modelos.length} modelo(s)
            </p>
            <ul className="max-h-80 overflow-y-auto">
              {modelos.map((m) => (
                <NomeExibicaoRow key={m.id} modelo={m} />
              ))}
            </ul>
          </div>
        )}
        <p className="mt-2 text-[10px] text-slate-500">
          Deixe em branco e salve para voltar ao nome automático (produto + frente/verso + cores).
        </p>
      </ConfigSectionBody>
    </ConfigSection>
  );
}
