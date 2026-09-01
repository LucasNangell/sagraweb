import { apiFetch, apiUrl } from "@/api/client";

import type {
  EmailTemplateModelRecord,
  EmailTemplateModelsListResponse,
  EmailTemplatesConfigResponse,
  GravacaoEmailNotificationSettings,
  EmailTemplateRecord,
  GerenciaSettings,
  CotasGrafSemestreInfo,
  CotasGrafProximoSemestreInfo,
  IniciarNovoSemestrePayload,
  ImportGraficaRapidaResult,
  RecalcularCotasResult,
  PapelariaAdminModelRecord,
  PapelariaAdminWorkerQueueSnapshot,
  PreAnaliseCheckConfig,
  SystemCatalogCategoryKey,
  SystemCatalogCategoryMeta,
  SystemCatalogItemRecord,
  SystemCatalogListResponse,
  SystemCatalogVariacao,
  CustoFuncaoCreatePayload,
  CustoFuncaoListResponse,
  CustoFuncaoRecord,
  CustoFuncaoUpdatePayload,
  OrcamentoFaixaRecord,
  OrcamentoFormatoRecord,
  OrcamentoInsumoRecord,
  OrcamentoParametroRecord,
  ProdutoPassosResponse,
  ProdutoPassoRecord,
} from "@/features/configuracoes/types";

export async function fetchPreAnaliseChecksConfig(): Promise<PreAnaliseCheckConfig[]> {
  const data = await apiFetch<{ checks: PreAnaliseCheckConfig[] }>(
    "/admin/system/pre-analise-checks",
  );
  return data.checks ?? [];
}

export async function savePreAnaliseChecksConfig(disabled: string[]) {
  return apiFetch<{ checks: PreAnaliseCheckConfig[] }>(
    "/admin/system/pre-analise-checks",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disabled }),
    },
  );
}

export async function fetchGerenciaSettingsConfig(): Promise<GerenciaSettings> {
  return apiFetch<GerenciaSettings>("/admin/system/gerencia-settings");
}

export async function saveGerenciaSettingsConfig(
  payload: GerenciaSettings,
): Promise<GerenciaSettings> {
  return apiFetch<GerenciaSettings>("/admin/system/gerencia-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchCotasGrafSemestreConfig(): Promise<{
  semestre: CotasGrafSemestreInfo | null;
  proximo_semestre: CotasGrafProximoSemestreInfo | null;
}> {
  return apiFetch<{
    semestre: CotasGrafSemestreInfo | null;
    proximo_semestre: CotasGrafProximoSemestreInfo | null;
  }>("/admin/system/cotas-graf-semestre");
}

export async function iniciarNovoSemestreCotasGraf(
  payload: IniciarNovoSemestrePayload,
): Promise<{
  ok: boolean;
  semestre_anterior_id: number;
  semestre: CotasGrafSemestreInfo;
}> {
  return apiFetch("/admin/system/cotas-graf/iniciar-novo-semestre", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function importCotasGraficaRapidaXls(
  file: File,
  force = false,
): Promise<ImportGraficaRapidaResult> {
  const form = new FormData();
  form.append("arquivo", file);
  form.append("force", force ? "true" : "false");
  return apiFetch<ImportGraficaRapidaResult>(
    "/admin/system/cotas-graf/importar-grafica-rapida",
    {
      method: "POST",
      body: form,
    },
  );
}

export async function recalcularCotasGrafSemestre(): Promise<RecalcularCotasResult> {
  return apiFetch<RecalcularCotasResult>("/admin/system/cotas-graf/recalcular", {
    method: "POST",
  });
}

export async function fetchPapelariaWorkerQueueAdmin(): Promise<PapelariaAdminWorkerQueueSnapshot> {
  return apiFetch<PapelariaAdminWorkerQueueSnapshot>(
    "/admin/system/papelaria-worker-queue",
  );
}

export async function cancelPapelariaJobAdmin(jobId: number) {
  return apiFetch(`/admin/system/papelaria-jobs/${jobId}/cancel`, {
    method: "POST",
  });
}

export async function movePapelariaJobAdmin(
  jobId: number,
  direction: "up" | "down",
) {
  return apiFetch(`/admin/system/papelaria-jobs/${jobId}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ direction }),
  });
}

export async function fetchEmailTemplatesConfig(): Promise<EmailTemplatesConfigResponse> {
  return apiFetch<EmailTemplatesConfigResponse>("/admin/system/email-templates");
}

export async function saveEmailTemplate(
  templateId: string,
  payload: {
    subject: string;
    html: string;
    use_custom: boolean;
    content_mode: "preset" | "custom";
    preset_id: string;
  },
): Promise<{ template: EmailTemplateRecord }> {
  return apiFetch<{ template: EmailTemplateRecord }>(
    `/admin/system/email-templates/${encodeURIComponent(templateId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export async function resetEmailTemplate(
  templateId: string,
): Promise<{ template: EmailTemplateRecord }> {
  return apiFetch<{ template: EmailTemplateRecord }>(
    `/admin/system/email-templates/${encodeURIComponent(templateId)}/reset`,
    { method: "POST" },
  );
}

export async function saveEmailSendMailboxes(payload: {
  os_lt_5000: string;
  os_gte_5000: string;
  activation: string;
}) {
  return apiFetch<{ send_mailboxes: EmailTemplatesConfigResponse["send_mailboxes"] }>(
    "/admin/system/email-send-mailboxes",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export async function saveGravacaoEmailNotifications(
  payload: GravacaoEmailNotificationSettings,
) {
  return apiFetch<{ gravacao_notifications: GravacaoEmailNotificationSettings }>(
    "/admin/system/email-gravacao-notifications",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export async function uploadEmailTemplatePreset(
  templateId: string,
  file: File,
  options?: { label?: string; apply?: boolean; subject?: string },
): Promise<{
  preset: { id: string; label: string; template_id: string };
  template: EmailTemplateRecord | null;
  storage: string;
}> {
  const fd = new FormData();
  fd.append("file", file);
  if (options?.label?.trim()) {
    fd.append("label", options.label.trim());
  }
  fd.append("apply", options?.apply === false ? "false" : "true");
  if (options?.subject?.trim()) {
    fd.append("subject", options.subject.trim());
  }
  return apiFetch(
    `/admin/system/email-templates/${encodeURIComponent(templateId)}/presets/upload`,
    {
      method: "POST",
      body: fd,
    },
  );
}

export async function deleteEmailTemplatePreset(
  templateId: string,
  presetId: string,
): Promise<{ deleted: string; template: EmailTemplateRecord; storage: string }> {
  return apiFetch(
    `/admin/system/email-templates/${encodeURIComponent(templateId)}/presets/${encodeURIComponent(presetId)}/delete`,
    { method: "POST" },
  );
}

export async function previewEmailTemplate(
  templateId: string,
  payload: {
    subject: string;
    html: string;
    use_custom: boolean;
    content_mode: "preset" | "custom";
    preset_id: string;
  },
): Promise<{ subject: string; html: string; label: string }> {
  return apiFetch<{ subject: string; html: string; label: string }>(
    `/admin/system/email-templates/${encodeURIComponent(templateId)}/preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export async function fetchEmailTemplateModels(params?: {
  grupo?: string;
  variante?: string;
}): Promise<EmailTemplateModelsListResponse> {
  const qs = new URLSearchParams();
  if (params?.grupo) qs.set("grupo", params.grupo);
  if (params?.variante) qs.set("variante", params.variante);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<EmailTemplateModelsListResponse>(
    `/admin/system/email-template-models${suffix}`,
  );
}

export async function createEmailTemplateModel(payload: {
  grupo: string;
  variante: string;
  nome: string;
  assunto: string;
  html: string;
  anexar_pdf?: boolean;
  content_mode?: "custom" | "preset";
  preset_id?: string;
  ordem?: number;
}): Promise<{ model: EmailTemplateModelRecord }> {
  return apiFetch(`/admin/system/email-template-models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateEmailTemplateModel(
  modelId: number,
  payload: Partial<{
    nome: string;
    assunto: string;
    html: string;
    anexar_pdf: boolean;
    content_mode: "custom" | "preset";
    preset_id: string;
    ordem: number;
  }>,
): Promise<{ model: EmailTemplateModelRecord }> {
  return apiFetch(`/admin/system/email-template-models/${modelId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function activateEmailTemplateModel(
  modelId: number,
): Promise<{ model: EmailTemplateModelRecord }> {
  return apiFetch(`/admin/system/email-template-models/${modelId}/activate`, {
    method: "POST",
  });
}

export async function deactivateEmailTemplateModel(
  modelId: number,
): Promise<{ model: EmailTemplateModelRecord }> {
  return apiFetch(`/admin/system/email-template-models/${modelId}/deactivate`, {
    method: "POST",
  });
}

export async function deleteEmailTemplateModel(modelId: number): Promise<{ success: boolean }> {
  return apiFetch(`/admin/system/email-template-models/${modelId}/delete`, {
    method: "POST",
  });
}

export async function previewEmailTemplateModel(
  modelId: number,
): Promise<{ subject: string; html: string; nome: string }> {
  return apiFetch(`/admin/system/email-template-models/${modelId}/preview`, {
    method: "POST",
  });
}

export async function sendTestEmailTemplateModel(
  modelId: number,
  to: string,
): Promise<{ success: boolean; to: string; subject: string; from_mailbox: string }> {
  return apiFetch(`/admin/system/email-template-models/${modelId}/send-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to }),
  });
}

export async function sendTestEmailTemplate(
  templateId: string,
  payload: {
    to: string;
    subject: string;
    html: string;
    use_custom: boolean;
    content_mode: "preset" | "custom";
    preset_id: string;
  },
): Promise<{
  success: boolean;
  to: string;
  subject: string;
  from_mailbox: string;
  label: string;
}> {
  return apiFetch(
    `/admin/system/email-templates/${encodeURIComponent(templateId)}/send-test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export async function fetchPapelariaAdminModelos(): Promise<
  PapelariaAdminModelRecord[]
> {
  return apiFetch<PapelariaAdminModelRecord[]>("/papelaria/admin/modelos");
}

export async function fetchPapelariaAdminModelo(
  modeloId: number,
): Promise<PapelariaAdminModelRecord> {
  return apiFetch<PapelariaAdminModelRecord>(
    `/papelaria/admin/modelos/${modeloId}`,
  );
}

export async function savePapelariaAdminMockupConfig(
  modeloId: number,
  mockupConfigJson: string | null,
): Promise<PapelariaAdminModelRecord> {
  return apiFetch<PapelariaAdminModelRecord>(
    `/papelaria/admin/modelos/${modeloId}/mockup-config`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mockup_config_json: mockupConfigJson }),
    },
  );
}

export async function savePapelariaAdminNomeExibicao(
  modeloId: number,
  nomeExibicao: string | null,
): Promise<PapelariaAdminModelRecord> {
  return apiFetch<PapelariaAdminModelRecord>(
    `/papelaria/admin/modelos/${modeloId}/nome-exibicao`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome_exibicao: nomeExibicao }),
    },
  );
}

export async function deletePapelariaAdminModelo(
  modeloId: number,
): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(
    `/papelaria/admin/modelos/${modeloId}/delete`,
    { method: "POST" },
  );
}

export async function validatePapelariaAdminMockupConfig(
  mockupConfigJson: string | null,
): Promise<{ valid: boolean; message: string }> {
  return apiFetch<{ valid: boolean; message: string }>(
    "/papelaria/admin/modelos/mockup-config/validate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mockup_config_json: mockupConfigJson }),
    },
  );
}

export async function savePapelariaAdminPreviewConfig(
  modeloId: number,
  previewConfigJson: string | null,
): Promise<PapelariaAdminModelRecord> {
  return apiFetch<PapelariaAdminModelRecord>(
    `/papelaria/admin/modelos/${modeloId}/preview-config`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preview_config_json: previewConfigJson }),
    },
  );
}

export async function validatePapelariaAdminPreviewConfig(
  previewConfigJson: string | null,
): Promise<{ valid: boolean; message: string }> {
  return apiFetch<{ valid: boolean; message: string }>(
    "/papelaria/admin/modelos/preview-config/validate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preview_config_json: previewConfigJson }),
    },
  );
}

export async function fetchPapelariaPreviewConfigExample(): Promise<Record<string, unknown>> {
  return apiFetch<Record<string, unknown>>(
    "/papelaria/admin/modelos/preview-config/example",
  );
}

export async function uploadPapelariaPreviewBase(
  modeloId: number,
  faceId: string,
  file: File,
): Promise<{ ok: boolean; face_id: string; filename: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(
    apiUrl(`/papelaria/admin/modelos/${modeloId}/preview-base/${faceId}`),
    {
      method: "POST",
      body: form,
      credentials: "include",
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `Upload falhou (${res.status})`);
  }
  return res.json() as Promise<{ ok: boolean; face_id: string; filename: string }>;
}

export async function fetchPapelariaAdminProdutos(): Promise<{ produtos: string[] }> {
  return apiFetch<{ produtos: string[] }>("/papelaria/admin/produtos");
}

export type PapelariaCdrInspectStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export interface PapelariaCdrInspectResult {
  inspect_id: string;
  filename: string;
  status: PapelariaCdrInspectStatus;
  campos: Record<string, string>;
  variaveis: string[];
  preview_layout?: PapelariaCdrPreviewLayout | null;
  erro?: string | null;
}

export type PapelariaCdrPreviewLayout = {
  canvas: { width: number; height: number };
  pages?: Array<{ page: number; width: number; height: number }>;
  elementos: Array<{
    campo: string;
    page?: number;
    pageWidth?: number;
    pageHeight?: number;
    x: number;
    y: number;
    width: number;
    height: number;
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
    fontStyle?: string;
    color?: string;
    align?: string;
    anchor?: string;
    lineHeight?: number;
  }>;
};

export async function inspectPapelariaCdr(file: File): Promise<PapelariaCdrInspectResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(apiUrl("/papelaria/admin/modelos/inspecionar-cdr"), {
    method: "POST",
    body: form,
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `Inspeção falhou (${res.status})`);
  }
  return res.json() as Promise<PapelariaCdrInspectResult>;
}

export async function fetchPapelariaCdrInspect(
  inspectId: string,
): Promise<PapelariaCdrInspectResult> {
  return apiFetch<PapelariaCdrInspectResult>(
    `/papelaria/admin/modelos/inspecionar-cdr/${encodeURIComponent(inspectId)}`,
  );
}

export interface PapelariaCreateModeloFromCdrResult extends PapelariaAdminModelRecord {
  variaveis_extraidas?: string[];
}

export async function createPapelariaModeloFromCdr(payload: {
  produto: string;
  frenteVerso: string;
  cores: string;
  nomeExibicao?: string;
  inspectId?: string;
  mockupConfigJson?: string;
  previewConfigJson?: string;
  file: File;
}): Promise<PapelariaCreateModeloFromCdrResult> {
  const form = new FormData();
  form.append("produto", payload.produto);
  form.append("frente_verso", payload.frenteVerso);
  form.append("cores", payload.cores);
  if (payload.nomeExibicao) form.append("nome_exibicao", payload.nomeExibicao);
  if (payload.inspectId) form.append("inspect_id", payload.inspectId);
  if (payload.mockupConfigJson) form.append("mockup_config_json", payload.mockupConfigJson);
  if (payload.previewConfigJson) form.append("preview_config_json", payload.previewConfigJson);
  form.append("file", payload.file);

  const res = await fetch(apiUrl("/papelaria/admin/modelos/criar-de-cdr"), {
    method: "POST",
    body: form,
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    let message = text || `Criação falhou (${res.status})`;
    try {
      const payload = JSON.parse(text) as { detail?: unknown };
      if (typeof payload.detail === "string") {
        message = payload.detail;
      }
    } catch {
      // mantém message como texto bruto
    }
    throw new Error(message);
  }
  return res.json() as Promise<PapelariaCreateModeloFromCdrResult>;
}

// --- Catálogo do sistema ---

export async function fetchSystemCatalogCategories(): Promise<SystemCatalogCategoryMeta[]> {
  const data = await apiFetch<{ categories: SystemCatalogCategoryMeta[] }>(
    "/admin/system/catalog/categories",
  );
  return data.categories ?? [];
}

export async function fetchSystemCatalogItems(
  category: SystemCatalogCategoryKey,
): Promise<SystemCatalogListResponse> {
  return apiFetch<SystemCatalogListResponse>(
    `/admin/system/catalog/${encodeURIComponent(category)}`,
  );
}

export async function createSystemCatalogItem(
  category: SystemCatalogCategoryKey,
  payload: { label: string; ordem?: number },
): Promise<{ item: SystemCatalogItemRecord }> {
  return apiFetch(`/admin/system/catalog/${encodeURIComponent(category)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateSystemCatalogItem(
  category: SystemCatalogCategoryKey,
  itemId: number,
  payload: { label?: string; ordem?: number },
): Promise<{ item: SystemCatalogItemRecord }> {
  return apiFetch(
    `/admin/system/catalog/${encodeURIComponent(category)}/${itemId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export async function activateSystemCatalogItem(
  category: SystemCatalogCategoryKey,
  itemId: number,
): Promise<{ item: SystemCatalogItemRecord }> {
  return apiFetch(
    `/admin/system/catalog/${encodeURIComponent(category)}/${itemId}/activate`,
    { method: "POST" },
  );
}

export async function deactivateSystemCatalogItem(
  category: SystemCatalogCategoryKey,
  itemId: number,
): Promise<{ item: SystemCatalogItemRecord }> {
  return apiFetch(
    `/admin/system/catalog/${encodeURIComponent(category)}/${itemId}/deactivate`,
    { method: "POST" },
  );
}

export async function activateSystemCatalogByLabel(
  category: SystemCatalogCategoryKey,
  label: string,
): Promise<{ item: SystemCatalogItemRecord }> {
  return apiFetch(
    `/admin/system/catalog/${encodeURIComponent(category)}/activate-by-label`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    },
  );
}

export async function deactivateSystemCatalogByLabel(
  category: SystemCatalogCategoryKey,
  label: string,
): Promise<{ item: SystemCatalogItemRecord }> {
  return apiFetch(
    `/admin/system/catalog/${encodeURIComponent(category)}/deactivate-by-label`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    },
  );
}

export async function deleteSystemCatalogItem(
  category: SystemCatalogCategoryKey,
  itemId: number,
): Promise<{ success: boolean }> {
  return apiFetch(
    `/admin/system/catalog/${encodeURIComponent(category)}/${itemId}/delete`,
    { method: "POST" },
  );
}

// --- Variações de acabamento ---

export async function fetchAcabamentoVariacoes(
  itemId: number,
): Promise<{ variacoes: SystemCatalogVariacao[] }> {
  return apiFetch(`/admin/system/catalog/acabamento/${itemId}/variacoes`);
}

export async function createAcabamentoVariacao(
  itemId: number,
  payload: { label: string; ordem?: number },
): Promise<{ variacao: SystemCatalogVariacao }> {
  return apiFetch(`/admin/system/catalog/acabamento/${itemId}/variacoes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function activateAcabamentoVariacao(
  itemId: number,
  variacaoId: number,
): Promise<{ variacao: SystemCatalogVariacao }> {
  return apiFetch(
    `/admin/system/catalog/acabamento/${itemId}/variacoes/${variacaoId}/activate`,
    { method: "POST" },
  );
}

export async function deactivateAcabamentoVariacao(
  itemId: number,
  variacaoId: number,
): Promise<{ variacao: SystemCatalogVariacao }> {
  return apiFetch(
    `/admin/system/catalog/acabamento/${itemId}/variacoes/${variacaoId}/deactivate`,
    { method: "POST" },
  );
}

export async function deleteAcabamentoVariacao(
  itemId: number,
  variacaoId: number,
): Promise<{ success: boolean }> {
  return apiFetch(
    `/admin/system/catalog/acabamento/${itemId}/variacoes/${variacaoId}/delete`,
    { method: "POST" },
  );
}

// --- Custos: funções (mão de obra) ---

export async function fetchCustoFuncoes(
  includeInactive = true,
): Promise<CustoFuncaoListResponse> {
  const qs = includeInactive ? "" : "?include_inactive=false";
  return apiFetch<CustoFuncaoListResponse>(`/admin/system/custos/funcoes${qs}`);
}

export async function createCustoFuncao(
  payload: CustoFuncaoCreatePayload,
): Promise<{ item: CustoFuncaoRecord }> {
  return apiFetch("/admin/system/custos/funcoes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateCustoFuncao(
  funcaoId: number,
  payload: CustoFuncaoUpdatePayload,
): Promise<{ item: CustoFuncaoRecord }> {
  return apiFetch(`/admin/system/custos/funcoes/${funcaoId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function activateCustoFuncao(
  funcaoId: number,
): Promise<{ item: CustoFuncaoRecord }> {
  return apiFetch(`/admin/system/custos/funcoes/${funcaoId}/ativar`, {
    method: "POST",
  });
}

export async function deactivateCustoFuncao(
  funcaoId: number,
): Promise<{ item: CustoFuncaoRecord }> {
  return apiFetch(`/admin/system/custos/funcoes/${funcaoId}/desativar`, {
    method: "POST",
  });
}

export async function fetchOrcamentoInsumos(
  includeInactive = true,
): Promise<{ items: OrcamentoInsumoRecord[] }> {
  const qs = includeInactive ? "" : "?include_inactive=false";
  return apiFetch(`/admin/system/orcamento/insumos${qs}`);
}

export async function createOrcamentoInsumo(
  payload: Omit<OrcamentoInsumoRecord, "id" | "preco_unitario">,
): Promise<{ item: OrcamentoInsumoRecord }> {
  return apiFetch("/admin/system/orcamento/insumos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateOrcamentoInsumo(
  id: number,
  payload: Omit<OrcamentoInsumoRecord, "id" | "preco_unitario">,
): Promise<{ item: OrcamentoInsumoRecord }> {
  return apiFetch(`/admin/system/orcamento/insumos/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function setOrcamentoInsumoAtivo(
  id: number,
  ativo: boolean,
): Promise<{ item: OrcamentoInsumoRecord }> {
  const action = ativo ? "ativar" : "desativar";
  return apiFetch(`/admin/system/orcamento/insumos/${id}/${action}`, {
    method: "POST",
  });
}

export async function fetchOrcamentoParametros(): Promise<{
  items: OrcamentoParametroRecord[];
}> {
  return apiFetch("/admin/system/orcamento/parametros");
}

export async function updateOrcamentoParametros(
  valores: Record<string, string>,
): Promise<{ items: OrcamentoParametroRecord[] }> {
  return apiFetch("/admin/system/orcamento/parametros", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ valores }),
  });
}

export async function fetchOrcamentoFormatos(): Promise<{
  items: OrcamentoFormatoRecord[];
}> {
  return apiFetch("/admin/system/orcamento/formatos");
}

export async function updateOrcamentoFormato(
  id: number,
  payload: Partial<OrcamentoFormatoRecord>,
): Promise<{ items: OrcamentoFormatoRecord[] }> {
  return apiFetch(`/admin/system/orcamento/formatos/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchOrcamentoFaixas(): Promise<{
  items: OrcamentoFaixaRecord[];
}> {
  return apiFetch("/admin/system/orcamento/faixas");
}

export async function updateOrcamentoFaixa(
  id: number,
  payload: Partial<OrcamentoFaixaRecord>,
): Promise<{ items: OrcamentoFaixaRecord[] }> {
  return apiFetch(`/admin/system/orcamento/faixas/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function ensureProdutoCatalogItem(
  label: string,
): Promise<{ item: SystemCatalogItemRecord }> {
  return apiFetch("/admin/system/catalog/produto/ensure", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
}

export async function fetchProdutoPassos(
  catalogId: number,
): Promise<ProdutoPassosResponse> {
  return apiFetch(`/admin/system/catalog/produto/${catalogId}/passos`);
}

export async function saveProdutoPassos(
  catalogId: number,
  payload: { rotulo: string; passos: ProdutoPassoRecord[] },
): Promise<{ passos: ProdutoPassoRecord[] }> {
  return apiFetch(`/admin/system/catalog/produto/${catalogId}/passos`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function copyProdutoPassos(
  catalogId: number,
  origemCatalogId: number,
  rotulo: string,
): Promise<{ passos: ProdutoPassoRecord[] }> {
  return apiFetch(`/admin/system/catalog/produto/${catalogId}/passos/copiar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ origem_catalog_id: origemCatalogId, rotulo }),
  });
}

export async function fetchAcabamentoPassos(
  catalogId: number,
): Promise<ProdutoPassosResponse> {
  return apiFetch(`/admin/system/catalog/acabamento/${catalogId}/passos`);
}

export async function saveAcabamentoPassos(
  catalogId: number,
  payload: { rotulo: string; passos: ProdutoPassoRecord[] },
): Promise<{ passos: ProdutoPassoRecord[] }> {
  return apiFetch(`/admin/system/catalog/acabamento/${catalogId}/passos`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function copyAcabamentoPassos(
  catalogId: number,
  origemCatalogId: number,
  rotulo: string,
): Promise<{ passos: ProdutoPassoRecord[] }> {
  return apiFetch(`/admin/system/catalog/acabamento/${catalogId}/passos/copiar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ origem_catalog_id: origemCatalogId, rotulo }),
  });
}

export type OrcamentoPassosPriorsResult = {
  applied: boolean;
  versao: number;
  versao_codigo: number;
  produtos: number;
  acabamentos: number;
};

export async function seedOrcamentoPassosPriors(
  force = true,
): Promise<OrcamentoPassosPriorsResult> {
  return apiFetch("/admin/system/orcamento/passos/priors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force }),
  });
}
