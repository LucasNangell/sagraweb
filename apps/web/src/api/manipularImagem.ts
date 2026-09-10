import { apiUrl } from "@/lib/api";

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

export async function processarManipularImagem(
  file: File,
): Promise<ManipularImagemResult> {
  const form = new FormData();
  form.append("file", file, file.name);

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
    const text = await res.text().catch(() => "");
    try {
      const data = JSON.parse(text) as { detail?: string };
      if (typeof data.detail === "string" && data.detail.trim()) {
        throw new Error(data.detail);
      }
    } catch (err) {
      if (err instanceof Error && !(err instanceof SyntaxError)) {
        throw err;
      }
    }
    throw new Error(text || `Falha ao processar imagem (${res.status}).`);
  }

  const blob = await res.blob();
  const filename =
    parseFilenameFromDisposition(res.headers.get("Content-Disposition")) ||
    `${file.name.replace(/\.[^.]+$/, "") || "imagem"}_sem_mascara_0.png`;

  return { blob, filename };
}
