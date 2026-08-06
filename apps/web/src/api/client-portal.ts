import { apiUrl } from "@/lib/api";

export interface ClientAnalysisItem {
  uniqueId: number;
  originalId?: number;
  obs?: string;
  html?: string;
  componenteOrigem?: string;
  titulo?: string;
  desconsiderado?: boolean;
  resolver?: boolean;
  resolucaoObrigatoria?: boolean;
}

export interface ClientAnalysisResponse {
  exists?: boolean;
  items: ClientAnalysisItem[];
  componente?: string;
  titulo?: string;
  osTitulo?: string;
  osProduto?: string;
  versao?: string;
  versaoLabel?: string;
  relatorioHtml?: string | null;
  relatorioEmail?: string | null;
  /** Componentes com arquivo já enviado pelo cliente (andamento). */
  componentesEnviados?: string[];
  /** Todos os componentes pendentes já receberam arquivo (ou não há pendências). */
  portalComplete?: boolean;
}

export function clientReportPdfUrl(
  ano: number,
  osId: number,
  token: string,
): string {
  const params = new URLSearchParams({ token });
  return apiUrl(`/client/report/${ano}/${osId}?${params}`);
}

/** API pública do portal — sem cookie de sessão. */
async function clientApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
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

function normalizeClientItems(items: ClientAnalysisItem[]): ClientAnalysisItem[] {
  const truthy = (v: unknown) => {
    if (v === true || v === 1) return true;
    if (v === false || v === 0 || v == null) return false;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      return s === "1" || s === "true";
    }
    return Boolean(v);
  };
  return items.map((item) => ({
    ...item,
    desconsiderado: truthy(item.desconsiderado),
    resolver: truthy(item.resolver),
    resolucaoObrigatoria: truthy(item.resolucaoObrigatoria),
  }));
}

export async function fetchClientAnalysis(
  ano: number,
  osId: number,
  token: string,
): Promise<ClientAnalysisResponse> {
  const params = new URLSearchParams({ token });
  const data = await clientApiFetch<ClientAnalysisResponse>(
    `/analise/client/${ano}/${osId}?${params}`,
  );
  return {
    ...data,
    items: normalizeClientItems(data.items ?? []),
  };
}

export async function clientDesconsiderarItem(body: {
  id_item: number;
  nome_cliente: string;
  ponto: string;
  os_id: number;
  ano: number;
}): Promise<{ moved?: boolean }> {
  return clientApiFetch("/client/desconsiderar-item", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type ClientUploadResult = {
  status: string;
  files?: string[];
  folder?: string;
  item_titulo?: string;
  componente?: string | null;
  componentesEnviados?: string[];
  portalComplete?: boolean;
};

let uploadModeCache: "gdrive" | "server" | null = null;

export async function fetchClientUploadMode(): Promise<"gdrive" | "server"> {
  if (uploadModeCache) return uploadModeCache;
  try {
    const data = await clientApiFetch<{ mode?: string }>("/client/upload-mode");
    uploadModeCache = data.mode === "gdrive" ? "gdrive" : "server";
  } catch {
    uploadModeCache = "server";
  }
  return uploadModeCache;
}

async function putFileToGoogleResumable(
  uploadUrl: string,
  file: File,
  mime: string,
): Promise<string> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mime || file.type || "application/octet-stream",
      "Content-Length": String(file.size),
    },
    body: file,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Falha ao enviar ao Google Drive: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) {
    throw new Error("Google Drive não retornou identificador do arquivo.");
  }
  return data.id;
}

export async function clientUploadFilesViaGdrive(params: {
  osId: number;
  ano: number;
  ponto: string;
  token: string;
  componente: string;
  files: File[];
}): Promise<ClientUploadResult> {
  const session = await clientApiFetch<{
    uploads: Array<{
      name: string;
      staging_name: string;
      upload_url: string;
      mime: string;
    }>;
  }>("/client/upload-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      os_id: params.osId,
      ano: params.ano,
      ponto: params.ponto,
      token: params.token,
      componente: params.componente,
      files: params.files.map((f) => ({
        name: f.name,
        size: f.size,
        mime: f.type || "application/octet-stream",
      })),
    }),
  });

  const byName = new Map(params.files.map((f) => [f.name, f]));
  const completed: Array<{ name: string; drive_file_id: string }> = [];

  for (const slot of session.uploads) {
    const file = byName.get(slot.name);
    if (!file) {
      throw new Error(`Arquivo não encontrado na sessão: ${slot.name}`);
    }
    const driveId = await putFileToGoogleResumable(
      slot.upload_url,
      file,
      slot.mime,
    );
    completed.push({ name: slot.name, drive_file_id: driveId });
  }

  return clientApiFetch<ClientUploadResult>("/client/upload-complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      os_id: params.osId,
      ano: params.ano,
      ponto: params.ponto,
      token: params.token,
      componente: params.componente,
      files: completed,
    }),
  });
}

export async function clientUploadFiles(form: FormData): Promise<ClientUploadResult> {
  const res = await fetch(apiUrl("/client/upload-files"), {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    try {
      const data = JSON.parse(text) as { detail?: string };
      if (typeof data.detail === "string") throw new Error(data.detail);
    } catch (e) {
      if (e instanceof Error && !e.message.startsWith("API ")) throw e;
    }
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<ClientUploadResult>;
}

/** Upload do portal: Drive direto (sem banda zrok) ou multipart legado. */
export async function clientUploadFilesSmart(params: {
  osId: number;
  ano: number;
  ponto: string;
  token: string;
  componente: string;
  files: File[];
}): Promise<ClientUploadResult> {
  const mode = await fetchClientUploadMode();
  if (mode === "gdrive") {
    try {
      return await clientUploadFilesViaGdrive(params);
    } catch (err) {
      console.warn("Upload Drive falhou; tentando envio direto ao servidor:", err);
    }
  }
  const fd = new FormData();
  fd.append("os_id", String(params.osId));
  fd.append("ano", String(params.ano));
  fd.append("ponto", params.ponto);
  fd.append("token", params.token);
  fd.append("componente", params.componente);
  fd.append(
    "componentes",
    JSON.stringify({ [params.componente]: params.files.map((f) => f.name) }),
  );
  for (const file of params.files) {
    fd.append("files", file);
  }
  return clientUploadFiles(fd);
}
