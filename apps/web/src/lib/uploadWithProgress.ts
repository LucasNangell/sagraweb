export type UploadProgressCallback = (pct: number, label?: string) => void;

function parseApiError(status: number, text: string): Error {
  try {
    const data = JSON.parse(text) as { detail?: string };
    if (typeof data.detail === "string" && data.detail.trim()) {
      return new Error(data.detail);
    }
  } catch {
    /* ignore */
  }
  const snippet = text.replace(/\s+/g, " ").trim().slice(0, 200);
  return new Error(`API ${status}: ${snippet}`);
}

export function postFormDataWithProgress<T>(
  url: string,
  formData: FormData,
  options?: {
    withCredentials?: boolean;
    onProgress?: UploadProgressCallback;
  },
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = options?.withCredentials ?? false;
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && options?.onProgress) {
        const pct = Math.min(100, Math.round((e.loaded / e.total) * 100));
        options.onProgress(pct);
      }
    };
    xhr.onload = () => {
      const text = xhr.responseText || "";
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(text) as T);
        } catch {
          reject(new Error("Resposta inválida da API."));
        }
        return;
      }
      reject(parseApiError(xhr.status, text));
    };
    xhr.onerror = () => reject(new Error("Falha de rede ao enviar arquivos."));
    xhr.onabort = () => reject(new Error("Envio cancelado."));
    xhr.send(formData);
  });
}

export function putFileWithProgress(
  url: string,
  file: File,
  mime: string,
  onFileProgress?: (pct: number) => void,
): Promise<{ id?: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader(
      "Content-Type",
      mime || file.type || "application/octet-stream",
    );
    xhr.setRequestHeader("Content-Length", String(file.size));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onFileProgress) {
        onFileProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
      }
    };
    xhr.onload = () => {
      const text = xhr.responseText || "";
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(text) as { id?: string });
        } catch {
          reject(new Error("Google Drive não retornou resposta válida."));
        }
        return;
      }
      reject(
        new Error(`Falha ao enviar ao Google Drive: ${text.slice(0, 200)}`),
      );
    };
    xhr.onerror = () =>
      reject(new Error("Falha de rede ao enviar ao Google Drive."));
    xhr.send(file);
  });
}
