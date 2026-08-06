import { cn } from "@sagra/ui";
import { Disc3, HardDrive } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAccessControl } from "@/features/auth/useAccessControl";
import { GravacaoExternaTab } from "./GravacaoExternaTab";
import { GravacaoPendenteTab } from "./GravacaoPendenteTab";

type GravacaoTab = "pendente" | "externa";

export function GravacaoExternaPage() {
  const { can, isReady } = useAccessControl();
  const canPendente = can("sb_gravacao_pendente");
  const canExterna = can("sb_gravacao_externa");

  const defaultTab = useMemo((): GravacaoTab => {
    if (canPendente) return "pendente";
    if (canExterna) return "externa";
    return "externa";
  }, [canPendente, canExterna]);

  const [tab, setTab] = useState<GravacaoTab>(defaultTab);

  useEffect(() => {
    setTab(defaultTab);
  }, [defaultTab]);

  const showTabs = canPendente && canExterna;

  if (!isReady) {
    return (
      <div className="flex h-[calc(100dvh-3.5rem)] items-center justify-center bg-neutral-50">
        <div className="size-10 animate-spin rounded-full border-4 border-primary-green border-t-transparent" />
      </div>
    );
  }

  if (!canPendente && !canExterna) {
    return (
      <div className="flex h-[calc(100dvh-3.5rem)] items-center justify-center bg-neutral-50 p-8 text-center">
        <p className="text-sm text-neutral-600">
          Você não tem permissão para acessar Gravação Pendente ou Gravação Externa.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col bg-neutral-50">
      {showTabs ? (
        <div className="shrink-0 border-b border-neutral-200 bg-white px-3 py-2">
          <div
            className="flex w-fit max-w-full rounded-lg border border-neutral-200 bg-neutral-50 p-0.5"
            role="tablist"
            aria-label="Abas de gravação"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === "pendente"}
              onClick={() => setTab("pendente")}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors",
                tab === "pendente"
                  ? "bg-white text-primary-green shadow-sm"
                  : "text-neutral-600 hover:text-neutral-800",
              )}
            >
              <Disc3 className="size-4 shrink-0" />
              OPs p/ Gravação Externa
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "externa"}
              onClick={() => setTab("externa")}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors",
                tab === "externa"
                  ? "bg-white text-primary-green shadow-sm"
                  : "text-neutral-600 hover:text-neutral-800",
              )}
            >
              <HardDrive className="size-4 shrink-0" />
              OPs pendentes no Birô
            </button>
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {tab === "pendente" && canPendente ? (
          <GravacaoPendenteTab />
        ) : canExterna ? (
          <GravacaoExternaTab />
        ) : null}
      </div>
    </div>
  );
}
