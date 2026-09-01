import { useNavigate } from "@tanstack/react-router";
import { LogOut, User } from "lucide-react";

import { useAuthStore } from "@/features/auth/authStore";
import { NotificationCenter } from "@/features/support/components/NotificationCenter";
import { homeTestIds } from "@/lib/testId";
import logoUrl from "@/logo.png";

export function Header() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const handleLogout = async () => {
    await logout();
    await navigate({ to: "/login" });
  };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 bg-secondary-blue px-3 text-white shadow-md sm:h-16 sm:gap-3 sm:px-4 lg:h-20 lg:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3 lg:gap-4">
        <img
          src={logoUrl}
          alt="DEAPA"
          className="h-8 w-auto shrink-0 object-contain sm:h-10 lg:h-12"
        />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold tracking-wide sm:text-base lg:text-lg">
            SAGRA Web
          </h1>
          <p className="hidden text-xs text-white/70 sm:block">
            Sistema de Acompanhamento Gráfico
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2 lg:gap-4">
        <NotificationCenter />

        {user ? (
          <div
            className="flex max-w-[9rem] items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 text-xs sm:max-w-none sm:gap-2 sm:px-3 sm:py-1.5 sm:text-sm"
            title={`${user.nome} (${user.ponto})`}
          >
            <User className="size-4 shrink-0" aria-hidden />
            <span className="truncate">
              <span className="hidden sm:inline">{user.nome} </span>
              <span className="text-white/80 sm:text-white/70">({user.ponto})</span>
            </span>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void handleLogout()}
          className="flex items-center gap-1.5 rounded-md border border-white/30 px-2 py-1.5 text-sm font-medium hover:bg-white/10 sm:gap-2 sm:px-3"
          aria-label="Sair"
          data-testid={homeTestIds.headerLogout}
        >
          <LogOut className="size-4 shrink-0" />
          <span className="hidden sm:inline">Sair</span>
        </button>
      </div>
    </header>
  );
}
