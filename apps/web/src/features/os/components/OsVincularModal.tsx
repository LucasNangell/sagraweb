import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useSetoresLookup, useSituacoesLookup } from "@/api/hooks/useAuxLookups";
import { fetchProtocoloLookup } from "@/api/email";
import {
  createOsVinculo,
  deleteOsVinculo,
  fetchOsVinculoGrupoConfig,
  fetchOsVinculos,
} from "@/api/os";
import { queryKeys } from "@/api/query-keys";
import { useAuthStore } from "@/features/auth/authStore";
import {
  OS_ANO_MAX,
  OS_ANO_MIN,
  normalizeAno,
  parseOsAnoPair,
} from "../osAnoUtils";
import type { OsSearchRow } from "../types";

interface OsVincularModalProps {
  row: OsSearchRow | null;
  open: boolean;
  onClose: () => void;
}

export function OsVincularModal({ row, open, onClose }: OsVincularModalProps) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [numero, setNumero] = useState("");
  const [vAno, setVAno] = useState("");
  const [situacao, setSituacao] = useState("");
  const [setor, setSetor] = useState("");

  const ano = row?.ano ?? null;
  const id = row?.nr_os ?? null;

  const situacoesQuery = useSituacoesLookup();
  const setoresQuery = useSetoresLookup();

  const vinculosQuery = useQuery({
    queryKey:
      open && ano != null && id != null
        ? queryKeys.os.vinculos(ano, id)
        : ["os", "vinculos", "idle"],
    queryFn: () => fetchOsVinculos(ano!, id!),
    enabled: open && ano != null && id != null,
  });

  const grupoConfigQuery = useQuery({
    queryKey:
      open && ano != null && id != null
        ? queryKeys.os.vinculoGrupo(ano, id)
        : ["os", "vinculoGrupo", "idle"],
    queryFn: () => fetchOsVinculoGrupoConfig(ano!, id!),
    enabled: open && ano != null && id != null,
  });

  const grupoConfig = grupoConfigQuery.data;
  const grupoJaDefinido = Boolean(grupoConfig?.grupo_id);

  const vinculoPair = parseOsAnoPair(numero, vAno);
  const vinculoProtoQuery = useQuery({
    queryKey:
      open && vinculoPair
        ? queryKeys.email.protocolo(vinculoPair.ano, vinculoPair.os)
        : ["os", "vinculoProtocolo", "idle"],
    queryFn: () => fetchProtocoloLookup(vinculoPair!.os, vinculoPair!.ano),
    enabled: open && vinculoPair != null,
    staleTime: 60_000,
  });
  const vinculoFound = vinculoProtoQuery.data?.NroProtocolo != null;

  useEffect(() => {
    if (!open) {
      return;
    }
    if (grupoConfig?.situacao) {
      setSituacao(grupoConfig.situacao);
    }
    if (grupoConfig?.setor) {
      setSetor(grupoConfig.setor);
    }
  }, [open, grupoConfig?.situacao, grupoConfig?.setor]);

  const invalidate = () => {
    if (ano != null && id != null) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.os.vinculos(ano, id),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.os.vinculoGrupo(ano, id),
      });
    }
  };

  const addMutation = useMutation({
    mutationFn: ({
      numero: n,
      vano,
      situacao: sit,
      setor: st,
    }: {
      numero: number;
      vano: number;
      situacao: string;
      setor: string;
    }) =>
      createOsVinculo(ano!, id!, n, vano, {
        situacao: sit,
        setor: st,
        criado_por: user?.ponto != null ? String(user.ponto) : undefined,
      }),
    onSuccess: () => {
      setNumero("");
      setVAno("");
      invalidate();
    },
  });

  const delMutation = useMutation({
    mutationFn: ({ vNum, vAno: va }: { vNum: number; vAno: number }) =>
      deleteOsVinculo(ano!, id!, vNum, va),
    onSuccess: invalidate,
  });

  if (!open || !row) {
    return null;
  }

  const handleAdd = async () => {
    const pair = parseOsAnoPair(numero, vAno);
    if (!pair) {
      window.alert(
        `Informe número e ano válidos (ano com 2 dígitos ou 4 dígitos entre ${OS_ANO_MIN} e ${OS_ANO_MAX}).`,
      );
      return;
    }
    if (!vinculoFound) {
      window.alert(`OS ${pair.os}/${pair.ano} não encontrada.`);
      return;
    }
    if (!grupoJaDefinido && (!situacao.trim() || !setor.trim())) {
      window.alert(
        "Informe o andamento e o setor que definem o comportamento do grupo.",
      );
      return;
    }
    try {
      await addMutation.mutateAsync({
        numero: pair.os,
        vano: pair.ano,
        situacao: situacao.trim(),
        setor: setor.trim(),
      });
    } catch (e) {
      window.alert(
        `Erro ao vincular: ${e instanceof Error ? e.message : "falha"}`,
      );
    }
  };

  const vinculos = vinculosQuery.data ?? [];
  const membrosGrupo = grupoConfig?.membros ?? [];

  return (
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-lg rounded-lg border-t-4 border-[#24344D] bg-white p-6 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 text-neutral-500 hover:text-neutral-800"
          aria-label="Fechar"
        >
          <X className="size-5" />
        </button>
        <h3 className="text-lg font-semibold text-primary-green">Vincular OS</h3>
        <p className="mt-1 text-sm text-neutral-600">
          OS selecionada: {row.nr_os}/{row.ano}
        </p>

        <div className="mt-4 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
          <p className="font-semibold">Comportamento do grupo</p>
          <p className="mt-1 text-xs">
            Defina qual andamento e setor devem ser lançados em conjunto em todas
            as OSs do grupo. Quando outro usuário lançar esse par, o sistema
            perguntará se deseja replicar a todas.
          </p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-xs">
              <span className="font-semibold">Andamento do grupo *</span>
              <select
                value={situacao}
                disabled={grupoJaDefinido}
                onChange={(e) => setSituacao(e.target.value)}
                className="mt-0.5 h-8 w-full rounded border border-sagra-border px-1 text-xs disabled:bg-slate-100"
              >
                <option value="">Selecione...</option>
                {(situacoesQuery.data ?? []).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="font-semibold">Setor do grupo *</span>
              <select
                value={setor}
                disabled={grupoJaDefinido}
                onChange={(e) => setSetor(e.target.value)}
                className="mt-0.5 h-8 w-full rounded border border-sagra-border px-1 text-xs disabled:bg-slate-100"
              >
                <option value="">Selecione...</option>
                {(setoresQuery.data ?? []).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {grupoJaDefinido ? (
            <p className="mt-2 text-[0.65rem] text-blue-800">
              Comportamento já definido para este grupo (somente leitura).
            </p>
          ) : null}
        </div>

        {membrosGrupo.length > 1 ? (
          <p className="mt-3 text-xs text-neutral-600">
            OSs do grupo:{" "}
            {membrosGrupo.map((m) => `${m.numero}/${m.ano}`).join(", ")}
          </p>
        ) : null}

        <p className="mt-4 text-sm font-semibold">Vincular OS selecionada com:</p>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            placeholder="Número da OS"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            className="h-9 flex-1 rounded border border-sagra-border px-2 text-sm"
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
          />
          <button
            type="button"
            disabled={addMutation.isPending || !vinculoFound}
            onClick={() => void handleAdd()}
            className="rounded bg-secondary-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
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
            </div>
          ))}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-sagra-border px-4 py-2 text-sm"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
