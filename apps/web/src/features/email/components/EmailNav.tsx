import { cn } from "@sagra/ui";
import { ClipboardList, Inbox, Mail, Settings2 } from "lucide-react";
import type { ReactNode } from "react";

import type { EmailTab } from "../types";

interface EmailNavProps {
  activeTab: EmailTab;
  onTabChange: (tab: EmailTab) => void;
  showPendenciasDot: boolean;
  pendenciasCount?: number;
  onOpenConfig?: () => void;
  configActive?: boolean;
  showConfigButton?: boolean;
}

export function EmailNav({
  activeTab,
  onTabChange,
  showPendenciasDot,
  pendenciasCount = 0,
  onOpenConfig,
  configActive = false,
  showConfigButton = false,
}: EmailNavProps) {
  return (
    <nav
      className="flex w-full shrink-0 flex-row items-center justify-center gap-1 border-b border-slate-200/90 bg-slate-50 px-2 py-2 md:h-full md:w-14 md:flex-col md:justify-start md:border-r md:border-b-0 md:py-4"
      aria-label="Pastas de e-mail"
    >
      <div
        className="mr-1 flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary-blue text-white shadow-md shadow-secondary-blue/20 md:mb-3 md:mr-0"
        title="Módulo E-mail"
      >
        <Mail className="size-4" aria-hidden />
      </div>

      <NavButton
        active={activeTab === "inbox"}
        onClick={() => onTabChange("inbox")}
        title="Caixa de Entrada"
        label="Entrada"
      >
        <Inbox className="size-5" aria-hidden />
      </NavButton>

      <NavButton
        active={activeTab === "pendencias"}
        onClick={() => onTabChange("pendencias")}
        title="Pendências de O.S."
        label="Pendências"
        badge={
          showPendenciasDot
            ? pendenciasCount > 9
              ? "9+"
              : String(pendenciasCount)
            : undefined
        }
      >
        <ClipboardList className="size-5" aria-hidden />
      </NavButton>

      {showConfigButton ? (
        <div className="ml-auto flex items-center gap-1 md:ml-0 md:mt-auto md:flex-col md:pt-2">
          <NavButton
            active={configActive}
            onClick={() => onOpenConfig?.()}
            title="Configurações do Exchange"
            label="Config"
          >
            <Settings2 className="size-5" aria-hidden />
          </NavButton>
        </div>
      ) : null}
    </nav>
  );
}

function NavButton({
  active,
  onClick,
  title,
  label,
  badge,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  label: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "group relative flex w-11 flex-col items-center gap-0.5 rounded-lg py-2 transition-colors",
        active
          ? "bg-white text-secondary-blue shadow-sm ring-1 ring-slate-200/80"
          : "text-slate-500 hover:bg-white/70 hover:text-secondary-blue",
      )}
    >
      {children}
      <span className="text-[0.6rem] font-medium leading-none">{label}</span>
      {badge ? (
        <span className="absolute -right-0.5 top-0.5 flex min-w-[1rem] items-center justify-center rounded-full bg-sagra-danger px-1 text-[0.6rem] font-bold text-white">
          {badge}
        </span>
      ) : null}
    </button>
  );
}
