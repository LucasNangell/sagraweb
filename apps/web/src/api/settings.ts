import { apiFetch } from "@/api/client";

import type {
  SavedFilter,
  SavedFilterCriterios,
  UserFiltersDefault,
} from "@/features/os/types";

export type SavedFilterContext = "os" | "cotas_graf";

interface SaveFilterPayload {
  usuario: string;
  ponto: string;
  nome: string;
  situacoes: string[];
  setores: string[];
  criterios?: SavedFilterCriterios;
  context?: SavedFilterContext;
}

interface SetDefaultFilterPayload {
  ponto: string;
  filter_id: number;
  context?: SavedFilterContext;
}

export async function fetchSavedFilters(
  ponto: string,
  context: SavedFilterContext = "os",
): Promise<SavedFilter[]> {
  const qs = new URLSearchParams({ context });
  return apiFetch<SavedFilter[]>(
    `/settings/filters/saved/${encodeURIComponent(ponto)}?${qs}`,
  );
}

export async function fetchUserFiltersDefault(
  ponto: string,
  context: SavedFilterContext = "os",
): Promise<UserFiltersDefault> {
  const qs = new URLSearchParams({ context });
  return apiFetch<UserFiltersDefault>(
    `/settings/filtros/ponto/${encodeURIComponent(ponto)}?${qs}`,
  );
}

export async function createSavedFilter(payload: SaveFilterPayload) {
  return apiFetch<{ status: string }>("/settings/filters/saved", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

interface UpdateFilterPayload {
  nome: string;
  situacoes: string[];
  setores: string[];
  criterios?: SavedFilterCriterios;
}

export async function updateSavedFilter(
  filterId: number,
  payload: UpdateFilterPayload,
) {
  return apiFetch<{ status: string }>(
    `/settings/filters/saved/${encodeURIComponent(String(filterId))}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export async function setDefaultSavedFilter(payload: SetDefaultFilterPayload) {
  return apiFetch<{ status: string }>("/settings/filters/saved/default", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteSavedFilter(filterId: number) {
  return apiFetch<{ status: string }>(
    `/settings/filters/saved/${encodeURIComponent(String(filterId))}/delete`,
    { method: "POST" },
  );
}
