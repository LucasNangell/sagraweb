import type { PapelariaAdminModelRecord } from "@/features/configuracoes/types";

export type PapelariaProdutoGroup = {
  produto: string;
  modelos: PapelariaAdminModelRecord[];
  comMockup: number;
  comPreview: number;
};

export function groupPapelariaModelosByProduto(
  modelos: PapelariaAdminModelRecord[],
): PapelariaProdutoGroup[] {
  const map = new Map<string, PapelariaAdminModelRecord[]>();
  for (const modelo of modelos) {
    const produto = (modelo.produto || "").trim() || "(sem produto)";
    const list = map.get(produto) ?? [];
    list.push(modelo);
    map.set(produto, list);
  }

  const groups: PapelariaProdutoGroup[] = [];
  for (const [produto, list] of map) {
    list.sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || a.id - b.id);
    groups.push({
      produto,
      modelos: list,
      comMockup: list.filter((m) => m.tem_mockup_config).length,
      comPreview: list.filter((m) => m.tem_preview_config).length,
    });
  }

  groups.sort((a, b) => a.produto.localeCompare(b.produto, "pt-BR"));
  return groups;
}
