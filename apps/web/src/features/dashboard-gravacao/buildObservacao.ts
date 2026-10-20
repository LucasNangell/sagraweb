import type { GravacaoChapa } from "./types";

export interface ObservacaoChapaBlock {
  fornecedorLabel?: string | null;
  chapas: Array<Pick<GravacaoChapa, "maquina" | "quantidade">>;
}

function chapasLines(
  chapas: Array<Pick<GravacaoChapa, "maquina" | "quantidade">>,
): string[] {
  if (chapas.length === 0) {
    return ["Chapas por máquina:", "- (não informado)"];
  }
  return [
    "Chapas por máquina:",
    ...chapas.map((ch) => {
      const maquina = (ch.maquina || "").trim() || "(sem máquina)";
      return `- ${maquina}: ${ch.quantidade}`;
    }),
  ];
}

export function buildGravacaoObservacao(blocks: ObservacaoChapaBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    const lines: string[] = [];
    const fornecedor = (block.fornecedorLabel ?? "").trim();
    if (fornecedor) {
      lines.push(`[Fornecedor: ${fornecedor}]`);
    }
    lines.push(...chapasLines(block.chapas));
    parts.push(lines.join("\n"));
  }
  return parts.join("\n\n");
}

export function fornecedorSessionLabel(session: {
  fornecedor_nome?: string | null;
  fornecedor_ponto?: string | null;
}): string {
  return (session.fornecedor_nome ?? "").trim() || (session.fornecedor_ponto ?? "").trim();
}
