import { cn } from "@sagra/ui";
import { Monitor, RefreshCw, UserCheck, Users, Inbox } from "lucide-react";
import type { ReactNode } from "react";

import { useAccessOverview } from "@/api/acesso";

import type { AcessoAba } from "../acessoTabs";
import { AccessSimulator } from "./AccessSimulator";
import { ManutencaoClients } from "./ManutencaoClients";

interface VisaoGeralTabProps {
  /** Abas que o usuário pode abrir (atalhos dos cartões). */
  canOpen: (aba: AcessoAba) => boolean;
  onOpen: (aba: AcessoAba) => void;
  simulatorPonto?: number;
}

export function VisaoGeralTab({ canOpen, onOpen, simulatorPonto }: VisaoGeralTabProps) {
  const overview = useAccessOverview();
  const data = overview.data;
  const loading = overview.isPending && !data;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-1 pb-4 md:p-2">
      {overview.isError && !data ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="min-w-0 flex-1">
            Não foi possível carregar o resumo.{" "}
            {overview.error instanceof Error ? overview.error.message : null}
          </span>
          <button
            type="button"
            onClick={() => void overview.refetch()}
            className="sagra-btn sagra-btn--outline sagra-btn--sm"
          >
            <RefreshCw className="size-4" aria-hidden />
            Tentar novamente
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            icon={<Users className="size-5" aria-hidden />}
            label="Usuários"
            value={data?.usuarios.total}
            detail={data ? `${data.usuarios.conta_internet} com conta internet` : undefined}
            loading={loading}
            onClick={canOpen("usuarios") ? () => onOpen("usuarios") : undefined}
          />
          <StatCard
            icon={<UserCheck className="size-5" aria-hidden />}
            label="Online agora"
            value={data?.usuarios.online}
            detail={
              data && data.usuarios.ativacao_pendente > 0
                ? `${data.usuarios.ativacao_pendente} com ativação pendente`
                : undefined
            }
            loading={loading}
            onClick={canOpen("usuarios") ? () => onOpen("usuarios") : undefined}
          />
          <StatCard
            icon={<Monitor className="size-5" aria-hidden />}
            label="Terminais ativos"
            value={data?.terminais.ativos}
            detail={data ? `de ${data.terminais.total} cadastrados` : undefined}
            loading={loading}
            onClick={canOpen("terminais") ? () => onOpen("terminais") : undefined}
          />
          <StatCard
            icon={<Inbox className="size-5" aria-hidden />}
            label="Solicitações pendentes"
            value={data?.solicitacoes_pendentes}
            highlight={Boolean(data && data.solicitacoes_pendentes > 0)}
            loading={loading}
            onClick={canOpen("terminais") ? () => onOpen("terminais") : undefined}
          />
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800">Como o acesso é resolvido</h2>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
          <li>
            <strong>Internet (login com senha)</strong> — só as permissões próprias do usuário;
            sem elas, nada é liberado. Conta inativa ou não ativada não entra.
          </li>
          <li>
            <strong>Rede local</strong> — permissões do terminal (IP exato, ou o padrão com % mais
            específico). Se o usuário tiver permissões próprias, elas{" "}
            <strong>substituem</strong> as do terminal.
          </li>
          <li>
            <strong>Terminal MASTER / servidor</strong> — acesso total e único lugar onde esta
            página administra dados. Usuário com permissões próprias vê o menu conforme elas.
          </li>
        </ol>
      </section>

      <AccessSimulator key={simulatorPonto ?? "none"} initialPonto={simulatorPonto} />

      <ManutencaoClients />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  detail,
  loading,
  highlight,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: number | undefined;
  detail?: string;
  loading: boolean;
  highlight?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span
        className={cn(
          "flex items-center gap-2 text-xs font-semibold uppercase tracking-wide",
          highlight ? "text-pink-700" : "text-slate-500",
        )}
      >
        {icon}
        {label}
      </span>
      {loading ? (
        <span className="mt-2 block h-7 w-12 animate-pulse rounded bg-slate-100" />
      ) : (
        <span
          className={cn(
            "mt-1 block text-2xl font-bold",
            highlight ? "text-pink-700" : "text-slate-800",
          )}
        >
          {value ?? "—"}
        </span>
      )}
      {detail ? <span className="mt-0.5 block text-xs text-slate-500">{detail}</span> : null}
    </>
  );
  const className = cn(
    "rounded-xl border bg-white p-4 text-left shadow-sm",
    highlight ? "border-pink-200" : "border-slate-200",
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(className, "hover:bg-slate-50")}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}
