import {
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
} from "lucide-react";

import type { OsFolderPlanResponse } from "@/api/os";
import { homeTestIds } from "@/lib/testId";

export interface OsFolderCreatePanelProps {
  plan: OsFolderPlanResponse | undefined;
  planLoading: boolean;
  planError: unknown;
  creating: boolean;
  onCreate: () => void;
  /** Texto extra abaixo do aviso âmbar (ex.: pré-requisito da papelaria). */
  extraNotice?: string;
}

/** Confirm idêntico ao usado em “Abrir Pasta de Rede” na home. */
export function confirmCreateOsFolderDialog(
  osLabel: string,
  plan: OsFolderPlanResponse,
): boolean {
  return window.confirm(
    `Criar a pasta da OS ${osLabel} na rede?\n\n` +
      `Nome: ${plan.folder_name}\n` +
      `Local: ${plan.base_path}\n\n` +
      `Subpastas:\n` +
      `• Original\n` +
      `• Sefoc\n` +
      `  • Offset\n` +
      `  • Digital\n` +
      `  • AdminDocs`,
  );
}

export function OsFolderCreatePanel({
  plan,
  planLoading,
  planError,
  creating,
  onCreate,
  extraNotice,
}: OsFolderCreatePanelProps) {
  if (planLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 py-16 text-sm text-slate-600">
        <Loader2 className="size-5 animate-spin" aria-hidden />
        Preparando estrutura da pasta…
      </div>
    );
  }

  if (planError) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <p className="max-w-lg text-center text-sm text-red-700">
          {planError instanceof Error
            ? planError.message
            : "Não foi possível obter o plano de criação da pasta."}
        </p>
      </div>
    );
  }

  if (!plan) {
    return null;
  }

  if (plan.exists) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <p className="text-sm text-slate-600">
          A pasta já existe na rede. Recarregue o explorador.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-white px-6 py-5">
      <div className="mx-auto w-full max-w-2xl">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-900">
            Pasta da OS não encontrada na rede
          </p>
          <p className="mt-1 text-xs text-amber-800">
            Você pode criar a estrutura padrão CGraf/Sefoc com o nome e subpastas
            abaixo.
          </p>
          {extraNotice ? (
            <p className="mt-2 text-xs font-medium text-amber-950">{extraNotice}</p>
          ) : null}
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Nome da pasta
            </p>
            <p className="mt-1 rounded border border-slate-200 bg-[#fafafa] px-3 py-2 font-mono text-sm text-slate-800">
              {plan.folder_name}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Padrão:{" "}
              <span className="font-mono">NNNNN-Solicitante-Produto_Titul</span>{" "}
              (solicitante: {plan.solicitante}; produto: {plan.produto}
              {plan.titulo ? `; título: ${plan.titulo}` : null})
            </p>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Local na rede
            </p>
            <p className="mt-1 break-all rounded border border-slate-200 bg-[#fafafa] px-3 py-2 text-xs text-slate-700">
              {plan.base_path}
            </p>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Estrutura que será criada
            </p>
            <ul className="rounded border border-slate-200 bg-[#fafafa] px-3 py-2 text-sm text-slate-800">
              <li className="flex items-center gap-2 py-1">
                <FolderOpen className="size-4 shrink-0 text-amber-500" aria-hidden />
                <span className="font-medium">{plan.folder_name}</span>
              </li>
              {plan.subfolders.map((sub) => {
                const depth = sub.split("/").length;
                return (
                  <li
                    key={sub}
                    className="flex items-center gap-2 py-0.5 text-slate-700"
                    style={{ paddingLeft: `${depth * 16}px` }}
                  >
                    <Folder className="size-3.5 shrink-0 text-amber-500" aria-hidden />
                    <span>{sub.includes("/") ? sub.split("/").pop() : sub}</span>
                    {sub.includes("/") ? (
                      <span className="text-xs text-slate-400">({sub})</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={onCreate}
            disabled={creating}
            className="inline-flex items-center gap-2 rounded bg-secondary-blue px-5 py-2.5 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
            data-testid={homeTestIds.osFolderCreate}
          >
            {creating ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <FolderPlus className="size-4" aria-hidden />
            )}
            Criar pasta na rede
          </button>
        </div>
      </div>
    </div>
  );
}
