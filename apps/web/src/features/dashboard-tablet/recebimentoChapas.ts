export interface ChapasPorMaquina {
  maquina: string;
  quantidade: number;
}

export function isRecebimentoChapasTabletCard(item: {
  situacao?: string | null;
  setor?: string | null;
}): boolean {
  return (
    (item.situacao ?? "").trim() === "Aguard. Retirada" &&
    (item.setor ?? "").trim() === "SEFOC"
  );
}

function chapasLines(chapas: ChapasPorMaquina[]): string[] {
  if (chapas.length === 0) {
    return ["- (não informado)"];
  }
  return chapas.map((ch) => {
    const maquina = (ch.maquina || "").trim() || "(sem máquina)";
    return `- ${maquina}: ${ch.quantidade}`;
  });
}

/** Texto exibido na confirmação do tablet. */
export function formatRecebimentoChapasConfirmText(
  chapas: ChapasPorMaquina[],
): string {
  return ["Confirma o recebimento de:", "", "Chapas por máquina:", ...chapasLines(chapas)].join(
    "\n",
  );
}

/**
 * Preview da observação gravada pelo backend (`format_gravacao_entrega_obs`).
 * A hora (`HHhMM`) é acrescentada no servidor em `format_andamento_obs`.
 */
export function formatRecebimentoChapasObsPreview(
  chapas: ChapasPorMaquina[],
): string {
  return ["Entrega de chapas.", "", "Chapas por máquina:", ...chapasLines(chapas)].join(
    "\n",
  );
}
