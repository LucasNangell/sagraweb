import { cn } from "@sagra/ui";
import {
  AlertTriangle,
  Loader2,
  Paperclip,
  RefreshCw,
  Search,
} from "lucide-react";
import { useMemo } from "react";

import type { EmailTab, InboxEmail, PendenciaOs } from "../types";
import { formatEmailDate, isApogeePendencia, pendenciaKey, senderInitials } from "../utils";

interface EmailListPanelProps {
  activeTab: EmailTab;
  search: string;
  onSearchChange: (value: string) => void;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  inbox: InboxEmail[];
  pendencias: PendenciaOs[];
  itemCount: number;
  isLoading: boolean;
  isFatalError: boolean;
  isStaleError?: boolean;
  errorMessage?: string;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  className?: string;
}

function matchesSearch(text: string, q: string): boolean {
  if (!q) return true;
  return text.toLowerCase().includes(q.toLowerCase());
}

export function EmailListPanel({
  activeTab,
  search,
  onSearchChange,
  selectedKey,
  onSelect,
  inbox,
  pendencias,
  itemCount,
  isLoading,
  isFatalError,
  isStaleError,
  errorMessage,
  onRefresh,
  isRefreshing,
  className,
}: EmailListPanelProps) {
  const title =
    activeTab === "inbox" ? "Caixa de Entrada" : "Pendências de O.S.";

  const filteredInbox = useMemo(() => {
    const q = search.trim();
    if (!q) return inbox;
    return inbox.filter(
      (e) =>
        matchesSearch(e.sender, q) ||
        matchesSearch(e.subject, q) ||
        matchesSearch(e.preview, q),
    );
  }, [inbox, search]);

  const filteredPendencias = useMemo(() => {
    const q = search.trim();
    if (!q) return pendencias;
    return pendencias.filter((p) => {
      const label = `OS ${p.os}/${String(p.ano).slice(-2)} ${p.situacao} ${p.setor} ${p.subject ?? ""} ${p.sender ?? ""}`;
      return matchesSearch(label, q);
    });
  }, [pendencias, search]);

  const dbPendencias = useMemo(
    () => filteredPendencias.filter((p) => !isApogeePendencia(p)),
    [filteredPendencias],
  );
  const apogeePendencias = useMemo(
    () => filteredPendencias.filter((p) => isApogeePendencia(p)),
    [filteredPendencias],
  );

  const displayCount =
    activeTab === "inbox" ? filteredInbox.length : filteredPendencias.length;

  return (
    <div
      className={cn(
        "flex min-h-0 w-full min-w-0 flex-1 flex-col border-b border-slate-200/90 bg-slate-50/50 md:h-full md:w-[min(100%,340px)] md:max-w-[340px] md:flex-none md:shrink-0 md:border-r md:border-b-0 lg:max-w-[380px]",
        className,
      )}
    >
      <header className="shrink-0 border-b border-slate-200/80 bg-white px-4 py-3.5">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold tracking-tight text-slate-800">
            {title}
          </h2>
          <div className="flex items-center gap-1.5">
            {onRefresh ? (
              <button
                type="button"
                onClick={onRefresh}
                title="Atualizar lista"
                className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-secondary-blue"
              >
                <RefreshCw
                  className={cn("size-3.5", isRefreshing && "animate-spin")}
                  aria-hidden
                />
              </button>
            ) : null}
            {isRefreshing && !onRefresh ? (
              <RefreshCw
                className="size-3.5 animate-spin text-slate-400"
                aria-label="Atualizando"
              />
            ) : null}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
              {displayCount}
              {search.trim() && displayCount !== itemCount
                ? ` / ${itemCount}`
                : ""}
            </span>
          </div>
        </div>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Pesquisar remetente ou assunto…"
            className="w-full rounded-lg border border-slate-200 bg-slate-50/80 py-2 pl-9 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-secondary-blue focus:bg-white focus:ring-2 focus:ring-secondary-blue/15"
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {isLoading ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-slate-500">
            <Loader2 className="size-6 animate-spin" aria-hidden />
            <span className="text-sm">Carregando…</span>
          </div>
        ) : null}

        {isStaleError ? (
          <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p className="font-semibold">Falha ao atualizar a lista</p>
            <p className="mt-0.5 text-amber-800/90">
              Exibindo a última sincronização bem-sucedida.
              {errorMessage ? ` ${errorMessage}` : ""}
            </p>
          </div>
        ) : null}

        {isFatalError ? (
          <div className="px-4 py-10 text-center text-sm text-red-600">
            <AlertTriangle className="mx-auto mb-2 size-6" aria-hidden />
            Erro ao sincronizar.
            {errorMessage ? (
              <p className="mt-2 text-xs text-slate-500">{errorMessage}</p>
            ) : null}
            {onRefresh ? (
              <button
                type="button"
                onClick={onRefresh}
                className="mt-4 rounded-lg bg-secondary-blue px-3 py-1.5 text-xs font-semibold text-white"
              >
                Tentar novamente
              </button>
            ) : null}
          </div>
        ) : null}

        {!isLoading && !isFatalError && displayCount === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">
            {search.trim()
              ? "Nenhum resultado para a busca."
              : activeTab === "inbox"
                ? "Nenhum e-mail não lido nas pastas monitoradas."
                : "Nenhum item."}
          </p>
        ) : null}

        {!isLoading && !isFatalError && activeTab === "inbox"
          ? filteredInbox.map((item) => (
              <InboxListRow
                key={item.id}
                item={item}
                selected={selectedKey === item.id}
                onSelect={() => onSelect(item.id)}
              />
            ))
          : null}

        {!isLoading && !isFatalError && activeTab === "pendencias" ? (
          <>
            {dbPendencias.length > 0 ? (
              <div className="border-b-2 border-sky-200/90">
                <PendenciaSectionHeader
                  label="Encam. de Docum."
                  variant="db"
                  count={dbPendencias.length}
                />
                {dbPendencias.map((item) => {
                  const key = pendenciaKey(item);
                  return (
                    <PendenciaListRow
                      key={key}
                      item={item}
                      selected={selectedKey === key}
                      onSelect={() => onSelect(key)}
                    />
                  );
                })}
              </div>
            ) : null}
            {dbPendencias.length > 0 && apogeePendencias.length > 0 ? (
              <div
                className="h-2 shrink-0 bg-gradient-to-b from-slate-200/80 to-transparent"
                aria-hidden
              />
            ) : null}
            {apogeePendencias.length > 0 ? (
              <div className="border-b-2 border-violet-200/90">
                <PendenciaSectionHeader
                  label="E-mail Apogee"
                  variant="apogee"
                  count={apogeePendencias.length}
                />
                {apogeePendencias.map((item) => {
                  const key = pendenciaKey(item);
                  return (
                    <ApogeePendenciaListRow
                      key={key}
                      item={item}
                      selected={selectedKey === key}
                      onSelect={() => onSelect(key)}
                    />
                  );
                })}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function InboxListRow({
  item,
  selected,
  onSelect,
}: {
  item: InboxEmail;
  selected: boolean;
  onSelect: () => void;
}) {
  const isSepim = !item.account?.includes("papelaria");
  const unread = !item.read;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full gap-3 border-b border-slate-100 px-3 py-2.5 text-left transition-colors",
        "hover:bg-white",
        selected && "border-l-[3px] border-l-secondary-blue bg-white pl-[9px]",
        !selected && unread && "bg-blue-50/40",
      )}
    >
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          isSepim
            ? "bg-indigo-100 text-indigo-800"
            : "bg-orange-100 text-orange-900",
        )}
      >
        {senderInitials(item.sender)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center justify-between gap-2">
          <span
            className={cn(
              "truncate text-sm text-slate-800",
              unread ? "font-bold" : "font-medium",
            )}
          >
            {item.sender}
          </span>
          <span className="shrink-0 text-[0.7rem] tabular-nums text-slate-400">
            {formatEmailDate(item.date)}
          </span>
        </div>
        <div className="mb-0.5 flex items-center gap-1.5">
          <span
            className={cn(
              "shrink-0 rounded px-1 py-px text-[0.6rem] font-bold uppercase",
              isSepim
                ? "bg-indigo-100/80 text-indigo-800"
                : "bg-orange-100/80 text-orange-900",
            )}
          >
            {isSepim ? "SEPIM" : "PAPELARIA"}
          </span>
          <span className="truncate text-[0.65rem] text-slate-400">
            {item.folder}
          </span>
        </div>
        <p
          className={cn(
            "truncate text-sm leading-snug text-slate-700",
            unread && "font-semibold text-slate-900",
          )}
        >
          {item.subject}
        </p>
        <div className="mt-0.5 flex items-center gap-1">
          <p className="min-w-0 flex-1 truncate text-xs text-slate-500">
            {item.preview}
          </p>
          {item.hasAttachment ? (
            <Paperclip className="size-3 shrink-0 text-slate-400" aria-hidden />
          ) : null}
          {unread ? (
            <span
              className="size-2 shrink-0 rounded-full bg-secondary-blue"
              aria-label="Não lido"
            />
          ) : null}
        </div>
      </div>
    </button>
  );
}

function PendenciaSectionHeader({
  label,
  variant,
  count,
}: {
  label: string;
  variant: "db" | "apogee";
  count: number;
}) {
  const isDb = variant === "db";
  return (
    <div
      className={cn(
        "sticky top-0 z-[2] border-b px-3 py-2.5 backdrop-blur-sm",
        isDb
          ? "border-sky-200 bg-sky-50/98 text-sky-950"
          : "border-violet-200 bg-violet-50/98 text-violet-950",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide">{label}</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[0.65rem] font-bold tabular-nums",
            isDb ? "bg-sky-100 text-sky-800" : "bg-violet-100 text-violet-800",
          )}
        >
          {count}
        </span>
      </div>
      <p className={cn("mt-0.5 text-[0.65rem]", isDb ? "text-sky-800/85" : "text-violet-800/85")}>
        {isDb
          ? "OS com andamento Encam. de Docum. no SEFOC"
          : "E-mail não lido na pasta Apogee (aprovacaografica)"}
      </p>
    </div>
  );
}

function PendenciaListRow({
  item,
  selected,
  onSelect,
}: {
  item: PendenciaOs;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full gap-3 border-b border-slate-100 px-3 py-2.5 text-left transition-colors hover:bg-white",
        selected && "border-l-[3px] border-l-secondary-blue bg-white pl-[9px]",
        !selected && "bg-sky-50/30",
      )}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary-blue/10 text-xs font-bold text-secondary-blue">
        {String(item.os).slice(-2)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-slate-800">
            {Number(item.os) >= 5000 ? "SP" : "OS"} {item.os}/{String(item.ano).slice(-2)}
          </span>
          <span className="shrink-0 text-[0.7rem] text-slate-400">
            {item.data
              ? formatEmailDate(item.data)
              : "—"}
          </span>
        </div>
        <div className="mb-0.5 flex items-center gap-1.5">
          <span className="shrink-0 rounded bg-sky-100 px-1.5 py-px text-[0.6rem] font-bold uppercase text-sky-800">
            SEFOC
          </span>
          <span className="truncate text-[0.65rem] font-medium text-sky-900/80">
            Encam. de Docum.
          </span>
        </div>
        <p className="truncate text-sm font-medium text-slate-700">
          {item.situacao}
        </p>
        <p className="truncate text-xs text-slate-500">Setor: {item.setor}</p>
      </div>
    </button>
  );
}

function ApogeePendenciaListRow({
  item,
  selected,
  onSelect,
}: {
  item: PendenciaOs;
  selected: boolean;
  onSelect: () => void;
}) {
  const displayDate = item.email_date || item.data;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full gap-3 border-b border-slate-100 px-3 py-2.5 text-left transition-colors hover:bg-white",
        selected && "border-l-[3px] border-l-violet-600 bg-white pl-[9px]",
        !selected && "bg-violet-50/35",
      )}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-800">
        {String(item.os).slice(-2)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-slate-800">
            {Number(item.os) >= 5000 ? "SP" : "OS"} {item.os}/{String(item.ano).slice(-2)}
          </span>
          <span className="shrink-0 text-[0.7rem] text-slate-400">
            {displayDate ? formatEmailDate(displayDate) : "—"}
          </span>
        </div>
        <div className="mb-0.5 flex items-center gap-1.5">
          <span className="shrink-0 rounded bg-violet-200/90 px-1.5 py-px text-[0.6rem] font-bold uppercase text-violet-900">
            Apogee
          </span>
          <span className="truncate text-[0.65rem] font-medium text-violet-900/80">
            E-mail não lido
          </span>
          {item.sender ? (
            <span className="truncate text-[0.65rem] text-slate-500">· {item.sender}</span>
          ) : null}
        </div>
        <p className="truncate text-sm font-medium text-slate-700">
          {item.subject || "E-mail sem assunto"}
        </p>
        {item.situacao ? (
          <p className="truncate text-xs text-slate-500">
            OS: {item.situacao}
            {item.setor ? ` — ${item.setor}` : ""}
          </p>
        ) : null}
      </div>
    </button>
  );
}
