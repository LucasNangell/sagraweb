import { apiFetch, apiUrl } from "@/api/client";

import type {
  PapelariaApproveProvaResponse,
  PapelariaCorelModelDetail,
  PapelariaCorelModelSummary,
  PapelariaCreateJobPayload,
  PapelariaField,
  PapelariaJob,
  PapelariaModel,
  PapelariaOsContext,
  PapelariaPreviewPagesResponse,
  PapelariaPreviewPayload,
} from "@/features/papelaria/types";

async function parsePapelariaError(res: Response): Promise<string> {
  const text = await res.text().catch(() => res.statusText);
  try {
    const data = JSON.parse(text) as { detail?: string };
    if (typeof data.detail === "string" && data.detail.trim()) {
      return data.detail;
    }
  } catch {
    /* resposta não-JSON */
  }
  return text.trim() || `Erro HTTP ${res.status}`;
}

/** @deprecated legado — usar fetchPapelariaCorelModelos */
export async function fetchPapelariaModelos(): Promise<PapelariaModel[]> {
  const rows = await fetchPapelariaCorelModelos();
  return rows.map((m) => ({ id: String(m.id), nome: m.nome_exibicao }));
}

/** @deprecated legado — usar fetchPapelariaCorelModelo */
export async function fetchPapelariaModelFields(
  modelId: string,
): Promise<PapelariaField[]> {
  const id = parseInt(modelId, 10);
  if (Number.isNaN(id)) return [];
  const detail = await fetchPapelariaCorelModelo(id);
  return detail.campos_formulario ?? [];
}

export async function fetchPapelariaCorelModelos(params?: {
  produto?: string;
  cores?: string;
  frente_versao?: string;
}): Promise<PapelariaCorelModelSummary[]> {
  const search = new URLSearchParams();
  if (params?.produto) search.set("produto", params.produto);
  if (params?.cores) search.set("cores", params.cores);
  if (params?.frente_versao) search.set("frente_verso", params.frente_versao);
  const qs = search.toString();
  return apiFetch<PapelariaCorelModelSummary[]>(
    `/papelaria/modelos${qs ? `?${qs}` : ""}`,
  );
}

export async function fetchPapelariaCorelModelo(
  modeloId: number,
): Promise<PapelariaCorelModelDetail> {
  return apiFetch<PapelariaCorelModelDetail>(`/papelaria/modelos/${modeloId}`);
}

export async function fetchPapelariaOsContext(
  ano: number,
  nro: number,
): Promise<PapelariaOsContext> {
  return apiFetch<PapelariaOsContext>(`/papelaria/os/${ano}/${nro}/contexto`);
}

export async function generatePapelariaPreview(
  _payload: PapelariaPreviewPayload,
): Promise<Blob> {
  throw new Error(
    "Pré-visualização PDF via Corel não está disponível nesta fase. Use a prévia textual.",
  );
}

export async function createPapelariaJob(
  payload: PapelariaCreateJobPayload,
): Promise<PapelariaJob> {
  return apiFetch<PapelariaJob>("/papelaria/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchPapelariaCdrPath(
  ano: number,
  nro: number,
): Promise<{ path: string; filename: string }> {
  return apiFetch<{ path: string; filename: string }>(
    `/papelaria/os/${ano}/${nro}/cdr-path`,
  );
}

export async function abrirCorelPapelariaOs(
  ano: number,
  nro: number,
  lancarAndamento: boolean,
): Promise<{ path: string; filename: string }> {
  return apiFetch<{ path: string; filename: string }>(
    `/papelaria/os/${ano}/${nro}/abrir-corel`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lancar_andamento: lancarAndamento }),
    },
  );
}

export async function finalizarCorelPapelariaOs(payload: {
  ano: number;
  nro: number;
  modelo_id: number;
  dados: Record<string, string>;
}): Promise<PapelariaJob> {
  return apiFetch<PapelariaJob>(`/papelaria/os/${payload.ano}/${payload.nro}/finalizar-corel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function gerarProvaCdrExistentePapelariaOs(payload: {
  ano: number;
  nro: number;
  modelo_id: number;
  dados?: Record<string, string>;
  lancar_andamento?: boolean;
}): Promise<PapelariaJob> {
  return apiFetch<PapelariaJob>(
    `/papelaria/os/${payload.ano}/${payload.nro}/gerar-prova-cdr-existente`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export async function fetchPapelariaJob(jobId: number): Promise<PapelariaJob> {
  return apiFetch<PapelariaJob>(`/papelaria/jobs/${jobId}`);
}

export async function fetchPapelariaJobsForOs(
  ano: number,
  nro: number,
): Promise<PapelariaJob[]> {
  return apiFetch<PapelariaJob[]>(`/papelaria/os/${ano}/${nro}/jobs`);
}

export async function cancelPapelariaJob(jobId: number): Promise<PapelariaJob> {
  return apiFetch<PapelariaJob>(`/papelaria/jobs/${jobId}/cancel`, {
    method: "POST",
  });
}

export async function approvePapelariaJobProva(
  jobId: number,
): Promise<PapelariaApproveProvaResponse> {
  return apiFetch<PapelariaApproveProvaResponse>(
    `/papelaria/jobs/${jobId}/aprovar-prova`,
    { method: "POST" },
  );
}

export async function discardPapelariaJobProva(
  jobId: number,
): Promise<PapelariaJob> {
  return apiFetch<PapelariaJob>(`/papelaria/jobs/${jobId}/descartar-prova`, {
    method: "POST",
  });
}

export function papelariaJobFileUrl(jobId: number, tipo: "pdf" | "cdr"): string {
  return apiUrl(`/papelaria/jobs/${jobId}/arquivo/${tipo}`);
}

export async function fetchPapelariaJobPreviewPages(
  jobId: number,
): Promise<PapelariaPreviewPagesResponse> {
  return apiFetch<PapelariaPreviewPagesResponse>(
    `/papelaria/jobs/${jobId}/preview-pages`,
  );
}

export function papelariaJobPreviewPageUrl(jobId: number, page: number): string {
  return apiUrl(`/papelaria/jobs/${jobId}/preview-pages/${page}.png`);
}
