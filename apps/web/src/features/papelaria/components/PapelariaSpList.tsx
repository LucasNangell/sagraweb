import { useMemo, useState } from "react";
import { Loader2, Settings2, X } from "lucide-react";
import { cn } from "@sagra/ui";

import { useOsSearch } from "@/api/hooks/useOsSearch";
import { useSituacoesLookup } from "@/api/hooks/useAuxLookups";
import { MultiSelect } from "@/components/ui/multi-select";
import { defaultOsFilters } from "@/features/os/osFiltersStore";
import type { OsSearchFilters, OsSearchRow } from "@/features/os/types";
import { sameOsRow } from "../papelariaSelection";
import {
  loadPapelariaSpSituacoes,
  savePapelariaSpSituacoes,
} from "../papelariaSpSituacoesPrefs";

type Props = {
  selected: OsSearchRow | null;
  onSelect: (row: OsSearchRow) => void;
  className?: string;
};

export function buildPapelariaSpFilters(situacoes: string[]): OsSearchFilters {
  return {
    ...defaultOsFilters(),
    anos: [],
    situacao: situacoes,
    setor: ["SEFOC"],
    includeFinished: false,
    includeOs: false,
    includeSp: true,
    page: 1,
    limit: 500,
    fetchAll: true,
    includeTotal: false,
    sortBy: "nr_os",
    sortDir: "asc",
    sorts: [{ column: "nr_os", dir: "asc" }],
  };
}

export function PapelariaSpList({ selected, onSelect, className }: Props) {
  const [situacoes, setSituacoes] = useState<string[]>(() =>
    loadPapelariaSpSituacoes(),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftSituacoes, setDraftSituacoes] = useState<string[]>(situacoes);

  const situacoesQuery = useSituacoesLookup();
  const filters = useMemo(
    () => buildPapelariaSpFilters(situacoes),
    [situacoes],
  );
  const searchEnabled = situacoes.length > 0;
  const searchQuery = useOsSearch(filters, searchEnabled);
  const rows = searchQuery.data?.data ?? [];

  const openSettings = () => {
    setDraftSituacoes(situacoes);
    setSettingsOpen(true);
  };

  const saveSettings = () => {
    savePapelariaSpSituacoes(draftSituacoes);
    setSituacoes([...draftSituacoes]);
    setSettingsOpen(false);
  };

  return (
    <section
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-sagra-border bg-white shadow-sm",
        className,
      )}
      aria-label="Lista de SPs no SEFOC"
      data-testid="papelaria-sp-list"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-sagra-border bg-slate-50/80 px-3 py-2">
        <div className="min-w-0">
          <h2 className="text-xs font-bold text-secondary-blue">SPs — SEFOC</h2>
          <p className="truncate text-[10px] text-neutral-500">
            {situacoes.length === 0
              ? "Configure as situações na engrenagem"
              : searchQuery.isLoading
                ? "Carregando…"
                : `${rows.length} SP(s)`}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-md border border-sagra-border bg-white text-secondary-blue transition hover:bg-slate-50"
          title="Configurar situações da lista"
          aria-label="Configurar situações da lista"
          data-testid="papelaria-sp-list-settings"
          onClick={openSettings}
        >
          <Settings2 className="size-4" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {situacoes.length === 0 ? (
          <p className="p-4 text-center text-xs text-neutral-500">
            Nenhuma situação selecionada. Use a engrenagem para escolher os
            andamentos que devem aparecer nesta lista.
          </p>
        ) : searchQuery.isLoading && rows.length === 0 ? (
          <p className="flex items-center justify-center gap-2 p-6 text-xs text-neutral-500">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Carregando SPs…
          </p>
        ) : searchQuery.isError ? (
          <div className="space-y-2 p-4 text-center text-xs text-sagra-danger">
            <p>Erro ao carregar a lista de SPs.</p>
            <button
              type="button"
              className="rounded border border-red-300 px-2 py-1 text-red-800 hover:bg-red-50"
              onClick={() => void searchQuery.refetch()}
            >
              Tentar novamente
            </button>
          </div>
        ) : rows.length === 0 ? (
          <p className="p-4 text-center text-xs text-neutral-500">
            Nenhuma SP no SEFOC com as situações configuradas.
          </p>
        ) : (
          <table className="w-full min-w-[28rem] border-collapse text-[11px]">
            <thead className="sticky top-0 bg-slate-100 text-left">
              <tr>
                <th className="px-2 py-1.5 font-semibold">Nr SP</th>
                <th className="px-2 py-1.5 font-semibold">Ano</th>
                <th className="px-2 py-1.5 font-semibold">Produto</th>
                <th className="px-2 py-1.5 font-semibold">Solicitante</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isSelected = sameOsRow(selected, row);
                return (
                  <tr
                    key={`${row.ano}-${row.nr_os}`}
                    className={cn(
                      "cursor-pointer border-b border-neutral-100 transition",
                      isSelected
                        ? "bg-secondary-blue/10"
                        : "hover:bg-slate-50",
                    )}
                    onClick={() => onSelect(row)}
                    aria-selected={isSelected}
                    data-testid={`papelaria-sp-row-${row.nr_os}-${row.ano}`}
                  >
                    <td className="px-2 py-1.5 font-mono font-semibold text-secondary-blue">
                      {row.nr_os}
                    </td>
                    <td className="px-2 py-1.5">{row.ano}</td>
                    <td className="max-w-[9rem] truncate px-2 py-1.5" title={row.produto ?? undefined}>
                      {row.produto ?? "—"}
                    </td>
                    <td className="max-w-[9rem] truncate px-2 py-1.5" title={row.solicitante ?? undefined}>
                      {row.solicitante ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {settingsOpen ? (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 p-4">
          <div
            className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="papelaria-sp-situacoes-title"
            data-testid="papelaria-sp-situacoes-modal"
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h3
                  id="papelaria-sp-situacoes-title"
                  className="text-sm font-bold text-secondary-blue"
                >
                  Situações da lista
                </h3>
                <p className="mt-1 text-[11px] text-neutral-500">
                  Exibe apenas SPs no setor SEFOC cujo andamento atual esteja
                  entre as situações selecionadas.
                </p>
              </div>
              <button
                type="button"
                className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
                aria-label="Fechar"
                onClick={() => setSettingsOpen(false)}
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            <MultiSelect
              label="Situações"
              options={situacoesQuery.data ?? []}
              value={draftSituacoes}
              onChange={setDraftSituacoes}
              isLoading={situacoesQuery.isLoading}
              placeholder="Selecione as situações…"
              testId="papelaria-sp-situacoes-select"
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="sagra-btn sagra-btn--outline sagra-btn--sm"
                onClick={() => setSettingsOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="sagra-btn sagra-btn--primary sagra-btn--sm"
                onClick={saveSettings}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
