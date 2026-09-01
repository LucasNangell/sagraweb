import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { useSetoresLookup, useSituacoesLookup } from "@/api/hooks/useAuxLookups";
import { fetchProtocoloLookup } from "@/api/email";
import {
  createOsVinculo,
  deleteOsVinculo,
  fetchOsVinculoGrupoConfig,
  fetchOsVinculos,
  updateOsVinculoGrupoAndamentos,
} from "@/api/os";
import { queryKeys } from "@/api/query-keys";
import { useAuthStore } from "@/features/auth/authStore";
import { homeTestIds } from "@/lib/testId";
import {
  OS_ANO_MAX,
  OS_ANO_MIN,
  normalizeAno,
  parseOsAnoPair,
} from "../osAnoUtils";
import {
  andamentosFromGrupoConfig,
  completeVinculoAndamentos,
  serializeVinculoAndamentos,
} from "../osVinculoAndamentos";
import type { OsSearchRow, OsVinculoGrupoAndamento } from "../types";

interface DraftPair extends OsVinculoGrupoAndamento {
  key: string;
}

interface OsVinculosEditorProps {
  row: OsSearchRow;
  readOnly?: boolean;
}

function newDraftKey(): string {
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toDraftPairs(andamentos: OsVinculoGrupoAndamento[]): DraftPair[] {
  if (andamentos.length === 0) {
    return [{ key: newDraftKey(), situacao: "", setor: "" }];
  }
  return andamentos.map((item) => ({
    key: newDraftKey(),
    situacao: item.situacao,
    setor: item.setor,
  }));
}

export function OsVinculosEditor({ row, readOnly = false }: OsVinculosEditorProps) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const formId = useId();
  const [numero, setNumero] = useState("");
  const [vAno, setVAno] = useState("");
  const [pairs, setPairs] = useState<DraftPair[]>(() => [
    { key: newDraftKey(), situacao: "", setor: "" },
  ]);
  const [hydrated, setHydrated] = useState(false);

  const ano = row.ano;
  const id = row.nr_os;

  const situacoesQuery = useSituacoesLookup();
  const setoresQuery = useSetoresLookup();

  const vinculosQuery = useQuery({
    queryKey: queryKeys.os.vinculos(ano, id),
    queryFn: () => fetchOsVinculos(ano, id),
  });

  const grupoConfigQuery = useQuery({
    queryKey: queryKeys.os.vinculoGrupo(ano, id),
    queryFn: () => fetchOsVinculoGrupoConfig(ano, id),
  });

  const grupoConfig = grupoConfigQuery.data;
  const grupoId = grupoConfig?.grupo_id ?? null;
  const serverAndamentos = useMemo(
    () => andamentosFromGrupoConfig(grupoConfig),
    [grupoConfig],
  );
  const completePairs = useMemo(
    () => completeVinculoAndamentos(pairs),
    [pairs],
  );
  const andamentosDirty =
    serializeVinculoAndamentos(completePairs) !==
    serializeVinculoAndamentos(serverAndamentos);

  const vinculoPair = parseOsAnoPair(numero, vAno);
  const vinculoProtoQuery = useQuery({
    queryKey: vinculoPair
      ? queryKeys.email.protocolo(vinculoPair.ano, vinculoPair.os)
      : ["os", "vinculoProtocolo", "idle"],
    queryFn: () => fetchProtocoloLookup(vinculoPair!.os, vinculoPair!.ano),
    enabled: vinculoPair != null,
    staleTime: 60_000,
  });
  const vinculoFound = vinculoProtoQuery.data?.NroProtocolo != null;

  useEffect(() => {
    if (hydrated || grupoConfigQuery.isPending) {
      return;
    }
    const userStarted =
      pairs.length > 1 || completeVinculoAndamentos(pairs).length > 0;
    if (!userStarted) {
      setPairs(toDraftPairs(andamentosFromGrupoConfig(grupoConfig)));
    }
    setHydrated(true);
  }, [grupoConfig, grupoConfigQuery.isPending, hydrated, pairs]);

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.os.vinculos(ano, id),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.os.vinculoGrupo(ano, id),
    });
  };

  const addMutation = useMutation({
    mutationFn: ({
      numero: n,
      vano,
      andamentos,
    }: {
      numero: number;
      vano: number;
      andamentos: OsVinculoGrupoAndamento[];
    }) =>
      createOsVinculo(ano, id, n, vano, {
        situacao: andamentos[0]?.situacao,
        setor: andamentos[0]?.setor,
        andamentos,
        criado_por: user?.ponto != null ? String(user.ponto) : undefined,
      }),
    onSuccess: () => {
      setNumero("");
      setVAno("");
      invalidate();
    },
  });

  const saveAndamentosMutation = useMutation({
    mutationFn: (andamentos: OsVinculoGrupoAndamento[]) =>
      updateOsVinculoGrupoAndamentos(ano, id, andamentos),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.os.vinculoGrupo(ano, id), data);
      setPairs(toDraftPairs(andamentosFromGrupoConfig(data)));
      invalidate();
    },
  });

  const delMutation = useMutation({
    mutationFn: ({ vNum, vAno: va }: { vNum: number; vAno: number }) =>
      deleteOsVinculo(ano, id, vNum, va),
    onSuccess: invalidate,
  });

  const persistAndamentosIfNeeded = async () => {
    if (!grupoId || !andamentosDirty) {
      return;
    }
    if (completePairs.length === 0) {
      throw new Error("Informe ao menos um andamento e setor.");
    }
    await saveAndamentosMutation.mutateAsync(completePairs);
  };

  const handleSaveAndamentos = async () => {
    if (completePairs.length === 0) {
      window.alert("Informe ao menos um andamento e setor.");
      return;
    }
    try {
      await persistAndamentosIfNeeded();
    } catch (e) {
      window.alert(
        `Erro ao salvar andamentos: ${e instanceof Error ? e.message : "falha"}`,
      );
    }
  };

  const handleAdd = async () => {
    const pair = parseOsAnoPair(numero, vAno);
    if (!pair) {
      window.alert(
        `Informe número e ano válidos (ano com 2 dígitos ou 4 dígitos entre ${OS_ANO_MIN} e ${OS_ANO_MAX}).`,
      );
      return;
    }
    if (pair.os === id && pair.ano === ano) {
      window.alert("Não é possível vincular uma OS a ela mesma.");
      return;
    }
    if (!vinculoFound) {
      window.alert(`OS ${pair.os}/${pair.ano} não encontrada.`);
      return;
    }
    if (!grupoId && completePairs.length === 0) {
      window.alert(
        "Informe ao menos um andamento e setor que definem o comportamento do grupo.",
      );
      return;
    }
    try {
      await persistAndamentosIfNeeded();
      await addMutation.mutateAsync({
        numero: pair.os,
        vano: pair.ano,
        andamentos: completePairs,
      });
    } catch (e) {
      window.alert(
        `Erro ao vincular: ${e instanceof Error ? e.message : "falha"}`,
      );
    }
  };

  const vinculos = vinculosQuery.data ?? [];
  const membrosGrupo = grupoConfig?.membros ?? [];
  const situacoes = situacoesQuery.data ?? [];
  const setores = setoresQuery.data ?? [];

  const updatePair = (key: string, patch: Partial<OsVinculoGrupoAndamento>) => {
    setPairs((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  };

  return (
    <div>
      <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
        <p className="font-semibold">Comportamento do grupo</p>
        <p className="mt-1 text-xs">
          Defina um ou mais pares de andamento e setor. Quando outro usuário
          lançar qualquer um desses pares, o sistema perguntará se deseja
          replicar a todas as OSs vinculadas.
        </p>
        <div className="mt-2 flex flex-col gap-2">
          {pairs.map((pair, index) => (
            <div
              key={pair.key}
              className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_auto]"
              data-testid={homeTestIds.osVincularAndamentoRow(index)}
            >
              <label className="text-xs">
                <span className="font-semibold">Andamento *</span>
                <select
                  value={pair.situacao}
                  disabled={readOnly}
                  onChange={(e) =>
                    updatePair(pair.key, { situacao: e.target.value })
                  }
                  className="mt-0.5 h-8 w-full rounded border border-sagra-border px-1 text-xs disabled:bg-slate-100"
                  aria-label={`Andamento ${index + 1}`}
                >
                  <option value="">Selecione...</option>
                  {pair.situacao && !situacoes.includes(pair.situacao) ? (
                    <option value={pair.situacao}>{pair.situacao}</option>
                  ) : null}
                  {situacoes.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                <span className="font-semibold">Setor *</span>
                <select
                  value={pair.setor}
                  disabled={readOnly}
                  onChange={(e) =>
                    updatePair(pair.key, { setor: e.target.value })
                  }
                  className="mt-0.5 h-8 w-full rounded border border-sagra-border px-1 text-xs disabled:bg-slate-100"
                  aria-label={`Setor ${index + 1}`}
                >
                  <option value="">Selecione...</option>
                  {pair.setor && !setores.includes(pair.setor) ? (
                    <option value={pair.setor}>{pair.setor}</option>
                  ) : null}
                  {setores.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              {!readOnly ? (
                <button
                  type="button"
                  title="Remover andamento"
                  disabled={pairs.length <= 1}
                  onClick={() =>
                    setPairs((current) =>
                      current.filter((item) => item.key !== pair.key),
                    )
                  }
                  className="mb-0.5 rounded p-1 text-sagra-danger hover:bg-red-50 disabled:opacity-40"
                >
                  <Trash2 className="size-4" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
        {!readOnly ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                setPairs((current) => [
                  ...current,
                  { key: newDraftKey(), situacao: "", setor: "" },
                ])
              }
              className="inline-flex items-center gap-1 rounded border border-blue-300 bg-white px-2 py-1 text-xs font-semibold text-blue-900 hover:bg-blue-100"
              data-testid={homeTestIds.osVincularAddAndamento}
            >
              <Plus className="size-3.5" aria-hidden />
              Adicionar andamento
            </button>
            {grupoId ? (
              <button
                type="button"
                disabled={
                  !andamentosDirty ||
                  completePairs.length === 0 ||
                  saveAndamentosMutation.isPending
                }
                onClick={() => void handleSaveAndamentos()}
                className="rounded bg-secondary-blue px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                data-testid={homeTestIds.osVincularSaveAndamentos}
              >
                Salvar andamentos
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {membrosGrupo.length > 1 ? (
        <p className="mt-3 text-xs text-neutral-600">
          OSs do grupo:{" "}
          {membrosGrupo.map((m) => `${m.numero}/${m.ano}`).join(", ")}
        </p>
      ) : null}

      {!readOnly ? (
        <>
          <p className="mt-4 text-sm font-semibold">
            Vincular OS selecionada com:
          </p>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              placeholder="Número da OS"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              className="h-9 flex-1 rounded border border-sagra-border px-2 text-sm"
              aria-label="Número da OS para vincular"
            />
            <input
              type="text"
              inputMode="numeric"
              placeholder="Ano"
              value={vAno}
              onChange={(e) => setVAno(e.target.value)}
              onBlur={() => {
                const expanded = normalizeAno(vAno);
                if (expanded != null && String(expanded) !== vAno.trim()) {
                  setVAno(String(expanded));
                }
              }}
              className="h-9 w-24 rounded border border-sagra-border px-2 text-sm"
              aria-label="Ano da OS para vincular"
            />
            <button
              type="button"
              disabled={addMutation.isPending || !vinculoFound}
              onClick={() => void handleAdd()}
              className="rounded bg-secondary-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              data-testid={homeTestIds.osVincularConfirm}
            >
              Salvar
            </button>
          </div>
          {vinculoPair && vinculoProtoQuery.isFetching ? (
            <p className="mt-1 text-xs text-neutral-500">Verificando OS…</p>
          ) : vinculoPair && !vinculoFound ? (
            <p className="mt-1 text-xs text-red-600">
              OS {vinculoPair.os}/{vinculoPair.ano} não encontrada.
            </p>
          ) : vinculoFound && vinculoPair ? (
            <p className="mt-1 text-xs text-neutral-600">
              OS {vinculoPair.os}/{vinculoPair.ano} encontrada.
            </p>
          ) : null}
        </>
      ) : null}

      <p className="mt-4 text-sm font-semibold">OSs já vinculadas:</p>
      <div className="mt-2 max-h-48 overflow-auto rounded border border-sagra-border bg-slate-50 p-2 text-sm">
        {vinculosQuery.isLoading && (
          <p className="text-neutral-500">Carregando...</p>
        )}
        {!vinculosQuery.isLoading && vinculos.length === 0 && (
          <p className="text-neutral-500">Nenhuma vinculação.</p>
        )}
        {vinculos.map((v) => (
          <div
            key={`${v.numero}-${v.ano}`}
            className="flex items-center justify-between border-b border-sagra-border/50 py-1 last:border-0"
          >
            <span>
              {v.numero}/{v.ano}
            </span>
            {!readOnly ? (
              <button
                type="button"
                title="Remover vínculo"
                disabled={delMutation.isPending}
                onClick={async () => {
                  if (!window.confirm("Remover vínculo?")) {
                    return;
                  }
                  try {
                    await delMutation.mutateAsync({
                      vNum: v.numero,
                      vAno: v.ano,
                    });
                  } catch (e) {
                    window.alert(
                      `Erro: ${e instanceof Error ? e.message : "falha"}`,
                    );
                  }
                }}
                className="rounded p-1 text-sagra-danger hover:bg-red-50"
              >
                <Trash2 className="size-4" />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <span id={formId} className="sr-only">
        Editor de vínculos da OS
      </span>
    </div>
  );
}
