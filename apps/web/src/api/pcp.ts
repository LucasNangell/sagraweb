import { apiFetch } from "@/lib/api";

export interface PcpPrevisao {
  previsao_proximo_andamento?: string | null;
  previsao_conclusao?: string | null;
  confianca?: "alta" | "media" | "baixa" | "insuficiente";
  amostras?: number;
  trabalho_finalizado?: boolean;
}

export interface PcpQueueItem {
  nr_os: number;
  ano: number;
  titulo?: string | null;
  produto?: string | null;
  formato?: string | null;
  tiragem?: number | null;
  pags?: number | null;
  situacao?: string | null;
  setor?: string | null;
  data_entrega?: string | null;
  entreg_periodo?: string | null;
  prioridade?: string | null;
  nome_usuario?: string | null;
  last_update?: string | null;
  observacao?: string | null;
  pcp_ordem?: number | null;
  pcp_ultima_atualizacao?: string | null;
  previsao?: PcpPrevisao | null;
  row_kind?: "main_os" | "sub_os";
  sub_os_id?: number;
  display_label?: string | null;
  componente_nome?: string | null;
  parent_nr_os?: number;
  parent_ano?: number;
}

export interface PcpQueueResponse {
  setor: string;
  items: PcpQueueItem[];
}

export interface PcpReorderPayload {
  setor: string;
  items: { nr_os: number; ano: number }[];
}

export async function fetchPcpQueue(setor: string): Promise<PcpQueueResponse> {
  const params = new URLSearchParams({ setor });
  return apiFetch<PcpQueueResponse>(`/pcp/queue?${params}`);
}

export async function reorderPcpQueue(
  payload: PcpReorderPayload,
): Promise<{ status: string; count: number }> {
  return apiFetch<{ status: string; count: number }>("/pcp/queue/reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchAndamentos(): Promise<string[]> {
  try {
    const rows = await apiFetch<{ Situacao?: string }[]>("/aux/andamentos");
    return rows
      .map((r) => r.Situacao)
      .filter((v): v is string => Boolean(v?.trim()));
  } catch {
    const { fetchSituacoes } = await import("@/api/auxLookups");
    return fetchSituacoes();
  }
}
