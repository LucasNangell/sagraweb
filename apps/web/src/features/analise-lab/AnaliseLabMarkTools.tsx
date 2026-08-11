import {
  ArrowUpRight,
  BetweenHorizontalStart,
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

export const TOOLS: Array<{
  id: AnaliseLabTool;
  label: string;
  icon: ReactNode;
}> = [
  { id: "select", label: "Selecionar", icon: <MousePointer2 className="size-3.5" /> },
  {
    id: "offset_corte",
    label: "Offset",
    icon: <BetweenHorizontalStart className="size-3.5" />,
  },
  { id: "faixa", label: "Faixa", icon: <StretchHorizontal className="size-3.5" /> },
  { id: "sangria", label: "Sangria", icon: <Droplets className="size-3.5" /> },
  { id: "retangulo", label: "Retângulo", icon: <Square className="size-3.5" /> },
  { id: "circulo", label: "Círculo", icon: <Circle className="size-3.5" /> },
  { id: "seta", label: "Seta", icon: <ArrowUpRight className="size-3.5" /> },
  { id: "ponto", label: "Ponto", icon: <Dot className="size-5" /> },
  { id: "medida", label: "Medir", icon: <Ruler className="size-3.5" /> },
  { id: "texto", label: "Texto", icon: <Type className="size-3.5" /> },
  { id: "livre", label: "Livre", icon: <Pencil className="size-3.5" /> },
];

export function toolToTipo(tool: AnaliseLabTool): AnaliseLabMarkTipoOrNull {
  if (tool === "select") return null;
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
