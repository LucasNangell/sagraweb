import { apiUrl } from "@/lib/api";

export interface ManipularImagemMascara {
  indice: number;
  tipo: string;
  descricao: string;
  cobertura: number;
  modo_limiar: string;
}

export interface ManipularImagemAnalise {
  job_id: string;
  filename: string;
  tem_alpha: boolean;
  largura: number;
  altura: number;
  mascaras: ManipularImagemMascara[];
}

export interface ManipularImagemParams {
  jobId: string;
  mascaraIdx?: number;
  intensidade?: number;
  limiar?: number;
  /** Preview reduz resolução; download deve usar false. */
  preview?: boolean;
}

export interface ManipularImagemResult {
  blob: Blob;
  filename: string;
}

function parseFilenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const utf8 = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1].trim());
    } catch {
      return utf8[1].trim();
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() || null;
}

async function readApiError(res: Response): Promise<Error> {
  const text = await res.text().catch(() => "");
  try {
    const data = JSON.parse(text) as { detail?: string };
    if (typeof data.detail === "string" && data.detail.trim()) {
      return new Error(data.detail);
    }
  } catch {
    // ignore parse
  }
  return new Error(text || `Falha na API (${res.status}).`);
}

export async function analisarManipularImagem(
  file: File,
): Promise<ManipularImagemAnalise> {
  const form = new FormData();
  form.append("file", file, file.name);

  const res = await fetch(apiUrl("/manipular-imagem/analisar"), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: form,
  });

  if (!res.ok) {
    throw await readApiError(res);
  }
  return (await res.json()) as ManipularImagemAnalise;
}

export async function processarManipularImagem(
  params: ManipularImagemParams,
): Promise<ManipularImagemResult> {
  const form = new FormData();
  form.append("job_id", params.jobId);
  form.append("mascara_idx", String(params.mascaraIdx ?? 0));
  form.append("intensidade", String(params.intensidade ?? 100));
  form.append("limiar", String(params.limiar ?? 50));
  form.append("preview", params.preview === false ? "false" : "true");

  const res = await fetch(apiUrl("/manipular-imagem/processar"), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "image/png",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: form,
  });

  if (!res.ok) {
    throw await readApiError(res);
  }

  const blob = await res.blob();
  const filename =
    parseFilenameFromDisposition(res.headers.get("Content-Disposition")) ||
    `imagem_sem_mascara_${params.mascaraIdx ?? 0}.png`;

  return { blob, filename };
}
