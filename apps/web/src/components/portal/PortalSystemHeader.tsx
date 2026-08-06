import logoUrl from "@/logo.png";

import "./PortalSystemHeader.css";

interface PortalSystemHeaderProps {
  subtitle?: string;
}

/** Cabeçalho visual alinhado ao Header autenticado (logo + título SAGRA). */
export function PortalSystemHeader({
  subtitle = "Portal do Cliente — Problemas Técnicos",
}: PortalSystemHeaderProps) {
  return (
    <header className="portal-system-header flex h-20 shrink-0 items-center justify-between bg-secondary-blue px-6 text-white shadow-md">
      <div className="flex items-center gap-4">
        <img src={logoUrl} alt="DEAPA" className="h-12 w-auto object-contain" />
        <div>
          <h1 className="text-lg font-semibold tracking-wide">SAGRA Web</h1>
          <p className="text-xs text-white/70">Sistema de Acompanhamento Gráfico</p>
          {subtitle ? (
            <p className="mt-0.5 text-[11px] font-medium text-white/85">{subtitle}</p>
          ) : null}
        </div>
      </div>
    </header>
  );
}
