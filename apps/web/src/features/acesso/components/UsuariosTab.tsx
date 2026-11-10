import { cn } from "@sagra/ui";
import { AlertCircle, ChevronRight, RefreshCw, Search, UserPlus, UserX } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { useUsuariosOverview } from "@/api/hooks/useUsuariosQueries";
import { useAuthStore } from "@/features/auth/authStore";
import type { UsuarioRow } from "@/features/usuarios/types";
import { formatUltimoAcesso } from "@/features/usuarios/utils";
import { useSagraWebSocket } from "@/hooks/useSagraWebSocket";

import { hasInternetAccount, isAccountActive, isFornecedor } from "../userAccess";
import { useFeedback } from "./Feedback";
import { UserCadastroForm } from "./UserCadastroForm";
import { UserDrawer } from "./UserDrawer";

type TriState = "todos" | "sim" | "nao";

export interface UsuariosFilters {
  text: string;
  setor: string;
  online: TriState;
  fornecedor: TriState;
  internet: TriState;
}

const EMPTY_FILTERS: UsuariosFilters = {
  text: "",
  setor: "",
  online: "todos",
  fornecedor: "todos",
  internet: "todos",
};

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function matchTri(filter: TriState, value: boolean): boolean {
  return filter === "todos" || (filter === "sim") === value;
}

export function filterUsuarios(rows: ReadonlyArray<UsuarioRow>, f: UsuariosFilters): UsuarioRow[] {
  const q = normalize(f.text.trim());
  return rows.filter((u) => {
    if (q) {
      const hay = normalize(
        [u.Ponto, u.Nome, u.Email, u.Setor, ...(u.IpsCadastrados ?? [])].filter(Boolean).join(" "),
      );
      if (!hay.includes(q)) return false;
    }
    if (f.setor && (u.Setor ?? "") !== f.setor) return false;
    if (!matchTri(f.online, u.isOnline)) return false;
    if (!matchTri(f.fornecedor, isFornecedor(u))) return false;
    if (!matchTri(f.internet, hasInternetAccount(u))) return false;
    return true;
  });
}

interface UsuariosTabProps {
  selectedPonto?: number;
  onSelect: (ponto: number | undefined) => void;
  /** Abre o simulador de acesso efetivo para o usuário. */
  onSimulate?: (ponto: number) => void;
}

export function UsuariosTab({ selectedPonto, onSelect, onSimulate }: UsuariosTabProps) {
  const feedback = useFeedback();
  const ponto = useAuthStore((s) => s.user?.ponto);
  const [filters, setFilters] = useState<UsuariosFilters>(EMPTY_FILTERS);
  const [showCadastro, setShowCadastro] = useState(false);

  const {
    rows,
    users,
    isInitialLoading,
    isRefreshing,
    hasFatalError,
    hasStaleError,
    error,
    refetch,
  } = useUsuariosOverview();

  // Mantém a presença do administrador no canal de online (mesmo comportamento da página antiga).
  useSagraWebSocket({
    path: ponto ? `/ws?ponto=${ponto}` : "/ws",
    enabled: Boolean(ponto),
  });

  const setores = useMemo(() => {
    const set = new Set<string>();
    for (const u of rows) if (u.Setor?.trim()) set.add(u.Setor.trim());
    return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [rows]);

  const filtered = useMemo(() => filterUsuarios(rows, filters), [rows, filters]);
  const hasActiveFilter = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  const selectedUser = useMemo(
    () =>
      selectedPonto == null
        ? null
        : (users.find((u) => Number(u.Ponto) === selectedPonto) ?? null),
    [selectedPonto, users],
  );

  const selectClass =
    "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-1 pb-4 md:p-2">
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => setShowCadastro((v) => !v)}
          aria-expanded={showCadastro}
          className="flex w-full items-center justify-between gap-2 px-5 py-3 text-left text-sm font-semibold text-secondary-blue hover:bg-slate-50"
        >
          <span className="flex items-center gap-2">
            <UserPlus className="size-4" aria-hidden />
            Cadastrar usuário (acesso internet)
          </span>
          <ChevronRight
            className={cn("size-4 transition-transform", showCadastro && "rotate-90")}
            aria-hidden
          />
        </button>
      </section>
      {showCadastro ? (
        <UserCadastroForm
          onSuccess={feedback.success}
          onError={feedback.error}
          onCreated={() => void refetch()}
        />
      ) : null}

      <section className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-200 p-3">
          <label className="relative min-w-[12rem] flex-1">
            <span className="sr-only">Buscar usuário</span>
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              type="search"
              value={filters.text}
              onChange={(e) => setFilters({ ...filters, text: e.target.value })}
              placeholder="Ponto, nome, e-mail ou IP…"
              className="h-9 w-full rounded-md border border-slate-300 pl-8 pr-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green"
            />
          </label>
          <select
            aria-label="Filtrar por setor"
            value={filters.setor}
            onChange={(e) => setFilters({ ...filters, setor: e.target.value })}
            className={selectClass}
          >
            <option value="">Todos os setores</option>
            {setores.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <TriSelect
            label="Status"
            value={filters.online}
            onChange={(online) => setFilters({ ...filters, online })}
            labels={["Online e offline", "Online", "Offline"]}
            className={selectClass}
          />
          <TriSelect
            label="Fornecedor"
            value={filters.fornecedor}
            onChange={(fornecedor) => setFilters({ ...filters, fornecedor })}
            labels={["Fornecedor: todos", "Só fornecedores", "Sem fornecedores"]}
            className={selectClass}
          />
          <TriSelect
            label="Conta internet"
            value={filters.internet}
            onChange={(internet) => setFilters({ ...filters, internet })}
            labels={["Conta internet: todos", "Com conta internet", "Sem conta internet"]}
            className={selectClass}
          />
          {hasActiveFilter ? (
            <button
              type="button"
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="h-9 px-2 text-sm font-semibold text-secondary-blue hover:underline"
            >
              Limpar
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isRefreshing}
            className="sagra-btn sagra-btn--outline sagra-btn--sm ml-auto"
          >
            <RefreshCw className={cn("size-4", isRefreshing && "animate-spin")} aria-hidden />
            Atualizar
          </button>
        </div>

        <p className="px-4 pt-2 text-xs text-slate-500">
          {isInitialLoading
            ? "Carregando…"
            : `${filtered.length} de ${rows.length} usuário${rows.length !== 1 ? "s" : ""}`}
        </p>

        {hasStaleError ? (
          <p className="mx-3 mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Não foi possível atualizar a lista; exibindo a última versão carregada.
          </p>
        ) : null}

        {isInitialLoading ? (
          <ListSkeleton />
        ) : hasFatalError ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <AlertCircle className="size-10 text-red-600" aria-hidden />
            <p className="text-sm font-semibold text-red-700">
              Erro ao carregar a lista de usuários.
              {error?.message ? <span className="block font-normal">{error.message}</span> : null}
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="sagra-btn sagra-btn--primary sagra-btn--md"
            >
              <RefreshCw className="size-4" aria-hidden />
              Tentar novamente
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-slate-500">
            <UserX className="size-10 opacity-50" aria-hidden />
            <p className="text-sm">
              {rows.length === 0 ? "Nenhum usuário cadastrado." : "Nenhum usuário com esses filtros."}
            </p>
            {rows.length === 0 ? (
              <button
                type="button"
                onClick={() => setShowCadastro(true)}
                className="text-sm font-semibold text-secondary-blue hover:underline"
              >
                Cadastrar usuário
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="text-sm font-semibold text-secondary-blue hover:underline"
              >
                Limpar filtros
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Celular: cartões */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {filtered.map((user) => (
                <li key={user.Ponto}>
                  <button
                    type="button"
                    onClick={() => onSelect(Number(user.Ponto))}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                  >
                    <OnlineDot online={user.isOnline} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-800">
                        {user.Nome || "-"}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {user.Ponto} · {user.Setor || "sem setor"}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        <UserBadges user={user} />
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>

            {/* Desktop: tabela com cabeçalho aderente e primeira coluna fixa */}
            <div className="hidden max-h-[calc(100vh-18rem)] overflow-auto md:block">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-[2] bg-slate-50">
                  <tr>
                    {["Usuário", "Setor", "Conta", "IPs vinculados", "Último acesso", ""].map(
                      (h, i) => (
                        <th
                          key={h || "acoes"}
                          className={cn(
                            "border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold uppercase text-slate-600",
                            i === 0 && "sticky left-0 z-[3] bg-slate-50",
                          )}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((user) => {
                    const selected = selectedPonto === Number(user.Ponto);
                    return (
                      <tr
                        key={user.Ponto}
                        className={cn(
                          "group cursor-pointer border-b border-slate-100 hover:bg-slate-50",
                          selected && "bg-sky-50",
                        )}
                        onClick={() => onSelect(Number(user.Ponto))}
                      >
                        <td
                          className={cn(
                            "sticky left-0 bg-white px-3 py-2 group-hover:bg-slate-50",
                            selected && "bg-sky-50",
                          )}
                        >
                          <span className="flex items-center gap-2">
                            <OnlineDot online={user.isOnline} />
                            <span className="min-w-0">
                              <span className="block font-semibold text-slate-800">
                                {user.Nome || "-"}
                              </span>
                              <span className="block text-xs text-slate-500">{user.Ponto}</span>
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs">{user.Setor || "-"}</td>
                        <td className="px-3 py-2">
                          <span className="flex flex-wrap gap-1">
                            <UserBadges user={user} />
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {user.IpsCadastrados?.length ? user.IpsCadastrados.join(", ") : "-"}
                        </td>
                        <td className="px-3 py-2 text-xs">{formatUltimoAcesso(user.UltimoAcesso)}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelect(Number(user.Ponto));
                            }}
                            className="sagra-btn sagra-btn--outline sagra-btn--sm"
                          >
                            Abrir
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {selectedPonto != null ? (
        <UserDrawer
          key={selectedPonto}
          ponto={selectedPonto}
          user={selectedUser}
          allUsers={users}
          onClose={() => onSelect(undefined)}
          onChanged={() => void refetch()}
          onSimulate={onSimulate}
        />
      ) : null}
    </div>
  );
}

function TriSelect({
  label,
  value,
  onChange,
  labels,
  className,
}: {
  label: string;
  value: TriState;
  onChange: (v: TriState) => void;
  labels: [string, string, string];
  className: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as TriState)}
      className={className}
    >
      <option value="todos">{labels[0]}</option>
      <option value="sim">{labels[1]}</option>
      <option value="nao">{labels[2]}</option>
    </select>
  );
}

function OnlineDot({ online }: { online: boolean }) {
  return (
    <span
      className={cn("size-2.5 shrink-0 rounded-full", online ? "bg-emerald-500" : "bg-slate-300")}
      title={online ? "Online" : "Offline"}
      aria-label={online ? "Online" : "Offline"}
      role="img"
    />
  );
}

function UserBadges({ user }: { user: UsuarioRow }) {
  const internet = hasInternetAccount(user);
  const verified = user.EmailVerified === true || user.EmailVerified === 1;
  return (
    <>
      {internet ? (
        !isAccountActive(user) ? (
          <Badge tone="red">Conta inativa</Badge>
        ) : verified ? (
          <Badge tone="green">Internet</Badge>
        ) : (
          <Badge tone="amber">Ativação pendente</Badge>
        )
      ) : (
        <Badge tone="slate">Só rede local</Badge>
      )}
      {isFornecedor(user) ? <Badge tone="sky">Fornecedor</Badge> : null}
    </>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "green" | "amber" | "red" | "slate" | "sky";
  children: ReactNode;
}) {
  const tones = {
    green: "bg-emerald-50 text-emerald-800 border-emerald-200",
    amber: "bg-amber-50 text-amber-800 border-amber-200",
    red: "bg-red-50 text-red-800 border-red-200",
    slate: "bg-slate-50 text-slate-600 border-slate-200",
    sky: "bg-sky-50 text-sky-800 border-sky-200",
  } as const;
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", tones[tone])}>
      {children}
    </span>
  );
}

function ListSkeleton() {
  return (
    <ul className="space-y-2 p-4" aria-label="Carregando usuários">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="h-10 animate-pulse rounded-md bg-slate-100" />
      ))}
    </ul>
  );
}
