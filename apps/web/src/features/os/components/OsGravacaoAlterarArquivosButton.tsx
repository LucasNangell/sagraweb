import { FolderOpen } from "lucide-react";
import { useMemo, useState } from "react";

import {
  useGravacaoExternaDetail,
  useUpdateGravacaoExternaArquivosMutation,
} from "@/api/hooks/useGravacaoExterna";
import {
  useGravacaoPendenteDetail,
  useUpdateGravacaoPendenteArquivosMutation,
} from "@/api/hooks/useGravacaoPendente";
import {
  GravacaoPendenteLaunchModal,
  type GravacaoPendenteArquivoLaunch,
  type GravacaoPendenteChapaInput,
  type GravacaoPendenteLaunchResult,
} from "@/features/gravacao-externa/components/GravacaoPendenteLaunchModal";
import {
  canAlterarArquivosGravacaoExterna,
  canAlterarArquivosGravacaoPendente,
  isGravacaoExternaSituacao,
  isGravacaoPendenteSituacao,
} from "@/features/gravacao-externa/constants";
import type { OsSearchRow } from "../types";

interface OsGravacaoAlterarArquivosButtonProps {
  selected: OsSearchRow;
  frozen: boolean;
  disabled?: boolean;
}

export function OsGravacaoAlterarArquivosButton({
  selected,
  frozen,
  disabled = false,
}: OsGravacaoAlterarArquivosButtonProps) {
  const [modalOpen, setModalOpen] = useState(false);

  const isSubOs = Boolean(selected.is_sub_os);
  const isExterna = isGravacaoExternaSituacao(selected.situacao);
  const isPendente = isGravacaoPendenteSituacao(selected.situacao);
  const canFetch = !isSubOs && !frozen && (isExterna || isPendente);

  const externaDetailQuery = useGravacaoExternaDetail(
    selected.ano,
    selected.nr_os,
    canFetch && isExterna,
  );
  const pendenteDetailQuery = useGravacaoPendenteDetail(
    selected.ano,
    selected.nr_os,
    canFetch && isPendente,
  );

  const updateExternaMutation = useUpdateGravacaoExternaArquivosMutation();
  const updatePendenteMutation = useUpdateGravacaoPendenteArquivosMutation();

  const initialArquivos = useMemo((): GravacaoPendenteArquivoLaunch[] => {
    if (isExterna) {
      return (externaDetailQuery.data?.arquivos ?? [])
        .map((arq) => ({
          absolute_path: arq.absolute_path ?? arq.relative ?? "",
          nome: arq.nome,
          maquina: arq.maquina ?? null,
        }))
        .filter((a) => a.absolute_path);
    }
    return (pendenteDetailQuery.data?.arquivos ?? []).map((arq) => ({
      absolute_path: arq.absolute_path,
      nome: arq.nome,
      maquina: arq.maquina ?? null,
    }));
  }, [isExterna, externaDetailQuery.data, pendenteDetailQuery.data]);

  const initialChapas = useMemo((): GravacaoPendenteChapaInput[] => {
    if (isPendente) {
      return (pendenteDetailQuery.data?.chapas ?? []).map((c) => ({
        maquina: c.maquina,
        quantidade: c.quantidade,
      }));
    }
    // Externa não persiste chapas: deriva quantidade = nº de TIFs por máquina.
    const byMachine = new Map<string, number>();
    for (const arq of externaDetailQuery.data?.arquivos ?? []) {
      const maquina = String(arq.maquina || "").trim();
      if (!maquina) continue;
      const ext = arq.nome.split(".").pop()?.toLowerCase() ?? "";
      if (ext !== "tif" && ext !== "tiff") continue;
      byMachine.set(maquina, (byMachine.get(maquina) ?? 0) + 1);
    }
    return [...byMachine.entries()].map(([maquina, quantidade]) => ({
      maquina,
      quantidade,
    }));
  }, [isPendente, pendenteDetailQuery.data, externaDetailQuery.data]);

  if (!canFetch) {
    return null;
  }

  const canAlter =
    (isExterna && canAlterarArquivosGravacaoExterna(externaDetailQuery.data)) ||
    (isPendente && canAlterarArquivosGravacaoPendente(pendenteDetailQuery.data));

  if (!canAlter) {
    return null;
  }

  const detailLoading =
    (isExterna && externaDetailQuery.isLoading) ||
    (isPendente && pendenteDetailQuery.isLoading);

  const saving =
    updateExternaMutation.isPending || updatePendenteMutation.isPending;

  const handleOpen = () => {
    if (detailLoading) {
      window.alert("Carregando arquivos da sessão…");
      return;
    }
    setModalOpen(true);
  };

  const handleConfirm = async (result: GravacaoPendenteLaunchResult) => {
    try {
      if (isExterna) {
        await updateExternaMutation.mutateAsync({
          ano: selected.ano,
          nrOs: selected.nr_os,
          arquivos: result.arquivos.map(({ absolute_path, nome, maquina }) => ({
            absolute_path,
            nome,
            maquina: maquina ?? null,
          })),
        });
      } else {
        await updatePendenteMutation.mutateAsync({
          ano: selected.ano,
          nrOs: selected.nr_os,
          arquivos: result.arquivos,
          chapas: result.chapas,
        });
      }
      setModalOpen(false);
      window.alert("Arquivos atualizados com sucesso.");
    } catch (e) {
      window.alert(
        e instanceof Error ? e.message : "Não foi possível alterar os arquivos.",
      );
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled || saving || detailLoading}
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
      >
        <FolderOpen className="size-3.5" />
        Alterar arquivos
      </button>

      <GravacaoPendenteLaunchModal
        row={selected}
        open={modalOpen}
        mode="edit"
        initialArquivos={initialArquivos}
        initialChapas={initialChapas}
        saving={saving}
        onClose={() => setModalOpen(false)}
        onConfirm={(result) => void handleConfirm(result)}
      />
    </>
  );
}
