import { apiFetch, appStaticUrl } from "@/lib/api";

import type { PainelRawOp } from "./types";

interface PcpQueueResponse {
  items?: PainelRawOp[];
}

interface OsSearchMeta {
  has_next?: boolean;
}

interface OsSearchResponse {
  data?: PainelRawOp[];
  items?: PainelRawOp[];
  meta?: OsSearchMeta;
}

export async function fetchPainelQueueBySetor(
  setor: string,
): Promise<PainelRawOp[]> {
  const params = new URLSearchParams({
    setor,
    _ts: String(Date.now()),
  });
  const result = await apiFetch<PcpQueueResponse>(`/pcp/queue?${params}`);
  const items = Array.isArray(result.items) ? result.items : [];
  return items.map((item) => ({ ...item, fetchedSector: setor }));
}

export async function fetchPainelLegacyBySetor(
  setor: string,
): Promise<PainelRawOp[]> {
  const isGravacao = setor === "Gravação";
  const params = new URLSearchParams({
    setor: isGravacao ? "SEFOC" : setor,
    include_finished: "false",
    limit: "200",
    pcp_order: "true",
  });

  const result = await apiFetch<OsSearchResponse>(`/os/search?${params}`);
  let data = result.data ?? result.items ?? [];

  if (isGravacao) {
    const allowed = new Set(["Gravação", "Gravação Parcial"]);
    data = data.filter((item) => allowed.has(item.situacao ?? ""));
  }

  return data.map((item) => ({ ...item, fetchedSector: setor }));
}

export async function fetchPainelBoardData(
  setores: string[],
): Promise<PainelRawOp[]> {
  const uniqueSetores =
    setores.length > 0 ? Array.from(new Set(setores)) : ["SEFOC"];

  const results = await Promise.all(
    uniqueSetores.map(async (setor) => {
      try {
        return await fetchPainelQueueBySetor(setor);
      } catch (queueErr) {
        console.warn(
          `[Painel] Fila PCP indisponível para ${setor}, usando fallback legacy`,
          queueErr,
        );
        try {
          return await fetchPainelLegacyBySetor(setor);
        } catch (legacyErr) {
          console.error(`[Painel] Falha no fallback de ${setor}`, legacyErr);
          return [];
        }
      }
    }),
  );

  return results.flat();
}

export async function fetchPainelChartYearData(
  year: number,
  options?: { includeOs?: boolean; includeSp?: boolean },
): Promise<PainelRawOp[]> {
  const includeOs = options?.includeOs ?? true;
  const includeSp = options?.includeSp ?? true;
  const pageSize = 100;
  const all: PainelRawOp[] = [];
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    const params = new URLSearchParams({
      ano: String(year),
      include_finished: "true",
      limit: String(pageSize),
      page: String(page),
      include_os: String(includeOs),
      include_sp: String(includeSp),
    });
    const result = await apiFetch<OsSearchResponse>(`/os/search?${params}`);
    const batch = result.data ?? result.items ?? [];
    all.push(...batch);
    hasNext = result.meta?.has_next === true && batch.length > 0;
    page += 1;

    if (page > 60) {
      console.warn(
        `[Painel] Limite de páginas atingido ao carregar gráfico do ano ${year}`,
      );
      break;
    }
  }

  return all;
}

export async function fetchRemotePainelConfig(): Promise<unknown> {
  const res = await fetch(appStaticUrl("config_painel_global.json"), {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}
