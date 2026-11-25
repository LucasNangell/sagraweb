import { cn } from "@sagra/ui";
import { BookOpenCheck, ChevronDown, History, Lightbulb, Search } from "lucide-react";
import { useEffect, useState } from "react";

import type { ManutencaoHistoricoItem } from "@/api/manutencao";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

import { formatData, pessoa } from "../manutencaoUi";
import { useBuscaHistorico, useMaquinas, useSimilares } from "../useManutencaoData";
import { Badge, CodigoMaquina, EmptyState, inputClass, LoadingBlock, Modal } from "./ManutencaoShared";

/** Indicador compacto para cartões da fila. */
export function SimilaresBadge({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <Badge className="bg-yellow-100 text-yellow-900 ring-yellow-300">
      <Lightbulb className="h-3 w-3" aria-hidden />
      {count === 1 ? "1 solução semelhante" : `${count} soluções semelhantes`}
    </Badge>
  );
}

/** Cartão expansível com o passo a passo de uma manutenção já concluída. */
export function SolucaoCard({
  item,
  defaultOpen = false,
}: {
  item: ManutencaoHistoricoItem;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <article className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-slate-50"
      >
        <BookOpenCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">{item.titulo}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <span>{item.maquina_nome}</span>
            <CodigoMaquina codigo={item.maquina_codigo} />
            {item.mesma_maquina ? (
              <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-200">Mesma máquina</Badge>
            ) : null}
            <span>
              · {formatData(item.concluido_em)} · {pessoa(item.concluido_por_nome, item.concluido_por)}
            </span>
          </p>
          {item.termos.length ? (
            <p className="mt-1 flex flex-wrap gap-1">
              {item.termos.slice(0, 6).map((t) => (
                <span
                  key={t}
                  className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium text-yellow-900"
                >
                  {t}
                </span>
              ))}
            </p>
          ) : null}
        </div>
        <ChevronDown
          className={cn("mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="space-y-3 border-t border-slate-100 bg-slate-50/60 px-3 py-3">
          {item.descricao ? (
            <Bloco titulo="Problema relatado" texto={item.descricao} />
          ) : null}
          {item.diagnostico ? <Bloco titulo="Diagnóstico" texto={item.diagnostico} /> : null}
          {item.solucao_passos.length ? (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Passo a passo da solução
              </p>
              <ol className="space-y-1.5">
                {item.solucao_passos.map((passo, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-800">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white">
                      {i + 1}
                    </span>
                    <span className="whitespace-pre-line">{passo}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          {item.conclusao ? <Bloco titulo="Conclusão" texto={item.conclusao} /> : null}
        </div>
      ) : null}
    </article>
  );
}

function Bloco({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{titulo}</p>
      <p className="whitespace-pre-line text-sm text-slate-700">{texto}</p>
    </div>
  );
}

/** Painel "Soluções semelhantes" de um pedido aberto. */
export function SimilaresPanel({
  pedidoId,
  onBuscarHistorico,
}: {
  pedidoId: number;
  onBuscarHistorico?: () => void;
}) {
  const q = useSimilares(pedidoId);
  const itens = q.data ?? [];
  const [aberto, setAberto] = useState(true);
  if (q.isLoading) return <LoadingBlock label="Procurando soluções semelhantes…" />;
  if (!itens.length) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-500">
        <Lightbulb className="h-4 w-4 text-slate-400" aria-hidden />
        Nenhuma manutenção semelhante encontrada no histórico.
        {onBuscarHistorico ? (
          <button
            type="button"
            onClick={onBuscarHistorico}
            className="font-medium text-slate-700 underline-offset-2 hover:underline"
          >
            Buscar manualmente
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <section className="rounded-xl border border-yellow-300 bg-yellow-50/70">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <Lightbulb className="h-5 w-5 text-yellow-600" aria-hidden />
        <span className="flex-1">
          <span className="block text-sm font-semibold text-yellow-950">
            {itens.length === 1
              ? "Já existe 1 manutenção semelhante resolvida"
              : `Já existem ${itens.length} manutenções semelhantes resolvidas`}
          </span>
          <span className="block text-xs text-yellow-800">
            Consulte como o problema foi resolvido antes de começar.
          </span>
        </span>
        <ChevronDown
          className={cn("h-4 w-4 text-yellow-700 transition", aberto && "rotate-180")}
          aria-hidden
        />
      </button>
      {aberto ? (
        <div className="space-y-2 px-3 pb-3">
          {itens.map((it, i) => (
            <SolucaoCard key={it.id} item={it} defaultOpen={i === 0} />
          ))}
          {onBuscarHistorico ? (
            <button
              type="button"
              onClick={onBuscarHistorico}
              className="inline-flex items-center gap-1.5 px-1 text-sm font-medium text-yellow-900 underline-offset-2 hover:underline"
            >
              <Search className="h-4 w-4" aria-hidden />
              Buscar outras soluções no histórico
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Busca livre no histórico de manutenções concluídas. */
export function HistoricoBuscaDialog({
  open,
  onClose,
  maquinaIdInicial = null,
  termoInicial = "",
}: {
  open: boolean;
  onClose: () => void;
  maquinaIdInicial?: number | null;
  termoInicial?: string;
}) {
  const maquinasQ = useMaquinas(false);
  const [termo, setTermo] = useState(termoInicial);
  const [maquinaId, setMaquinaId] = useState<number | null>(maquinaIdInicial);
  useEffect(() => {
    if (!open) return;
    setTermo(termoInicial);
    setMaquinaId(maquinaIdInicial);
  }, [open, termoInicial, maquinaIdInicial]);

  const termoDebounced = useDebouncedValue(termo.trim(), 300);
  const q = useBuscaHistorico(termoDebounced, maquinaId, open);
  const itens = q.data ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Buscar no histórico de manutenções"
      description="Procure por sintomas, peças ou serviços e veja como o problema foi resolvido."
    >
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className={cn(inputClass, "pl-9")}
              placeholder="Ex.: correia patinando, rolamento, falha no alimentador…"
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              autoFocus
            />
          </div>
          <select
            className={cn(inputClass, "sm:w-60")}
            value={maquinaId ?? ""}
            onChange={(e) => setMaquinaId(e.target.value ? Number(e.target.value) : null)}
            aria-label="Filtrar por máquina"
          >
            <option value="">Todas as máquinas</option>
            {(maquinasQ.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-slate-500">
          {termoDebounced
            ? `${itens.length} resultado(s) — busca em título, descrição, diagnóstico, passos e conclusão.`
            : "Sem termo: mostrando as manutenções concluídas mais recentes."}
        </p>
        {q.isLoading ? (
          <LoadingBlock label="Buscando…" />
        ) : itens.length ? (
          <div className="space-y-2">
            {itens.map((it) => (
              <SolucaoCard key={it.id} item={it} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={History}
            title="Nenhuma manutenção encontrada"
            description="Tente outros termos ou remova o filtro de máquina."
          />
        )}
      </div>
    </Modal>
  );
}
