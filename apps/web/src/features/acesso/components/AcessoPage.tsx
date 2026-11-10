import { cn } from "@sagra/ui";
import { useNavigate } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { useMemo } from "react";

import { useAuthStore } from "@/features/auth/authStore";
import { AdminIpsPage } from "@/features/admin-ips/components/AdminIpsPage";
import { UsuariosPage } from "@/features/usuarios/components/UsuariosPage";

import {
  getVisibleAcessoTabs,
  resolveAcessoAba,
  type AcessoAba,
  type AcessoSearch,
} from "../acessoTabs";

interface AcessoPageProps {
  search: AcessoSearch;
}

export function AcessoPage({ search }: AcessoPageProps) {
  const permissions = useAuthStore((s) => s.permissions);
  const navigate = useNavigate();

  const visibleTabs = useMemo(() => getVisibleAcessoTabs(permissions), [permissions]);
  const activeTab = resolveAcessoAba(search.aba, visibleTabs);

  const selectTab = (aba: AcessoAba) => {
    void navigate({ to: "/admin/acesso", search: { aba }, replace: true });
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 px-1 pb-2 pt-1 md:px-2">
        <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800">
          <KeyRound className="size-5 text-secondary-blue" aria-hidden />
          Controle de Acesso
        </h1>
        <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-slate-600">
          Quem acessa (usuários) e de onde (terminais). Na rede local valem as permissões do
          terminal, substituídas pelas do usuário quando ele tem permissões próprias; via
          internet valem só as do usuário; o terminal MASTER tem acesso total.
        </p>
        <div
          role="tablist"
          aria-label="Seções do controle de acesso"
          className="mt-3 flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1"
        >
          {visibleTabs.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`acesso-tab-${tab.id}`}
                aria-selected={active}
                aria-controls={`acesso-panel-${tab.id}`}
                onClick={() => selectTab(tab.id)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
                  active
                    ? "bg-white text-secondary-blue shadow-sm ring-1 ring-slate-200/80"
                    : "text-slate-600 hover:bg-white/60 hover:text-secondary-blue",
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      <div
        role="tabpanel"
        id={activeTab ? `acesso-panel-${activeTab}` : undefined}
        aria-labelledby={activeTab ? `acesso-tab-${activeTab}` : undefined}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {activeTab === "usuarios" ? <UsuariosPage /> : null}
        {activeTab === "terminais" ? <AdminIpsPage /> : null}
      </div>
    </div>
  );
}
