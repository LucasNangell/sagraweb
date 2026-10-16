import type { PcpQueueFornecedor, PcpQueueItem } from "@/api/pcp";

const SETOR_GRAV_EXTERNA = "Grav. Externa";
const SITUACAO_GRAV_CONCLUIDA = "Gravação Ext. Concluída";

export function fornecedorBadgeLabel(
  item: Pick<PcpQueueFornecedor, "ponto" | "nome">,
): string {
  return item.nome?.trim() || item.ponto?.trim() || "";
}

function osEligibleForFornecedorBadge(os: PcpQueueItem): boolean {
  const setor = (os.setor ?? "").trim();
  const situacao = (os.situacao ?? "").trim();
  return setor === SETOR_GRAV_EXTERNA || situacao === SITUACAO_GRAV_CONCLUIDA;
}

/** Labels distintos do fornecedor no card do tablet (Grav. Externa / Ext. Concluída). */
export function resolveOsFornecedorBadges(os: PcpQueueItem): string[] {
  if (!osEligibleForFornecedorBadge(os)) {
    return [];
  }
  const fromList = (os.fornecedores ?? [])
    .map((f) => fornecedorBadgeLabel(f))
    .filter(Boolean);
  if (fromList.length > 0) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const label of fromList) {
      if (seen.has(label)) continue;
      seen.add(label);
      out.push(label);
    }
    return out;
  }
  const single = fornecedorBadgeLabel({
    ponto: os.fornecedor_ponto,
    nome: os.fornecedor_nome,
  });
  return single ? [single] : [];
}
