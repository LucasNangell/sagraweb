import { cn } from "@sagra/ui";
import {
  AlertOctagon,
  BellRing,
  CheckCircle2,
  ChevronDown,
  Clock,
  Hourglass,
  PlayCircle,
  Repeat,
  Search,
  User,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { iniciarManutencaoPedido, type ManutencaoPedido } from "@/api/manutencao";
import { sagraBtn } from "@/components/ui/sagraBtn";

import {
  agruparPedidos,
  cleanPonto,
  pessoa,
  PRIORIDADE_META,
  tempoRelativo,
} from "../manutencaoUi";
import { useMaquinas, useManutencaoMutation, usePedidos } from "../useManutencaoData";
import { ExecucaoDialog } from "./ExecucaoDialog";
import { ManutencaoNotificacoesCard } from "./ManutencaoNotificacoesCard";
import {
  Badge,
  CodigoMaquina,
  EmptyState,
  LoadingBlock,
  ParadaBadge,
  PrioridadeBadge,
  StatusBadge,
} from "./ManutencaoShared";
import { PedidoDetalheDialog } from "./PedidoDetalheDialog";
import { HistoricoBuscaDialog, SimilaresBadge } from "./SolucoesHistorico";

export function OperadorTab({
  maquinaCodigo,
  pedidoId,
  ponto,
}: {
  maquinaCodigo?: string;
  pedidoId?: number;
  ponto: string;
}) {
  const pedidosQ = usePedidos(7, true);
  const maquinasQ = useMaquinas(false);
  const [execId, setExecId] = useState<number | null>(null);
  const [detalheId, setDetalheId] = useState<number | null>(null);
  // Aberto pela notificação: serviço meu em andamento → execução; senão, detalhes.
  const pedidoAberto = useRef<number | null>(null);
  useEffect(() => {
    if (!pedidoId || pedidoAberto.current === pedidoId || !pedidosQ.data) return;
    pedidoAberto.current = pedidoId;
    const alvo = pedidosQ.data.find((p) => p.id === pedidoId);
    const meu =
      alvo &&
      (alvo.status === "em_execucao" || alvo.status === "pausado") &&
      cleanPonto(alvo.iniciado_por) === cleanPonto(ponto);
    if (meu) setExecId(pedidoId);
    else setDetalheId(pedidoId);
  }, [pedidoId, pedidosQ.data, ponto]);
  const [verConcluidos, setVerConcluidos] = useState(false);
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [filtroCodigo, setFiltroCodigo] = useState<string | undefined>(maquinaCodigo);

  const maquinaFiltro = filtroCodigo
    ? (maquinasQ.data ?? []).find((m) => m.codigo === filtroCodigo) ?? null
    : null;

  const me = cleanPonto(ponto);
  const { fila, execucao, finalizados } = useMemo(() => {
    const all = (pedidosQ.data ?? []).filter(
      (p) => !filtroCodigo || p.maquina_codigo === filtroCodigo,
    );
    return agruparPedidos(all);
  }, [pedidosQ.data, filtroCodigo]);

  const meus = execucao.filter((p) => cleanPonto(p.iniciado_por) === me);
  const outros = execucao.filter((p) => cleanPonto(p.iniciado_por) !== me);
  const concluidos = finalizados.filter((p) => p.status === "concluido");
  const maquinasAguardando = new Set(fila.map((p) => p.maquina_id)).size;
  const urgentes = fila.filter((p) => p.prioridade === "urgente").length;
  const paradas = new Set(
    [...fila, ...execucao].filter((p) => p.maquina_parada).map((p) => p.maquina_id),
  ).size;

  const iniciar = useManutencaoMutation(iniciarManutencaoPedido, {
    success: "Serviço iniciado — registre o diagnóstico e os passos",
    onSuccess: (p) => setExecId(p.id),
  });

  if (pedidosQ.isLoading) return <LoadingBlock label="Carregando fila de manutenção…" />;

  return (
    <div className="flex flex-col gap-4">
      {maquinaFiltro || filtroCodigo ? (
        <div className="flex items-center gap-3 rounded-xl border border-slate-900 bg-slate-900 px-4 py-3 text-white">
          <Wrench className="h-5 w-5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wide text-slate-300">Máquina selecionada</p>
            <p className="truncate font-semibold">
              {maquinaFiltro?.nome ?? filtroCodigo}{" "}
              <span className="font-mono text-xs text-slate-300">{filtroCodigo}</span>
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white"
            onClick={() => setFiltroCodigo(undefined)}
            aria-label="Ver todas as máquinas"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      ) : null}

      <ManutencaoNotificacoesCard />

      <AlertaFila
        total={fila.length}
        maquinas={maquinasAguardando}
        urgentes={urgentes}
        paradas={paradas}
      />

      <button
        type="button"
        onClick={() => setBuscaAberta(true)}
        className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-slate-400 sm:w-auto sm:self-start"
      >
        <Search className="h-5 w-5 text-slate-500" aria-hidden />
        <span>
          <span className="block text-sm font-semibold text-slate-800">
            Buscar soluções no histórico
          </span>
          <span className="block text-xs text-slate-500">
            Veja como problemas parecidos já foram resolvidos
          </span>
        </span>
      </button>

      {meus.length ? (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            <User className="h-4 w-4" aria-hidden />
            Meus serviços em andamento
          </h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {meus.map((p) => (
              <ServicoCard key={p.id} pedido={p} destaque onAbrir={() => setExecId(p.id)} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          <Hourglass className="h-4 w-4" aria-hidden />
          Fila de atendimento
          <span className="rounded-full bg-slate-200 px-2 text-xs text-slate-700">{fila.length}</span>
        </h2>
        {fila.length ? (
          <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {fila.map((p, idx) => (
              <li key={p.id}>
                <FilaCard
                  pedido={p}
                  posicao={idx + 1}
                  iniciando={iniciar.isPending && iniciar.variables === p.id}
                  bloqueado={iniciar.isPending}
                  onIniciar={() => iniciar.mutate(p.id)}
                  onDetalhes={() => setDetalheId(p.id)}
                />
              </li>
            ))}
          </ol>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white">
            <EmptyState
              icon={CheckCircle2}
              title="Nenhuma máquina aguardando manutenção"
              description="Você será notificado quando a gerência solicitar um novo serviço."
            />
          </div>
        )}
      </section>

      {outros.length ? (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            <PlayCircle className="h-4 w-4" aria-hidden />
            Em execução por outros operadores
          </h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {outros.map((p) => (
              <ServicoCard key={p.id} pedido={p} onAbrir={() => setExecId(p.id)} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setVerConcluidos((v) => !v)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-slate-700"
          aria-expanded={verConcluidos}
        >
          <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
          Concluídos nos últimos 7 dias
          <span className="rounded-full bg-slate-100 px-2 text-xs">{concluidos.length}</span>
          <ChevronDown
            className={cn("ml-auto h-4 w-4 transition", verConcluidos && "rotate-180")}
            aria-hidden
          />
        </button>
        {verConcluidos ? (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {concluidos.length ? (
              concluidos.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setDetalheId(p.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {p.maquina_nome} — {p.titulo}
                      </p>
                      <p className="text-xs text-slate-500">
                        {pessoa(p.concluido_por_nome, p.concluido_por)} ·{" "}
                        {tempoRelativo(p.concluido_em)}
                      </p>
                    </div>
                    <CodigoMaquina codigo={p.maquina_codigo} />
                  </button>
                </li>
              ))
            ) : (
              <li className="px-4 py-6 text-center text-sm text-slate-500">
                Nenhum serviço concluído no período.
              </li>
            )}
          </ul>
        ) : null}
      </section>

      <ExecucaoDialog pedidoId={execId} ponto={ponto} onClose={() => setExecId(null)} />
      <HistoricoBuscaDialog
        open={buscaAberta}
        onClose={() => setBuscaAberta(false)}
        maquinaIdInicial={maquinaFiltro?.id ?? null}
      />
      <PedidoDetalheDialog
        pedidoId={detalheId}
        onClose={() => setDetalheId(null)}
        canManage={false}
      />
    </div>
  );
}

function AlertaFila({
  total,
  maquinas,
  urgentes,
  paradas,
}: {
  total: number;
  maquinas: number;
  urgentes: number;
  paradas: number;
}) {
  if (!total) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" aria-hidden />
        <div>
          <p className="font-semibold text-emerald-900">Tudo em dia</p>
          <p className="text-sm text-emerald-800">Nenhuma máquina aguardando manutenção.</p>
        </div>
      </div>
    );
  }
  const grave = urgentes > 0 || paradas > 0;
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border px-4 py-3",
        grave ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50",
      )}
      role="status"
    >
      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center">
        <span
          className={cn(
            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-30",
            grave ? "bg-red-400" : "bg-amber-400",
          )}
        />
        <span
          className={cn(
            "relative flex h-10 w-10 items-center justify-center rounded-full text-white",
            grave ? "bg-red-600" : "bg-amber-500",
          )}
        >
          <BellRing className="h-5 w-5" aria-hidden />
        </span>
      </span>
      <div className="min-w-0">
        <p className={cn("font-semibold", grave ? "text-red-900" : "text-amber-900")}>
          {maquinas === 1
            ? "1 máquina precisa de manutenção"
            : `${maquinas} máquinas precisam de manutenção`}
        </p>
        <p className={cn("text-sm", grave ? "text-red-800" : "text-amber-800")}>
          {total} pedido(s) na fila
          {urgentes ? ` · ${urgentes} urgente(s)` : ""}
          {paradas ? ` · ${paradas} máquina(s) parada(s)` : ""}
        </p>
      </div>
    </div>
  );
}

function FilaCard({
  pedido,
  posicao,
  iniciando,
  bloqueado,
  onIniciar,
  onDetalhes,
}: {
  pedido: ManutencaoPedido;
  posicao: number;
  iniciando: boolean;
  bloqueado: boolean;
  onIniciar: () => void;
  onDetalhes: () => void;
}) {
  const meta = PRIORIDADE_META[pedido.prioridade];
  const proximo = posicao === 1;
  return (
    <article
      className={cn(
        "relative flex h-full flex-col overflow-hidden rounded-xl border bg-white shadow-sm",
        proximo ? "border-amber-400 ring-1 ring-amber-400" : "border-slate-200",
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1.5", meta.bar)} aria-hidden />
      <button type="button" onClick={onDetalhes} className="flex-1 space-y-2 p-4 pl-5 text-left">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold",
              proximo ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-600",
            )}
          >
            {posicao}º
          </span>
          <div className="min-w-0 flex-1">
            {proximo ? (
              <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700">
                Próximo da fila
              </p>
            ) : null}
            <p className="truncate text-base font-semibold text-slate-900">{pedido.maquina_nome}</p>
            <p className="text-xs text-slate-500">
              {pedido.maquina_codigo}
              {pedido.maquina_setor ? ` · ${pedido.maquina_setor}` : ""}
            </p>
          </div>
        </div>
        <p className="text-sm font-medium text-slate-800">{pedido.titulo}</p>
        {pedido.descricao ? (
          <p className="line-clamp-2 text-sm text-slate-600">{pedido.descricao}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5">
          <PrioridadeBadge prioridade={pedido.prioridade} />
          {pedido.maquina_parada ? <ParadaBadge /> : null}
          {pedido.recorrente_id ? (
            <Badge className="bg-slate-50 text-slate-600 ring-slate-200">
              <Repeat className="h-3 w-3" aria-hidden />
              Recorrente
            </Badge>
          ) : null}
          <SimilaresBadge count={pedido.similares_count} />
          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            <Clock className="h-3 w-3" aria-hidden />
            {tempoRelativo(pedido.solicitado_em)}
          </span>
        </div>
      </button>
      <div className="border-t border-slate-100 p-3 pl-5">
        <button
          type="button"
          className={cn(sagraBtn(proximo ? "confirm" : "next", "lg"), "w-full justify-center")}
          onClick={onIniciar}
          disabled={bloqueado}
        >
          <PlayCircle className="h-5 w-5" aria-hidden />
          {iniciando ? "Iniciando…" : "Iniciar serviço"}
        </button>
      </div>
    </article>
  );
}

function ServicoCard({
  pedido,
  destaque,
  onAbrir,
}: {
  pedido: ManutencaoPedido;
  destaque?: boolean;
  onAbrir: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      className={cn(
        "flex h-full w-full flex-col gap-2 rounded-xl border p-4 text-left shadow-sm transition hover:shadow",
        destaque
          ? pedido.status === "pausado"
            ? "border-violet-300 bg-violet-50"
            : "border-blue-300 bg-blue-50"
          : "border-slate-200 bg-white",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <StatusBadge status={pedido.status} />
        {pedido.maquina_parada ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700">
            <AlertOctagon className="h-3.5 w-3.5" aria-hidden />
            Parada
          </span>
        ) : null}
      </div>
      <div>
        <p className="text-base font-semibold text-slate-900">{pedido.maquina_nome}</p>
        <p className="text-sm text-slate-700">{pedido.titulo}</p>
      </div>
      {pedido.status === "pausado" && pedido.pausa_motivo ? (
        <p className="text-xs text-violet-800">Pausado: {pedido.pausa_motivo}</p>
      ) : null}
      {pedido.similares_count ? (
        <div>
          <SimilaresBadge count={pedido.similares_count} />
        </div>
      ) : null}
      <p className="mt-auto text-xs text-slate-500">
        {destaque ? "Iniciado" : pessoa(pedido.iniciado_por_nome, pedido.iniciado_por)}{" "}
        {tempoRelativo(pedido.iniciado_em)} · {pedido.solucao_passos.length} passo(s) registrado(s)
      </p>
      {destaque ? (
        <span className={cn(sagraBtn("next", "md"), "mt-1 w-full justify-center")}>
          Continuar serviço
        </span>
      ) : null}
    </button>
  );
}
