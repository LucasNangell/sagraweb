import { apiFetch, apiUrl } from "@/lib/api";

export interface BoxModelPanel {
  id: string;
  polygonMm: number[][];
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  areaMm2?: number;
  role?: string;
  label?: string;
  active?: boolean;
  u0?: number;
  v0?: number;
  u1?: number;
  v1?: number;
}

export interface BoxModelHinge {
  id: string;
  panelA: string;
  panelB: string;
  axis: "vertical" | "horizontal" | string;
  positionMm: number;
  spanStartMm: number;
  spanEndMm: number;
  active?: boolean;
  kind?: "cut" | "fold" | string;
}

export interface BoxModelEdge {
  id: string;
  kind: "cut" | "fold";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  hingeId?: string | null;
  source?: string;
}

export interface BoxModelOperation {
  id: string;
  hingeId: string;
  panelId: string;
  order: number;
  movingSide: "negative" | "positive";
  towards: "front" | "back";
  targetAngleDeg: number;
  phaseId?: string;
}

export interface BoxModelConfig {
  version: number;
  pageWidthMm: number;
  pageHeightMm: number;
  cutBboxMm: {
    x0Mm: number;
    y0Mm: number;
    x1Mm: number;
    y1Mm: number;
    widthMm: number;
    heightMm: number;
  };
  panels: BoxModelPanel[];
  hinges: BoxModelHinge[];
  operations: BoxModelOperation[];
  edges?: BoxModelEdge[];
  basePanelId: string | null;
  verticalCreasesMm?: number[];
  horizontalCreasesMm?: number[];
  foldSegmentsMm?: Array<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }>;
  cutSegmentsMm?: Array<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }>;
  dimsHint?: Record<string, unknown>;
}

export interface ProvaWebBoxModel {
  id: number;
  nome: string;
  hint: string;
  ativo: boolean;
  ordem: number;
  config: BoxModelConfig;
  facaFileName?: string | null;
  facaSha256?: string | null;
  hasFacaPdf?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  updatedByPonto?: string | null;
}

export async function fetchAdminBoxModels(opts?: {
  ativoOnly?: boolean;
}): Promise<ProvaWebBoxModel[]> {
  const q = new URLSearchParams();
  if (opts?.ativoOnly) q.set("ativo", "true");
  const suffix = q.toString() ? `?${q}` : "";
  const data = await apiFetch<{ models: ProvaWebBoxModel[] }>(
    `/admin/system/prova-web/box-models${suffix}`,
  );
  return data.models ?? [];
}

export async function fetchAdminBoxModel(
  id: number,
): Promise<ProvaWebBoxModel> {
  const data = await apiFetch<{ model: ProvaWebBoxModel }>(
    `/admin/system/prova-web/box-models/${id}`,
  );
  return data.model;
}

export function adminBoxModelFacaUrl(id: number): string {
  return apiUrl(`/admin/system/prova-web/box-models/${id}/faca.pdf`);
}

export async function parseAdminBoxFaca(
  file: File,
  page = 0,
): Promise<{ config: BoxModelConfig; fileName: string }> {
  const form = new FormData();
  form.append("arquivo", file);
  form.append("page", String(page));
  return apiFetch(`/admin/system/prova-web/box-models/parse-faca`, {
    method: "POST",
    body: form,
  });
}

export async function createAdminBoxModel(payload: {
  nome: string;
  hint?: string;
  ordem?: number;
  config: BoxModelConfig;
  file?: File | null;
}): Promise<ProvaWebBoxModel> {
  const form = new FormData();
  form.append("nome", payload.nome);
  form.append("hint", payload.hint ?? "");
  form.append("ordem", String(payload.ordem ?? 0));
  form.append("config_json", JSON.stringify(payload.config));
  if (payload.file) form.append("arquivo", payload.file);
  const data = await apiFetch<{ model: ProvaWebBoxModel }>(
    `/admin/system/prova-web/box-models`,
    { method: "POST", body: form },
  );
  return data.model;
}

export async function updateAdminBoxModel(
  id: number,
  payload: {
    nome?: string;
    hint?: string;
    ativo?: boolean;
    ordem?: number;
    config?: BoxModelConfig;
  },
): Promise<ProvaWebBoxModel> {
  const data = await apiFetch<{ model: ProvaWebBoxModel }>(
    `/admin/system/prova-web/box-models/${id}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  return data.model;
}

export async function deleteAdminBoxModel(id: number): Promise<void> {
  await apiFetch(`/admin/system/prova-web/box-models/${id}`, {
    method: "DELETE",
  });
}

export async function fetchProvaWebBoxModels(): Promise<ProvaWebBoxModel[]> {
  const data = await apiFetch<{ models: ProvaWebBoxModel[] }>(
    `/prova-web/box-models?ativo=true`,
  );
  return data.models ?? [];
}

export async function fetchProvaWebBoxModel(
  id: number,
): Promise<ProvaWebBoxModel> {
  const data = await apiFetch<{ model: ProvaWebBoxModel }>(
    `/prova-web/box-models/${id}`,
  );
  return data.model;
}
