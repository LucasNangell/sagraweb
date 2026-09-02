import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { createSavedFilter } from "@/api/settings";
import { useAuthStore } from "@/features/auth/authStore";
import { homeTestIds } from "@/lib/testId";
import { osFiltersToSavedPayload } from "../savedFilterApply";
import { useOsFiltersStore } from "../osFiltersStore";

interface OsSaveCurrentFiltersModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (nome: string) => void;
}

export function OsSaveCurrentFiltersModal({
  open,
  onClose,
  onSaved,
}: OsSaveCurrentFiltersModalProps) {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const ponto = user?.ponto != null ? String(user.ponto) : null;
  const filters = useOsFiltersStore((s) => s.filters);
  const inputRef = useRef<HTMLInputElement>(null);
  const [nome, setNome] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setNome("");
    setError(null);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const saveMutation = useMutation({
    mutationFn: createSavedFilter,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings", "savedFilters"] });
      void qc.invalidateQueries({ queryKey: ["settings", "defaultFilters"] });
    },
  });

  const handleSubmit = async () => {
    const trimmed = nome.trim();
    if (!trimmed) {
      setError("Digite um nome para o filtro.");
      return;
    }
    if (!ponto) {
      setError("Sessão inválida. Faça login novamente.");
      return;
    }
    setError(null);
    try {
      await saveMutation.mutateAsync({
        usuario: user?.nome?.trim() || `Usuario_${ponto}`,
        ponto,
        nome: trimmed,
        ...osFiltersToSavedPayload(filters),
      });
      onSaved(trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar filtro.");
    }
  };

  if (!open) {
    return null;
  }

  const busy = saveMutation.isPending;

  return (
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="os-save-filters-title"
      data-testid={homeTestIds.osSaveFiltersRoot}
    >
      <div className="relative w-full max-w-md rounded-lg border-t-4 border-primary-green bg-white p-6 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 text-neutral-500 hover:text-neutral-800"
          aria-label="Fechar"
          disabled={busy}
        >
          <X className="size-5" />
        </button>

        <div className="flex items-center gap-2">
          <Save className="size-5 text-primary-green" aria-hidden />
          <h3
            id="os-save-filters-title"
            className="text-lg font-semibold text-primary-green"
          >
            Salvar filtros
          </h3>
        </div>
        <p className="mt-2 text-sm text-neutral-600">
          Informe um nome para este grupo de filtros. A combinação atual da
          página inicial será salva em Meus Filtros.
        </p>

        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          <label className="block text-sm font-medium text-neutral-700">
            Nome
            <input
              ref={inputRef}
              type="text"
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                if (error) {
                  setError(null);
                }
              }}
              placeholder="Nome do filtro"
              className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none ring-primary-green/30 transition focus:ring-2"
              disabled={busy}
              data-testid={homeTestIds.osSaveFiltersName}
            />
          </label>
          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded border border-sagra-border px-4 py-2 text-sm disabled:opacity-60"
              data-testid={homeTestIds.osSaveFiltersCancel}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded bg-primary-green px-4 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
              data-testid={homeTestIds.osSaveFiltersSubmit}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Save className="size-4" aria-hidden />
              )}
              Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
