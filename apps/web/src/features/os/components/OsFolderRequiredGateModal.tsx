import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";

import {
  createOsFolder,
  fetchOsFolderPlan,
} from "@/api/os";
import { queryKeys } from "@/api/query-keys";
import { formatOsLabel } from "@/lib/format";
import {
  confirmCreateOsFolderDialog,
  OsFolderCreatePanel,
} from "./OsFolderCreatePanel";

const PAPELARIA_FOLDER_PREREQUISITE =
  "A pasta da OS é necessária para prosseguir com a criação do arquivo de papelaria. Crie a pasta para continuar.";

interface OsFolderRequiredGateModalProps {
  open: boolean;
  ano: number;
  nro: number;
  onClose: () => void;
  /** Chamado após a pasta ser criada com sucesso. */
  onFolderReady: () => void;
}

export function OsFolderRequiredGateModal({
  open,
  ano,
  nro,
  onClose,
  onFolderReady,
}: OsFolderRequiredGateModalProps) {
  const queryClient = useQueryClient();
  const osLabel = formatOsLabel({ nr_os: nro, ano });

  const planQuery = useQuery({
    queryKey: open ? queryKeys.os.folderPlan(ano, nro) : ["os", "folderPlan", "idle"],
    queryFn: () => fetchOsFolderPlan(ano, nro),
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: () => createOsFolder(ano, nro),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.os.path(ano, nro),
      });
      await queryClient.invalidateQueries({
        queryKey: ["os", "folderBrowse", ano, nro],
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.os.folderPlan(ano, nro),
      });
    },
  });

  const handleCreate = async () => {
    if (!planQuery.data) return;
    if (!confirmCreateOsFolderDialog(osLabel, planQuery.data)) {
      return;
    }
    try {
      await createMutation.mutateAsync();
      onFolderReady();
    } catch (e) {
      window.alert(
        e instanceof Error ? e.message : "Não foi possível criar a pasta na rede.",
      );
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[160] flex items-center justify-center bg-black/60 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Criar pasta da OS ${osLabel}`}
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800">
              Pasta da OS necessária — {osLabel}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Crie a pasta na rede para continuar com a papelaria.
            </p>
          </div>
          <button
            type="button"
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            onClick={onClose}
            aria-label="Fechar"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <OsFolderCreatePanel
          plan={planQuery.data}
          planLoading={planQuery.isLoading}
          planError={planQuery.error}
          creating={createMutation.isPending}
          onCreate={() => void handleCreate()}
          extraNotice={PAPELARIA_FOLDER_PREREQUISITE}
        />

        <div className="border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            className="w-full text-center text-xs text-slate-500 hover:text-slate-700"
            onClick={onClose}
          >
            Cancelar — não criar arquivo agora
          </button>
        </div>
      </div>
    </div>
  );
}
