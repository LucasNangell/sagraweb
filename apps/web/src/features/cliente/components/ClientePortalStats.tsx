import type { ReactNode } from "react";

import { cn } from "@sagra/ui";
import {
  AlertTriangle,
  ClipboardList,
  FileCheck,
  Layers,
  Upload,
} from "lucide-react";

import type { ClienteDashboardStats } from "../hooks/useClienteDashboardStats";
import type { SectionKind } from "../types/clienteProgress";

interface StatCardProps {
  label: string;
  hint: string;
  count: number;
  icon: ReactNode;
  variant: "action" | "info";
  onClick?: () => void;
}

function StatCard({ label, hint, count, icon, variant, onClick }: StatCardProps) {
  const hasItems = count > 0;
  const Wrapper = onClick ? "button" : "div";

  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex min-h-[88px] flex-col justify-between rounded-xl border p-3 text-left transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary-blue",
        variant === "action"
          ? hasItems
            ? "border-amber-200/80 bg-amber-50/50 hover:bg-amber-50"
            : "border-sagra-border bg-white"
          : "border-emerald-200/60 bg-emerald-50/40 hover:bg-emerald-50/70",
        onClick && "cursor-pointer",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-lg",
            variant === "action"
              ? hasItems
                ? "bg-amber-100 text-amber-700"
                : "bg-neutral-100 text-neutral-500"
              : "bg-emerald-100 text-emerald-700",
          )}
        >
          {icon}
        </span>
        <span
          className={cn(
            "text-2xl font-bold tabular-nums",
            hasItems && variant === "action"
              ? "text-amber-900"
              : variant === "info"
                ? "text-emerald-900"
                : "text-neutral-700",
          )}
        >
          {count}
        </span>
      </div>
      <div>
        <p className="text-xs font-semibold text-secondary-blue">{label}</p>
        <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-neutral-500">
          {hint}
        </p>
      </div>
    </Wrapper>
  );
}

interface ClientePortalStatsProps {
  stats: ClienteDashboardStats;
  onSectionNavigate?: (kind: SectionKind) => void;
}

export function ClientePortalStats({ stats, onSectionNavigate }: ClientePortalStatsProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 lg:gap-3">
      <StatCard
        label="Problemas Técnicos"
        hint="Correções nos arquivos"
        count={stats.problemasTecnicos}
        variant="action"
        icon={<AlertTriangle className="size-4" aria-hidden />}
        onClick={
          onSectionNavigate ? () => onSectionNavigate("pendencias_pt") : undefined
        }
      />
      <StatCard
        label="Aguardando Aprovação"
        hint="Provas para conferir"
        count={stats.aguardandoAprovacao}
        variant="action"
        icon={<FileCheck className="size-4" aria-hidden />}
        onClick={
          onSectionNavigate
            ? () => onSectionNavigate("pendencias_aprovacao")
            : undefined
        }
      />
      <StatCard
        label="Aguardando Arquivos"
        hint="Envio pendente"
        count={stats.aguardandoArquivos}
        variant="action"
        icon={<Upload className="size-4" aria-hidden />}
        onClick={
          onSectionNavigate
            ? () => onSectionNavigate("pendencias_envio_arquivo")
            : undefined
        }
      />
      <StatCard
        label="Em andamento"
        hint="Em produção na gráfica"
        count={stats.emAndamento}
        variant="info"
        icon={<ClipboardList className="size-4" aria-hidden />}
        onClick={
          onSectionNavigate ? () => onSectionNavigate("em_andamento") : undefined
        }
      />
      <StatCard
        label="Total de OSs"
        hint="Todas as publicações ativas"
        count={stats.totalOs}
        variant="info"
        icon={<Layers className="size-4" aria-hidden />}
      />
    </div>
  );
}
