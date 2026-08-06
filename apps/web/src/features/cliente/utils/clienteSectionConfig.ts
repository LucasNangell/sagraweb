import type { LucideIcon } from "lucide-react";
import { AlertTriangle, ClipboardList, FileCheck, UserRound, Upload } from "lucide-react";

import type { ClienteDashboardResponse, ClienteOsItem } from "@/api/cliente-portal";

import type { SectionKind } from "../types/clienteProgress";

export interface ClienteSectionConfig {
  kind: SectionKind;
  sectionId: string;
  title: string;
  description: string;
  closedSummary: (count: number) => string;
  emptyMessage: string;
  icon: LucideIcon;
  showPendenciaButton: boolean;
  priority: "action" | "info";
  /** Quando false, não aparece no board da Visão Geral (só página dedicada). */
  includeInDashboard?: boolean;
  getItems: (data: ClienteDashboardResponse) => ClienteOsItem[];
}

export const CLIENTE_SECTIONS: ClienteSectionConfig[] = [
  {
    kind: "pendencias_pt",
    sectionId: "sec-problemas-tecnicos",
    title: "Problemas Técnicos",
    description: "Publicações que precisam de correção nos arquivos enviados.",
    closedSummary: (n) =>
      n === 1
        ? "1 publicação aguarda correção de arquivos"
        : `${n} publicações aguardam correção de arquivos`,
    emptyMessage: "Nenhuma OS com problemas técnicos no momento.",
    icon: AlertTriangle,
    showPendenciaButton: true,
    priority: "action",
    getItems: (d) => d.pendencias_pt,
  },
  {
    kind: "pendencias_aprovacao",
    sectionId: "sec-aguardando-aprovacao",
    title: "Aguardando Aprovação",
    description: "Provas digitais aguardando sua conferência e aprovação.",
    closedSummary: (n) =>
      n === 1 ? "1 prova aguarda sua aprovação" : `${n} provas aguardam sua aprovação`,
    emptyMessage: "Nenhuma prova aguardando aprovação.",
    icon: FileCheck,
    showPendenciaButton: true,
    priority: "action",
    getItems: (d) => d.pendencias_aprovacao,
  },
  {
    kind: "pendencias_envio_arquivo",
    sectionId: "sec-aguardando-arquivos",
    title: "Aguardando Arquivos",
    description: "Publicações aguardando envio de arquivos pelo gabinete.",
    closedSummary: (n) =>
      n === 1
        ? "1 publicação aguarda envio de arquivos"
        : `${n} publicações aguardam envio de arquivos`,
    emptyMessage: "Nenhuma OS aguardando envio de arquivos.",
    icon: Upload,
    showPendenciaButton: true,
    priority: "action",
    getItems: (d) => d.pendencias_envio_arquivo,
  },
  {
    kind: "pendencias_usuario",
    sectionId: "sec-pendencia-usuario",
    title: "Pendência usuário",
    description: "Ordens de serviço com andamento Pendência Usuário.",
    closedSummary: (n) =>
      n === 1
        ? "1 publicação em pendência do usuário"
        : `${n} publicações em pendência do usuário`,
    emptyMessage: "Nenhuma OS com pendência do usuário no momento.",
    icon: UserRound,
    showPendenciaButton: true,
    priority: "action",
    includeInDashboard: false,
    getItems: (d) => d.pendencias_usuario ?? [],
  },
  {
    kind: "em_andamento",
    sectionId: "sec-em-andamento",
    title: "Em andamento",
    description: "Publicações em produção na gráfica, sem pendência do gabinete.",
    closedSummary: (n) =>
      n === 1 ? "1 publicação em produção" : `${n} publicações em produção`,
    emptyMessage: "Nenhuma OS em produção no momento.",
    icon: ClipboardList,
    showPendenciaButton: false,
    priority: "info",
    getItems: (d) => d.em_andamento,
  },
];

export const CLIENTE_DASHBOARD_SECTIONS = CLIENTE_SECTIONS.filter(
  (s) => s.includeInDashboard !== false,
);

export function defaultOpenSection(data: ClienteDashboardResponse): SectionKind | null {
  if (data.pendencias_pt.length > 0) return "pendencias_pt";
  if (data.pendencias_aprovacao.length > 0) return "pendencias_aprovacao";
  if (data.pendencias_envio_arquivo.length > 0) return "pendencias_envio_arquivo";
  return null;
}
