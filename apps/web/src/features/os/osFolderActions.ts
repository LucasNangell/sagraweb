import { fetchOsPath } from "@/api/os";
import { tryOpenFolderLocally } from "@/lib/sagraLocalOpener";

export async function openNetworkFolder(
  row: { ano: number; nr_os: number },
  fetchPath: (input: { ano: number; id: number }) => Promise<{ path: string }> = (
    input,
  ) => fetchOsPath(input.ano, input.id),
): Promise<void> {
  try {
    const { path } = await fetchPath({ ano: row.ano, id: row.nr_os });
    const lower = path.toLowerCase();
    const pathUsable =
      Boolean(path) &&
      !lower.includes("não encontrada") &&
      !lower.startsWith("erro");

    if (pathUsable) {
      const viaLocal = await tryOpenFolderLocally(path);
      if (viaLocal) {
        return;
      }
      await copyToClipboard(path);
    }

    window.dispatchEvent(new CustomEvent("sagra:os-folder-browser"));
  } catch (e) {
    console.error("Erro ao obter pasta da OS:", e);
    window.dispatchEvent(new CustomEvent("sagra:os-folder-browser"));
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
