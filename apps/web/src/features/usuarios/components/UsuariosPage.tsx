import { cn } from "@sagra/ui";
import {
  AlertCircle,
  CheckCircle2,
  List,
  Loader2,
  RefreshCw,
  UserX,
  Users,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  useForceRefreshMutation,
  useUsuariosOverview,
} from "@/api/hooks/useUsuariosQueries";
import { useAuthStore } from "@/features/auth/authStore";
import type { UsuariosMessage } from "@/features/usuarios/types";
import { formatUltimoAcesso } from "@/features/usuarios/utils";
import { ClienteCadastroForm } from "@/features/usuarios/components/ClienteCadastroForm";
import {
  UserAdminProvider,
  UserRowActions,
  UserCadastroForm,
} from "@/features/usuarios/components/UserAdminPanel";
import { SetorPainelDefaultsSection } from "@/features/usuarios/components/SetorPainelDefaultsSection";
import { useSagraWebSocket } from "@/hooks/useSagraWebSocket";

const FORCE_REFRESH_CONFIRM =
  "TEM CERTEZA? Isso irá recarregar a página de TODOS os usuários conectados (espalhado em até ~20s).";

const FORCE_REFRESH_RESET_CONFIRM =
  "ATENÇÃO: Isso irá recarregar todos os dashboards e SOBRESCREVER as configurações locais pelo arquivo global (config_painel_global.json). Deseja continuar?";

export function UsuariosPage() {
  const ponto = useAuthStore((s) => s.user?.ponto);
  const [message, setMessage] = useState<UsuariosMessage | null>(null);
  const [forceAction, setForceAction] = useState<"refresh" | "reset" | null>(
    null,
  );

  const {
    rows,
    onlinePoints,
    isInitialLoading,
    isRefreshing,
    hasFatalError,
    hasStaleError,
    error,
    refetch,
  } = useUsuariosOverview();

  const forceRefreshMutation = useForceRefreshMutation();

  useSagraWebSocket({
    path: ponto ? `/ws?ponto=${ponto}` : "/ws",
    enabled: Boolean(ponto),
  });

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 4000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const showSuccess = useCallback((text: string) => {
    setMessage({ type: "success", text });
  }, []);

  const showError = useCallback((text: string) => {
    setMessage({ type: "error", text });
  }, []);

  const handleForceRefresh = async (overwriteConfig = false) => {
    const confirmText = overwriteConfig
      ? FORCE_REFRESH_RESET_CONFIRM
      : FORCE_REFRESH_CONFIRM;

    if (!window.confirm(confirmText)) return;

    setForceAction(overwriteConfig ? "reset" : "refresh");
    try {
      const result = await forceRefreshMutation.mutateAsync({
        type: "force_refresh",
        action: "reload",
        id: 0,
        ano: 0,
        origem: "admin_panel",
        ...(overwriteConfig ? { overwriteConfig: true } : {}),
      });
      const listeners = result.listeners ?? 0;
      showSuccess(
        listeners === 0
          ? "Comando enviado. Nenhum client conectado agora; eles atualizam no próximo poll (até ~20s)."
          : "Comando enviado. Os clients atualizam espalhados em até ~20s.",
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        showError(
          "Tempo esgotado ao enviar o comando. Reinicie a API se o servidor estiver travado.",
        );
      } else if (err instanceof Error && err.name === "AbortError") {
        showError(
          "Tempo esgotado ao enviar o comando. Reinicie a API se o servidor estiver travado.",
        );
      } else {
        showError(
          err instanceof Error
            ? err.message
            : "Erro de conexão ao enviar comando.",
        );
      }
    } finally {
      setForceAction(null);
    }
  };

  const totalLabel = `${rows.length} Usuário${rows.length !== 1 ? "s" : ""}`;

  return (
    <UserAdminProvider
      onSuccess={showSuccess}
      onError={showError}
      onUserUpdated={() => void refetch()}
    >
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <div className="mx-auto flex min-h-0 w-full max-w-[1200px] flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-1 pb-4 md:p-2">
          {message ? (
          <div
            role="status"
            className={cn(
              "rounded-lg border px-4 py-3 text-sm font-medium",
              message.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-800",
            )}
          >
            <span className="inline-flex items-center gap-2">
              {message.type === "success" ? (
                <CheckCircle2 className="size-4 shrink-0" aria-hidden />
              ) : (
                <AlertCircle className="size-4 shrink-0" aria-hidden />
              )}
              {message.text}
            </span>
          </div>
        ) : null}

          <UserCadastroForm
            onSuccess={showSuccess}
            onError={showError}
            onCreated={() => void refetch()}
          />

          <ClienteCadastroForm onSuccess={showSuccess} onError={showError} />

          <SetorPainelDefaultsSection onSuccess={showSuccess} onError={showError} />

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-semibold text-primary-green">
                <Users className="size-6" aria-hidden />
                Usuários Cadastrados
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Lista de usuários que acessaram o sistema e seus status.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleForceRefresh(false)}
                disabled={forceAction !== null}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
              >
                {forceAction === "refresh" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Zap className="size-4" aria-hidden />
                )}
                Atualizar Clients
              </button>

              <button
                type="button"
                onClick={() => void handleForceRefresh(true)}
                disabled={forceAction !== null}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-amber-500 disabled:opacity-60"
              >
                {forceAction === "reset" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="size-4" aria-hidden />
                )}
                Atualizar + Reset Config. Global
              </button>

              <button
                type="button"
                onClick={() => void refetch()}
                disabled={isRefreshing}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw
                  className={cn("size-4", isRefreshing && "animate-spin")}
                  aria-hidden
                />
                Atualizar Lista
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <header className="flex items-center justify-between bg-primary-green px-5 py-4 text-white">
            <span className="flex items-center gap-2 text-base font-semibold">
              <List className="size-5" aria-hidden />
              Lista de Usuários
            </span>
            <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-slate-600">
              {isInitialLoading ? "Carregando..." : totalLabel}
            </span>
          </header>

          <div>
            {isInitialLoading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
                <Loader2
                  className="size-8 animate-spin text-primary-green"
                  aria-hidden
                />
                <p>Carregando usuários...</p>
              </div>
            ) : hasFatalError ? (
              <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                <AlertCircle className="size-10 text-red-600" aria-hidden />
                <p className="text-sm font-semibold text-red-700">
                  Erro ao carregar lista de usuários.
                  {error?.message ? (
                    <>
                      <br />
                      {error.message}
                    </>
                  ) : null}
                </p>
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="mt-2 inline-flex items-center gap-2 rounded-lg bg-primary-green px-4 py-2 text-sm font-semibold text-white hover:bg-primary-green/90"
                >
                  <RefreshCw className="size-4" aria-hidden />
                  Tentar novamente
                </button>
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
                <UserX className="size-10 opacity-50" aria-hidden />
                <p>Nenhum usuário cadastrado.</p>
              </div>
            ) : (
              <>
                {hasStaleError ? (
                  <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                    Não foi possível atualizar a lista; exibindo última versão
                    carregada.
                  </p>
                ) : null}

                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      {["Status", "Ponto", "Nome", "Setor", "Fornecedor", "E-mail", "IPs cadastrados", "Último Acesso", "Ações"].map(
                        (header) => (
                        <th
                          key={header}
                          className="border-b border-slate-200 px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((user) => (
                      <tr
                        key={user.Ponto}
                        className="border-b border-slate-100 hover:bg-slate-50"
                      >
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
                              user.isOnline
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                : "border-slate-200 bg-slate-50 text-slate-600",
                            )}
                          >
                            <span
                              className={cn(
                                "size-2 rounded-full",
                                user.isOnline ? "bg-emerald-500" : "bg-slate-400",
                              )}
                              aria-hidden
                            />
                            {user.isOnline ? "Online" : "Offline"}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-semibold">{user.Ponto}</td>
                        <td className="px-4 py-3">{user.Nome || "-"}</td>
                        <td className="px-4 py-3 text-xs">{user.Setor || "-"}</td>
                        <td className="px-4 py-3 text-xs">
                          {user.Fornecedor === true || user.Fornecedor === 1 ? "Sim" : "Não"}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {user.Email || "-"}
                          {(user.Email || user.ContaInternet) && !user.EmailVerified ? (
                            <span className="ml-1 text-amber-600">(pendente)</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {user.IpsCadastrados?.length
                            ? user.IpsCadastrados.join(", ")
                            : "-"}
                        </td>
                        <td className="px-4 py-3">
                          {formatUltimoAcesso(user.UltimoAcesso)}
                        </td>
                        <td className="px-4 py-3">
                          <UserRowActions
                            ponto={user.Ponto}
                            nome={user.Nome}
                            setor={user.Setor}
                            fornecedor={user.Fornecedor}
                            email={user.Email}
                            emailVerified={user.EmailVerified}
                            contaInternet={user.ContaInternet}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>

          <footer className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
            Online Raw: {JSON.stringify(onlinePoints)}
          </footer>
        </section>
        </div>
      </div>
    </UserAdminProvider>
  );
}
