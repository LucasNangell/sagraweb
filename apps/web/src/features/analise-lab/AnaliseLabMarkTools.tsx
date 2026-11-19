import {
  ArrowUpRight,
  Circle,
  Dot,
  Droplets,
  MousePointer2,
  Pencil,
  Ruler,
  Square,
  StretchHorizontal,
  Type,
} from "lucide-react";
import type { ReactNode } from "react";

export type AnaliseLabTool =
  | "select"
  | "offset_corte"
  | "faixa"
  | "sangria"
  | "retangulo"
  | "ponto"
  | "medida"
  | "seta"
  | "circulo"
  | "texto"
  | "livre";

/** Ferramentas graváveis na barra/paleta (Offset auxiliar sai daqui). */
export const TOOLS: Array<{
  id: AnaliseLabTool;
  label: string;
  icon: ReactNode;
}> = [
  { id: "select", label: "Selecionar", icon: <MousePointer2 className="size-4 shrink-0" /> },
  { id: "faixa", label: "Faixa", icon: <StretchHorizontal className="size-4 shrink-0" /> },
  { id: "sangria", label: "Sangria", icon: <Droplets className="size-4 shrink-0" /> },
  { id: "retangulo", label: "Retângulo", icon: <Square className="size-4 shrink-0" /> },
  { id: "circulo", label: "Círculo", icon: <Circle className="size-4 shrink-0" /> },
  { id: "seta", label: "Seta", icon: <ArrowUpRight className="size-4 shrink-0" /> },
  { id: "ponto", label: "Ponto", icon: <Dot className="size-5 shrink-0" /> },
  { id: "medida", label: "Medir", icon: <Ruler className="size-4 shrink-0" /> },
  { id: "texto", label: "Texto", icon: <Type className="size-4 shrink-0" /> },
  { id: "livre", label: "Livre", icon: <Pencil className="size-4 shrink-0" /> },
];

export function toolToTipo(tool: AnaliseLabTool): AnaliseLabMarkTipoOrNull {
  if (tool === "select" || tool === "offset_corte") return null;
  return tool;
}

type AnaliseLabMarkTipoOrNull =
  | "offset_corte"
  | "faixa"
  | "sangria"
  | "retangulo"
  | "ponto"
  | "medida"
  | "seta"
  | "circulo"
  | "texto"
  | "livre"
  | null;
