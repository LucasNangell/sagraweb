import { apiFetch, apiUrl } from "@/lib/api";
import {
  postFormDataWithProgress,
  putFileWithProgress,
  type UploadProgressCallback,
} from "@/lib/uploadWithProgress";

import { fetchClientUploadMode } from "@/api/client-portal";

export interface OsArquivosPortalInfo {
  exists?: boolean;
  osTitulo?: string;
  osProduto?: string;
  titulo?: string;
  solicitante?: string;
  portalComplete?: boolean;
}

export type OsArquivosUploadResult = {
  status: string;
  files?: string[];
  folder?: string;
  portalComplete?: boolean;
};

function reportProgress(
  onProgress: UploadProgressCallback | undefined,
  pct: number,
  label?: string,
) {
  onProgress?.(Math.min(100, Math.max(0, Math.round(pct))), label);
}

async function clientOsArquivosFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), init);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    try {
      const data = JSON.parse(text) as { detail?: string };
      if (typeof data.detail === "string" && data.detail.trim()) {
        throw new Error(data.detail);
      }
    } catch (parseErr) {
      if (parseErr instanceof Error && !parseErr.message.startsWith("API ")) {
        throw parseErr;
      }
    }
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchOsArquivosPortal(
  ano: number,
  osId: number,
  token: string,
): Promise<OsArquivosPortalInfo> {
  const params = new URLSearchParams({ token });
  return clientOsArquivosFetch<OsArquivosPortalInfo>(
    `/client/os-arquivos/${ano}/${osId}?${params}`,
  );
}

export async function sendOsArquivosClientEmail(
  ano: number,
  osId: number,
  email: string,
): Promise<{ status: string; url?: string; message?: string }> {
  return apiFetch(`/os/${ano}/${osId}/arquivos/enviar-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

export async function fetchGerenciaSettings(): Promise<{
  os_arquivos_client_email_enabled: boolean;
}> {
  return apiFetch("/gerencia/settings");
}

export async function finalizeOsArquivosInterno(
  ano: number,
  osId: number,
  files: File[],
  ponto: string,
  onProgress?: UploadProgressCallback,
): Promise<OsArquivosUploadResult> {
  const fd = new FormData();
  fd.append("ponto", ponto);
  for (const file of files) {
    fd.append("files", file);
  }
  return postFormDataWithProgress<OsArquivosUploadResult>(
    apiUrl(`/os/${ano}/${osId}/arquivos/finalizar-interno`),
    fd,
    {
      withCredentials: true,
      onProgress: (pct) => reportProgress(onProgress, pct, "Enviando arquivos…"),
    },
  );
}

async function clientOsUploadViaGdrive(params: {
  osId: number;
  ano: number;
  ponto: string;
  token: string;
  files: File[];
  onProgress?: UploadProgressCallback;
}): Promise<OsArquivosUploadResult> {
  reportProgress(params.onProgress, 2, "Preparando envio…");
  const session = await clientOsArquivosFetch<{
    uploads: Array<{
      name: string;
      staging_name: string;
      upload_url: string;
      mime: string;
    }>;
  }>("/client/os-arquivos/upload-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      os_id: params.osId,
      ano: params.ano,
      ponto: params.ponto,
      token: params.token,
      componente: "Arquivos",
      files: params.files.map((f) => ({
        name: f.name,
        size: f.size,
        mime: f.type || "application/octet-stream",
      })),
    }),
  });

  const byName = new Map(params.files.map((f) => [f.name, f]));
  const completed: Array<{ name: string; drive_file_id: string }> = [];
  const totalBytes = Math.max(
    1,
    params.files.reduce((sum, f) => sum + f.size, 0),
  );
  let doneBytes = 0;

  for (const slot of session.uploads) {
    const file = byName.get(slot.name);
    if (!file) {
      throw new Error(`Arquivo não encontrado na sessão: ${slot.name}`);
    }
    const data = await putFileWithProgress(
      slot.upload_url,
      file,
      slot.mime || file.type || "application/octet-stream",
      (filePct) => {
        const loaded = doneBytes + (file.size * filePct) / 100;
        reportProgress(
          params.onProgress,
          8 + (loaded / totalBytes) * 82,
          file.name,
        );
      },
    );
    if (!data.id) {
      throw new Error("Google Drive não retornou identificador do arquivo.");
    }
    doneBytes += file.size;
    completed.push({ name: slot.name, drive_file_id: data.id });
  }

  reportProgress(params.onProgress, 92, "Finalizando…");
  const result = await clientOsArquivosFetch<OsArquivosUploadResult>(
    "/client/os-arquivos/upload-complete",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        os_id: params.osId,
        ano: params.ano,
        ponto: params.ponto,
        token: params.token,
        componente: "Arquivos",
        files: completed,
      }),
    },
  );
  reportProgress(params.onProgress, 100, "Concluído");
  return result;
}

export async function clientOsArquivosUploadSmart(params: {
  osId: number;
  ano: number;
  ponto: string;
  token: string;
  files: File[];
  onProgress?: UploadProgressCallback;
}): Promise<OsArquivosUploadResult> {
  const mode = await fetchClientUploadMode();
  if (mode === "gdrive") {
    try {
      return await clientOsUploadViaGdrive(params);
    } catch (err) {
      console.warn("Upload Drive (OS arquivos) falhou; tentando servidor:", err);
    }
  }

  const fd = new FormData();
  fd.append("os_id", String(params.osId));
  fd.append("ano", String(params.ano));
  fd.append("ponto", params.ponto);
  fd.append("token", params.token);
  for (const file of params.files) {
    fd.append("files", file);
  }

  const data = await postFormDataWithProgress<OsArquivosUploadResult>(
    apiUrl("/client/os-arquivos/upload-files"),
    fd,
    {
      onProgress: (pct) =>
        reportProgress(params.onProgress, pct, "Enviando arquivos…"),
    },
  );
  reportProgress(params.onProgress, 100, "Concluído");
  return { ...data, portalComplete: true };
}
