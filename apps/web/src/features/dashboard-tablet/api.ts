import { apiFetch, apiUrl } from "@/lib/api";

export interface FaceVerifyResult {
  ponto: number;
  nome: string;
  score: number;
  face_token: string;
}

export interface FaceStatusResult {
  ponto: number;
  has_face: boolean;
  active: boolean;
  updated_at?: string;
}

export async function verifyTabletFace(
  blob: Blob,
  osAno: number,
  osId: number,
): Promise<FaceVerifyResult> {
  const form = new FormData();
  form.append("file", blob, "capture.jpg");
  form.append("os_ano", String(osAno));
  form.append("os_id", String(osId));
  const res = await fetch(apiUrl("/tablet/face/verify"), {
    method: "POST",
    body: form,
    credentials: "include",
  });
  if (!res.ok) {
    let detail = "Falha no reconhecimento facial.";
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as FaceVerifyResult;
}

export interface PontoVerifyResult {
  ponto: number;
  nome: string;
  face_token: string;
}

export async function verifyTabletPonto(
  ponto: number,
  osAno: number,
  osId: number,
): Promise<PontoVerifyResult> {
  return apiFetch<PontoVerifyResult>("/tablet/ponto/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ponto, os_ano: osAno, os_id: osId }),
  });
}

export interface PontoLookupResult {
  ponto: number;
  exists: boolean;
  nome: string;
  has_face: boolean;
}

export async function lookupTabletPonto(ponto: number): Promise<PontoLookupResult> {
  return apiFetch<PontoLookupResult>(`/tablet/ponto/${ponto}`);
}

export interface PontoRegisterResult {
  ponto: number;
  nome: string;
  face_token: string;
  created: boolean;
  face_enrolled: boolean;
}

export async function registerTabletPonto(params: {
  ponto: number;
  nome: string;
  osAno: number;
  osId: number;
  image: Blob;
}): Promise<PontoRegisterResult> {
  const form = new FormData();
  form.append("file", params.image, "capture.jpg");
  form.append("ponto", String(params.ponto));
  form.append("nome", params.nome.trim());
  form.append("os_ano", String(params.osAno));
  form.append("os_id", String(params.osId));
  const res = await fetch(apiUrl("/tablet/ponto/register"), {
    method: "POST",
    body: form,
    credentials: "include",
  });
  if (!res.ok) {
    let detail = "Falha ao cadastrar operador/face.";
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = typeof body.detail === "string" ? body.detail : detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as PontoRegisterResult;
}

export async function fetchUserFaceStatus(ponto: number): Promise<FaceStatusResult> {
  return apiFetch<FaceStatusResult>(`/admin/users/${ponto}/face`);
}

export async function enrollUserFace(
  ponto: number,
  file: File,
): Promise<FaceStatusResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(apiUrl(`/admin/users/${ponto}/face`), {
    method: "POST",
    body: form,
    credentials: "include",
  });
  if (!res.ok) {
    let detail = "Falha ao cadastrar foto facial.";
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as FaceStatusResult;
}

export async function deleteUserFace(ponto: number): Promise<void> {
  await apiFetch(`/admin/users/${ponto}/face`, { method: "DELETE" });
}
