import { useNavigate } from "@tanstack/react-router";
import { LogOut, RotateCcw, User } from "lucide-react";
import { useState } from "react";

import { requestSystemRestart } from "@/api/adminSystemRestart";
import { toast } from "@/components/ui/toastStore";
import { useConfirm } from "@/features/acesso/components/ConfirmDialog";
import { useAccessControl } from "@/features/auth/useAccessControl";
import { useAuthStore } from "@/features/auth/authStore";
import { useSyncAndamentosServiceAlert } from "@/features/sync-andamentos/useSyncAndamentosServiceAlert";
import { NotificationCenter } from "@/features/support/components/NotificationCenter";
import { homeTestIds } from "@/lib/testId";
import logoUrl from "@/logo.png";

export function Header() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { can } = useAccessControl();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const syncAndamentosAlert = useSyncAndamentosServiceAlert();
  const [restarting, setRestarting] = useState(false);
  const canRestartSystem = can("sb_reiniciar_sistema");

  const handleLogout = async () => {
    await logout();
    await navigate({ to: "/login" });
  };

  const handleRestartSystem = async () => {
    if (restarting) return;
    const ok = await confirm({
      title: "Reiniciar o sistema SAGRA?",
      message:
        "Isso reinicia os serviços de produção (API, Sync, Monitor e Organizador de e-mail). O sistema ficará indisponível por alguns segundos.",
      confirmLabel: "Reiniciar agora",
      cancelLabel: "Cancelar",
      danger: true,
    });
    if (!ok) return;

    setRestarting(true);
    try {
      await requestSystemRestart("reinicio via header");
      toast.success(
        "Reinício solicitado. Os serviços serão reiniciados em instantes.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível reiniciar o sistema.",
      );
    } finally {
      setRestarting(false);
    }
  };

  // Verde apenas em Vite DEV; builds de release mantêm o azul (import.meta.env.DEV → false).
  const headerBg = syncAndamentosAlert
    ? "bg-red-800"
    : import.meta.env.DEV
      ? "bg-green-900"
      : "bg-secondary-blue";

  return (
    <header
      className={[
        "flex h-14 shrink-0 items-center justify-between gap-2 px-3 text-white shadow-md sm:h-16 sm:gap-3 sm:px-4 lg:h-20 lg:px-6",
        headerBg,
      ].join(" ")}
      role={syncAndamentosAlert ? "alert" : undefined}
    >
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
            {syncAndamentosAlert
              ? "Os dados podem estar desatualizados"
              : "Sistema de Acompanhamento Gráfico"}
          </p>
          {syncAndamentosAlert ? (
            <p className="truncate text-xs font-medium text-white sm:hidden">
              Os dados podem estar desatualizados
            </p>
          ) : null}
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

        {canRestartSystem ? (
          <button
            type="button"
            onClick={() => void handleRestartSystem()}
            disabled={restarting}
            className="flex items-center gap-1.5 rounded-md border border-amber-200/50 bg-amber-500/20 px-2 py-1.5 text-sm font-medium hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60 sm:gap-2 sm:px-3"
            aria-label="Reiniciar sistema"
            title="Reiniciar serviços do SAGRA em produção"
            data-testid={homeTestIds.headerRestartSystem}
          >
            <RotateCcw
              className={["size-4 shrink-0", restarting ? "animate-spin" : ""].join(
                " ",
              )}
            />
            <span className="hidden sm:inline">
              {restarting ? "Reiniciando…" : "Reiniciar"}
            </span>
          </button>
        ) : null}
      </div>
    </header>
  );
}
