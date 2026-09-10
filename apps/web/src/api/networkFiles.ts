import { apiFetch, apiUrl } from "@/lib/api";

export interface NetworkBrowseEntry {
  name: string;
  type: "dir" | "file";
  size?: number | null;
  /** Caminho UNC completo (apenas nas raízes de navegação). */
  path?: string;
}

export interface NetworkBrowseResponse {
  root_path: string;
  relative: string;
  current_path: string;
  entries: NetworkBrowseEntry[];
}

export async function fetchNetworkBrowse(relative = ""): Promise<NetworkBrowseResponse> {
  const params = new URLSearchParams();
  if (relative.trim()) {
    params.set("relative", relative.trim());
  }
  const qs = params.toString();
  return apiFetch<NetworkBrowseResponse>(`/files/network-browse${qs ? `?${qs}` : ""}`);
}

export interface NetworkFilePick {
  absolute_path: string;
  nome: string;
  maquina?: string;
}

export interface NetworkFileInspection {
  absolute_path: string;
  nome: string;
  type: "pdf" | "tif" | "other";
  status: "done" | "unsupported" | "error";
  preview_mime: string | null;
  graphics_status?: "with_graphics" | "blank_graphics" | "inconclusive" | "error";
  blank_graphics: boolean | null;
  reason?: string;
  width?: number;
  height?: number;
  ink_fraction?: number;
  active_rows_fraction?: number;
  maquina?: string;
  cor?: string;
  inspection_token?: string;
  feedback_revision?: number;
  detection_source?: "heuristic" | "feedback" | "knn";
  learning_status?: "awaiting_context" | "collecting" | "active" | "corrected" | "unavailable";
  training_samples?: number;
}

export interface GraphicsFeedbackInput {
  absolute_path: string;
  maquina: string;
  blank_graphics: boolean;
  inspection_token: string;
  feedback_revision: number;
}

export async function correctNetworkGraphics(
  feedback: GraphicsFeedbackInput,
): Promise<NetworkFileInspection> {
  return apiFetch<NetworkFileInspection>("/files/network-graphics-feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(feedback),
  });
}

export interface NetworkFilesInspectionResponse {
  files: NetworkFileInspection[];
}

export interface NetworkInspectionOptions {
  signal?: AbortSignal;
  onProgress?: (result: NetworkFilesInspectionResponse) => void;
}

export async function inspectNetworkFiles(
  files: NetworkFilePick[],
  options: NetworkInspectionOptions = {},
): Promise<NetworkFilesInspectionResponse> {
  // Requisições curtas: dois arquivos em voo, resultado individual imediato.
  const unique = [...new Map(files.map(file => [
    JSON.stringify([file.absolute_path, file.maquina?.trim().toUpperCase() || ""]), file,
  ])).values()];
  const results: NetworkFileInspection[] = [];
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  let next = 0;
  const checkCancelled = () => {
    if (controller.signal.aborted) throw new DOMException("Verificação cancelada.", "AbortError");
  };
  const worker = async () => {
    while (next < unique.length) {
      checkCancelled();
      const file = unique[next++];
      const response = await apiFetch<NetworkFilesInspectionResponse>("/files/network-inspect", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: [file] }),
      });
      checkCancelled();
      if (response.files.length !== 1 || response.files[0]?.absolute_path !== file?.absolute_path) {
        throw new Error("Resposta de inspeção incompatível com o arquivo solicitado.");
      }
      results.push(...response.files);
      options.onProgress?.({ files: [...results] });
    }
  };
  try {
    checkCancelled();
    options.onProgress?.({ files: [] });
    await Promise.all([worker(), worker()]);
    return { files: results };
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", cancel);
  }
}

export async function loadNetworkFilePreviewBlobUrl(
  file: NetworkFilePick,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(apiUrl("/files/network-preview"), {
    method: "POST",
    credentials: "include",
    signal,
    headers: {
      Accept: file.nome.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/png",
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify(file),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Não foi possível carregar o preview (${res.status}).`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
