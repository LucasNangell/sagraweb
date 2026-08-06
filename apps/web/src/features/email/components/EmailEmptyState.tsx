import type { LucideIcon } from "lucide-react";
import { MailOpen } from "lucide-react";

interface EmailEmptyStateProps {
  title?: string;
  description?: string;
  icon?: LucideIcon;
}

export function EmailEmptyState({
  title = "Nenhum item selecionado",
  description = "Selecione um e-mail ou pendência na lista ao lado para visualizar o conteúdo e as ações disponíveis.",
  icon: Icon = MailOpen,
}: EmailEmptyStateProps) {
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
        <Icon className="size-8" strokeWidth={1.5} aria-hidden />
      </div>
      <div className="max-w-sm space-y-1">
        <p className="text-base font-semibold text-slate-700">{title}</p>
        <p className="text-sm leading-relaxed text-slate-500">{description}</p>
      </div>
    </div>
  );
}
