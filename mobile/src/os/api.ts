import { apiFetch, apiUploadFormData } from "@/lib/http";

export interface FaceVerifyResult {
  ponto: number;
  nome: string;
  score: number;
  face_token: string;
}

export interface PontoLookupResult {
  ponto: number;
  exists: boolean;
  nome: string;
  has_face: boolean;
}

export interface PontoRegisterResult {
  ponto: number;
  nome: string;
  face_token: string;
  created: boolean;
  face_enrolled: boolean;
}

export interface OsDetails {
  Titulo?: string | null;
  TipoPublicacaoLink?: string | null;
  CategoriaLink?: string | null;
  Produto?: string | null;
  Formato?: string | null;
  Tiragem?: number | null;
  Paginas?: number | null;
  Solicitante?: string | null;
  Setor?: string | null;
  Situacao?: string | null;
  Prioridade?: string | null;
  DataEntrega?: string | null;
  Observacao?: string | null;
  [key: string]: unknown;
}

export async function fetchOsDetails(
  ano: number,
  id: number,
): Promise<OsDetails> {
  return apiFetch<OsDetails>(`/os/${ano}/${id}/details`);
}

export async function verifyTabletFace(
  blob: Blob,
  osAno: number,
  osId: number,
): Promise<FaceVerifyResult> {
  const form = new FormData();
  const file = new File([blob], "capture.jpg", { type: "image/jpeg" });
  form.append("file", file, "capture.jpg");
  form.append("os_ano", String(osAno));
  form.append("os_id", String(osId));
  return apiUploadFormData<FaceVerifyResult>("/tablet/face/verify", form);
}

export async function lookupTabletPonto(
  ponto: number,
): Promise<PontoLookupResult> {
  return apiFetch<PontoLookupResult>(`/tablet/ponto/${ponto}`);
}

export async function registerTabletPonto(params: {
  ponto: number;
  nome: string;
  osAno: number;
  osId: number;
  image: Blob;
}): Promise<PontoRegisterResult> {
  const form = new FormData();
  const file = new File([params.image], "capture.jpg", { type: "image/jpeg" });
  form.append("file", file, "capture.jpg");
  form.append("ponto", String(params.ponto));
  form.append("nome", params.nome.trim());
  form.append("os_ano", String(params.osAno));
  form.append("os_id", String(params.osId));
  return apiUploadFormData<PontoRegisterResult>("/tablet/ponto/register", form);
}

export interface HistoryPayload {
  situacao: string;
  setor: string;
  obs: string;
  usuario: string;
  face_token?: string;
  from_tablet?: boolean;
  confirm_main_os_target?: boolean;
}

export async function addOsHistory(
  ano: number,
  id: number,
  payload: HistoryPayload,
): Promise<{ new_id: string }> {
  return apiFetch<{ new_id: string }>(`/os/${ano}/${id}/history`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
