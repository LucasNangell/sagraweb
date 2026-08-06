import { apiFetch } from "@/lib/api";

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
}
