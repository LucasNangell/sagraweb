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

export type PainelVolumeCategory =
  | "em_andamento"
  | "entregue"
  | "cancelado";

export interface PainelVolumeMonth {
  month: number;
  em_andamento: number;
  entregue: number;
  cancelado: number;
}

interface PainelVolumeMensalResponse {
  ano: number;
  months: PainelVolumeMonth[];
}

export interface PainelVolumeDrillRow {
  setor?: string;
  produto?: string;
  situacao?: string;
}

interface PainelVolumeDrillResponse {
  ano: number;
  month: number;
  category: string;
  setor?: string | null;
  rows: PainelVolumeDrillRow[];
}

export async function fetchPainelQueueBySetor(
  setor: string,
): Promise<PainelRawOp[]> {
  const params = new URLSearchParams({
    setor,
    painel: "1",
    _ts: String(Date.now()),
  });
  const result = await apiFetch<PcpQueueResponse>(`/pcp/queue?${params}`);
  const items = Array.isArray(result.items) ? result.items : [];
  return items.map((item) => ({ ...item, fetchedSector: setor }));
}

export async function fetchPainelLegacyBySetor(
  setor: string,
): Promise<PainelRawOp[]> {
  const params = new URLSearchParams({
    setor,
    include_finished: "false",
    limit: "200",
    pcp_order: "true",
  });

  const result = await apiFetch<OsSearchResponse>(`/os/search?${params}`);
  const data = result.data ?? result.items ?? [];

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

export async function fetchPainelVolumeMensal(
  year: number,
  options?: { includeOs?: boolean; includeSp?: boolean },
): Promise<PainelVolumeMonth[]> {
  const includeOs = options?.includeOs ?? true;
  const includeSp = options?.includeSp ?? true;
  const params = new URLSearchParams({
    ano: String(year),
    include_os: String(includeOs),
    include_sp: String(includeSp),
  });
  const result = await apiFetch<PainelVolumeMensalResponse>(
    `/os/volume-mensal?${params}`,
  );
  return Array.isArray(result.months) ? result.months : [];
}

export async function fetchPainelVolumeDrill(
  year: number,
  month: number,
  category: PainelVolumeCategory,
  options?: { includeOs?: boolean; includeSp?: boolean; setor?: string },
): Promise<PainelVolumeDrillRow[]> {
  const includeOs = options?.includeOs ?? true;
  const includeSp = options?.includeSp ?? true;
  const params = new URLSearchParams({
    ano: String(year),
    month: String(month),
    category,
    include_os: String(includeOs),
    include_sp: String(includeSp),
  });
  if (options?.setor) {
    params.set("setor", options.setor);
  }
  const result = await apiFetch<PainelVolumeDrillResponse>(
    `/os/volume-mensal/drill?${params}`,
  );
  return Array.isArray(result.rows) ? result.rows : [];
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
