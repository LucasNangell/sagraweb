import type { ProblemaPadrao } from "@/features/analise/types";

import type { AnaliseLabItemEscopo } from "@/api/analiseLab";

import { toBalloonHtml } from "./analiseLabBalloonHtml";
import type { AnaliseLabItemPanelModel } from "./AnaliseLabItemPanel";

export function buildLibraryDraft(args: {
  problema: ProblemaPadrao;
  escopo: AnaliseLabItemEscopo;
  pagina: number;
  pageSpec: string;
  componente?: string;
}): AnaliseLabItemPanelModel {
  const titulo = (args.problema.TituloPT || "").trim() || "Problema técnico";
  const pagina =
    args.escopo === "arquivo"
      ? 0
      : args.escopo === "paginas"
        ? 1
        : Math.max(1, args.pagina || 1);
  return {
    idProblemaPadrao: args.problema.ID,
    titulo,
    htmlSnapshot: toBalloonHtml(args.problema.ProbTecHTML || "", titulo),
    obs: null,
    componente: args.componente || "Arq. Único",
    escopo: args.escopo,
    pagina,
    paginas:
      args.escopo === "paginas"
        ? args.pageSpec
        : args.escopo === "pagina"
          ? String(pagina)
          : null,
    resolucaoObrigatoria: false,
    corrigidoSefoc: false,
    obsCorrecaoSefoc: null,
  };
}
