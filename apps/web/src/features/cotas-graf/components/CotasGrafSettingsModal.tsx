import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Settings2, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  createSavedFilter,
  deleteSavedFilter,
  setDefaultSavedFilter,
  updateSavedFilter,
} from "@/api/settings";
import { useSavedFilters } from "@/api/hooks/useSavedFilters";
import { MultiSelect } from "@/components/ui/multi-select";
import { useAuthStore } from "@/features/auth/authStore";
import type { SavedFilter } from "@/features/os/types";
import { SITUACAO_COTAS_OPTIONS } from "../types";

function hasAnyCotasGrafFilters(situacoes: string[]) {
  return situacoes.length > 0;
}

interface CotasGrafSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function CotasGrafSettingsModal({ open, onClose }: CotasGrafSettingsModalProps) {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const ponto = user?.ponto != null ? String(user.ponto) : null;

  const [selectedSituacoesCotas, setSelectedSituacoesCotas] = useState<string[]>([]);
  const [newFilterName, setNewFilterName] = useState("");
  const [editingFilterId, setEditingFilterId] = useState<number | null>(null);
  const appliedInitialDefaultRef = useRef(false);

  const savedFiltersQuery = useSavedFilters(ponto, "cotas_graf");

  const clearEditMode = () => {
    setEditingFilterId(null);
    setNewFilterName("");
  };

  const createFilterMutation = useMutation({
    mutationFn: createSavedFilter,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings", "savedFilters"] });
      void qc.invalidateQueries({ queryKey: ["settings", "defaultFilters"] });
      clearEditMode();
    },
  });

  const updateFilterMutation = useMutation({
    mutationFn: ({
      filterId,
      ...payload
    }: {
      filterId: number;
      nome: string;
      situacoes: string[];
      setores: string[];
    }) => updateSavedFilter(filterId, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings", "savedFilters"] });
      void qc.invalidateQueries({ queryKey: ["settings", "defaultFilters"] });
      clearEditMode();
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: setDefaultSavedFilter,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings", "savedFilters"] });
      void qc.invalidateQueries({ queryKey: ["settings", "defaultFilters"] });
    },
  });

  const deleteFilterMutation = useMutation({
    mutationFn: deleteSavedFilter,
    onSuccess: (_data, deletedId) => {
      void qc.invalidateQueries({ queryKey: ["settings", "savedFilters"] });
      void qc.invalidateQueries({ queryKey: ["settings", "defaultFilters"] });
      if (editingFilterId === deletedId) {
        clearEditMode();
      }
    },
  });

  useEffect(() => {
    if (!open) {
      appliedInitialDefaultRef.current = false;
      setEditingFilterId(null);
      setNewFilterName("");
      return;
    }
    if (appliedInitialDefaultRef.current || !savedFiltersQuery.data) {
      return;
    }
    const defaultFilter = savedFiltersQuery.data.find((f) => f.is_default);
    if (defaultFilter && hasAnyCotasGrafFilters(defaultFilter.situacoes ?? [])) {
      setSelectedSituacoesCotas(defaultFilter.situacoes ?? []);
    }
    appliedInitialDefaultRef.current = true;
  }, [open, savedFiltersQuery.data]);

  const isBusy =
    createFilterMutation.isPending ||
    updateFilterMutation.isPending ||
    setDefaultMutation.isPending ||
    deleteFilterMutation.isPending;

  const isEditing = editingFilterId != null;

  const sortedSavedFilters = useMemo(
    () => (savedFiltersQuery.data ?? []).slice(),
    [savedFiltersQuery.data],
  );

  const handleCreateFilter = async () => {
    if (!ponto) {
      window.alert("Sessão inválida. Faça login novamente.");
      return;
    }
    const nome = newFilterName.trim();
    if (!nome) {
      window.alert("Digite um nome para o filtro.");
      return;
    }
    try {
      await createFilterMutation.mutateAsync({
        usuario: user?.nome?.trim() || `Usuario_${ponto}`,
        ponto,
        nome,
        situacoes: selectedSituacoesCotas,
        setores: [],
        context: "cotas_graf",
      });
      window.alert("Filtro salvo com sucesso.");
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Erro ao salvar filtro.");
    }
  };

  const handleUpdateFilter = async () => {
    if (editingFilterId == null) return;
    const nome = newFilterName.trim();
    if (!nome) {
      window.alert("Digite um nome para o filtro.");
      return;
    }
    try {
      await updateFilterMutation.mutateAsync({
        filterId: editingFilterId,
        nome,
        situacoes: selectedSituacoesCotas,
        setores: [],
      });
      window.alert("Filtro atualizado com sucesso.");
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Erro ao atualizar filtro.");
    }
  };

  const handleSetDefault = async (filter: SavedFilter) => {
    if (!ponto) {
      return;
    }
    try {
      await setDefaultMutation.mutateAsync({
        ponto,
        filter_id: filter.id,
        context: "cotas_graf",
      });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Erro ao definir padrão.");
    }
  };

  const handleDelete = async (filter: SavedFilter) => {
    if (!window.confirm(`Excluir o filtro "${filter.nome}"?`)) {
      return;
    }
    try {
      await deleteFilterMutation.mutateAsync(filter.id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Erro ao excluir filtro.");
    }
  };

  const handleApplyFilter = (filter: SavedFilter) => {
    setSelectedSituacoesCotas(filter.situacoes ?? []);
    setEditingFilterId(filter.id);
    setNewFilterName(filter.nome);
  };

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[10010] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Preferências de filtros Cotas Graf"
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-sagra-border bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-sagra-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Settings2 className="size-5 text-primary-green" />
            <h2 className="text-lg font-semibold text-secondary-blue">
              Filtros Cotas Graf
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-neutral-500 hover:bg-slate-100"
            aria-label="Fechar"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <p className="mb-4 text-sm text-neutral-600">
            Salve combinações de Situação Cotas para reutilizar nesta página. Os
            filtros são independentes da página Início.
          </p>

          <MultiSelect
            label="Situação Cotas"
            options={[...SITUACAO_COTAS_OPTIONS]}
            value={selectedSituacoesCotas}
            onChange={setSelectedSituacoesCotas}
            className="mb-4"
          />

          <div className="mb-6 flex flex-wrap gap-2">
            <input
              type="text"
              value={newFilterName}
              onChange={(e) => setNewFilterName(e.target.value)}
              placeholder="Nome do filtro"
              className="h-9 min-w-0 flex-1 rounded border border-sagra-border px-2 text-sm"
              disabled={isBusy}
            />
            <button
              type="button"
              onClick={() =>
                void (isEditing ? handleUpdateFilter() : handleCreateFilter())
              }
              disabled={isBusy}
              className="rounded bg-primary-green px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {isEditing
                ? updateFilterMutation.isPending
                  ? "Atualizando..."
                  : "Atualizar"
                : createFilterMutation.isPending
                  ? "Salvando..."
                  : "Salvar"}
            </button>
            {isEditing ? (
              <button
                type="button"
                onClick={clearEditMode}
                disabled={isBusy}
                className="rounded border border-sagra-border px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Novo filtro
              </button>
            ) : null}
          </div>

          {savedFiltersQuery.isPending ? (
            <div className="flex items-center gap-2 text-sm text-neutral-500">
              <Loader2 className="size-4 animate-spin" />
              Carregando filtros salvos…
            </div>
          ) : sortedSavedFilters.length === 0 ? (
            <p className="text-sm text-neutral-500">Nenhum filtro salvo ainda.</p>
          ) : (
            <ul className="space-y-2">
              {sortedSavedFilters.map((filter) => (
                <li
                  key={filter.id}
                  className={`flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm ${
                    editingFilterId === filter.id
                      ? "border-primary-green bg-primary-green/5"
                      : "border-sagra-border"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleApplyFilter(filter)}
                    className="min-w-0 flex-1 text-left hover:text-primary-green"
                    title="Editar filtro"
                  >
                    <span className="font-medium">{filter.nome}</span>
                    {filter.is_default ? (
                      <span className="ml-2 text-xs text-primary-green">(Padrão)</span>
                    ) : null}
                    {(filter.situacoes?.length ?? 0) > 0 ? (
                      <p className="text-xs text-neutral-500">
                        {filter.situacoes.join(", ")}
                      </p>
                    ) : null}
                  </button>
                  <div className="flex shrink-0 gap-1">
                    {!filter.is_default ? (
                      <button
                        type="button"
                        onClick={() => void handleSetDefault(filter)}
                        disabled={isBusy}
                        className="rounded border border-sagra-border px-2 py-1 text-xs hover:bg-slate-50"
                      >
                        Padrão
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void handleDelete(filter)}
                      disabled={isBusy}
                      className="rounded border border-red-200 p-1 text-red-600 hover:bg-red-50"
                      aria-label={`Excluir ${filter.nome}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
