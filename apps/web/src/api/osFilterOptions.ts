import { apiFetch } from "@/api/client";

export interface FilterOptionItem {
  value: string;
  label: string;
  count?: number;
}

export interface FilterOptionsResponse {
  data: FilterOptionItem[];
}

export interface YearsResponse {
  data: number[];
}

export async function fetchOsFilterYears(
  init?: RequestInit,
): Promise<YearsResponse> {
  return apiFetch<YearsResponse>("/os/filter-options/years", init);
}

export async function fetchOsFilterProducts(
  q?: string,
  limit = 30,
  init?: RequestInit,
): Promise<FilterOptionsResponse> {
  const params = new URLSearchParams();
  if (q?.trim()) {
    params.set("q", q.trim());
  }
  params.set("limit", String(limit));
  return apiFetch<FilterOptionsResponse>(
    `/os/filter-options/products?${params}`,
    init,
  );
}

export async function fetchOsFilterRequesters(
  q?: string,
  limit = 30,
  init?: RequestInit,
  categorias?: string[],
): Promise<FilterOptionsResponse> {
  const params = new URLSearchParams();
  if (q?.trim()) {
    params.set("q", q.trim());
  }
  params.set("limit", String(limit));
  for (const cat of categorias ?? []) {
    const trimmed = cat.trim();
    if (trimmed) {
      params.append("categorias", trimmed);
    }
  }
  return apiFetch<FilterOptionsResponse>(
    `/os/filter-options/requesters?${params}`,
    init,
  );
}
