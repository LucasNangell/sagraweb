import { cn } from "@sagra/ui";
import {
  AlertOctagon,
  ArrowDown,
  ArrowUp,
  ArrowUpToLine,
  CalendarClock,
  CheckCircle2,
  Cog,
  GripVertical,
  Hourglass,
  ListOrdered,
  PauseCircle,
  PlayCircle,
  Plus,
  Repeat,
  Search,
  Timer,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  reorderManutencaoFila,
  type ManutencaoPedido,
  type ManutencaoRecorrente,
} from "@/api/manutencao";
import { sagraBtn } from "@/components/ui/sagraBtn";

import {
  agruparPedidos,
  formatData,
  formatDuracao,
  moverItem,
  normalizarBusca,
  SITUACAO_RECORRENTE_META,
} from "../manutencaoUi";
import {
  useMaquinas,
  useManutencaoMutation,
  usePedidos,
  useRecorrentes,
  useResumo,
} from "../useManutencaoData";
import { MaquinasPanel } from "./MaquinasPanel";
import {
  Badge,
  EmptyState,
  inputClass,
  KpiCard,
  LoadingBlock,
  Panel,
  SectionTitle,
} from "./ManutencaoShared";
import { NovoPedidoDialog, type NovoPedidoPreset } from "./NovoPedidoDialog";
import { PedidoCard } from "./PedidoCard";
import { PedidoDetalheDialog } from "./PedidoDetalheDialog";
import { RecorrentesPanel } from "./RecorrentesPanel";

type View = "pedidos" | "maquinas" | "recorrentes";

export function GerenciaTab({
  maquinaCodigo,
  pedidoId,
}: {
  maquinaCodigo?: string;
  pedidoId?: number;
}) {
  const [view, setView] = useState<View>("pedidos");
  const [novoPreset, setNovoPreset] = useState<NovoPedidoPreset | null>(null);
  const [detalheId, setDetalheId] = useState<number | null>(pedidoId ?? null);
  useEffect(() => {
    if (pedidoId) setDetalheId(pedidoId);
  }, [pedidoId]);
  const maquinasQ = useMaquinas(false);

  const maquinaUrl = useMemo(
    () => (maquinaCodigo ? maquinasQ.data?.find((m) => m.codigo === maquinaCodigo) ?? null : null),
    [maquinaCodigo, maquinasQ.data],
  );
  const [maquinaFiltro, setMaquinaFiltro] = useState<number | null>(null);
  useEffect(() => {
    if (maquinaUrl) setMaquinaFiltro(maquinaUrl.id);
  }, [maquinaUrl]);

  const abrirNovo = (preset: NovoPedidoPreset = {}) => setNovoPreset(preset);

  const pedidosQ = usePedidos(30);
  const reorderTopo = useManutencaoMutation(reorderManutencaoFila, {
    success: "Pedido movido para o topo da fila",
  });
  const moverTopo = (id: number) => {
    const fila = agruparPedidos(pedidosQ.data ?? []).fila.map((p) => p.id);
    const idx = fila.indexOf(id);
    if (idx > 0) reorderTopo.mutate(moverItem(fila, idx, 0));
  };

  const views: Array<{ id: View; label: string; icon: typeof Cog }> = [
    { id: "pedidos", label: "Pedidos", icon: ListOrdered },
    { id: "maquinas", label: "Máquinas", icon: Cog },
    { id: "recorrentes", label: "Recorrentes", icon: Repeat },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
          {views.map((v) => {
            const Icon = v.icon;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setView(v.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
                  view === v.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {v.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className={sagraBtn("add", "md")}
          onClick={() => abrirNovo({ maquinaId: maquinaFiltro })}
        >
          <Plus className="h-4 w-4" aria-hidden />
          Nova solicitação
        </button>
      </div>

      {view === "pedidos" ? (
        <PedidosView
          maquinaFiltro={maquinaFiltro}
          setMaquinaFiltro={setMaquinaFiltro}
          onAbrir={setDetalheId}
          onSolicitarRecorrente={(r) =>
            abrirNovo({ maquinaId: r.maquina_id ?? null, recorrenteId: r.id })
          }
        />
      ) : null}
      {view === "maquinas" ? (
        <MaquinasPanel
          onSolicitar={(m) => abrirNovo({ maquinaId: m.id })}
          onAbrirPedido={setDetalheId}
        />
      ) : null}
      {view === "recorrentes" ? (
        <RecorrentesPanel
          onSolicitar={(r) => abrirNovo({ maquinaId: r.maquina_id ?? null, recorrenteId: r.id })}
        />
      ) : null}

      <NovoPedidoDialog
        open={novoPreset != null}
        preset={novoPreset}
        onClose={() => setNovoPreset(null)}
      />
      <PedidoDetalheDialog
        pedidoId={detalheId}
        onClose={() => setDetalheId(null)}
        canManage
        onMoverTopo={moverTopo}
      />
    </div>
  );
}

function PedidosView({
  maquinaFiltro,
  setMaquinaFiltro,
  onAbrir,
  onSolicitarRecorrente,
}: {
  maquinaFiltro: number | null;
  setMaquinaFiltro: (id: number | null) => void;
  onAbrir: (id: number) => void;
  onSolicitarRecorrente: (r: ManutencaoRecorrente) => void;
}) {
  const resumoQ = useResumo();
  const pedidosQ = usePedidos(30);
  const recorrentesQ = useRecorrentes(false);
  const maquinasQ = useMaquinas(false);
  const [busca, setBusca] = useState("");
  const [mostrarCancelados, setMostrarCancelados] = useState(false);

  const filtrados = useMemo(() => {
    const q = normalizarBusca(busca);
    return (pedidosQ.data ?? []).filter((p) => {
      if (maquinaFiltro && p.maquina_id !== maquinaFiltro) return false;
      if (!q) return true;
      return normalizarBusca(
        `${p.id} ${p.maquina_nome ?? ""} ${p.maquina_codigo ?? ""} ${p.titulo} ${p.descricao ?? ""}`,
      ).includes(q);
    });
  }, [busca, maquinaFiltro, pedidosQ.data]);

  const { fila, execucao, finalizados } = useMemo(() => agruparPedidos(filtrados), [filtrados]);
  const finalizadosVisiveis = mostrarCancelados
    ? finalizados
    : finalizados.filter((p) => p.status === "concluido");
  const filtroAtivo = Boolean(busca.trim() || maquinaFiltro);

  const preventivas = (recorrentesQ.data ?? []).filter(
    (r) => r.situacao === "vencida" || r.situacao === "vence_em_breve",
  );
  const r = resumoQ.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard icon={Hourglass} label="Na fila" value={r?.fila ?? "–"} tone="amber" />
        <KpiCard icon={PlayCircle} label="Em execução" value={r?.em_execucao ?? "–"} tone="blue" />
        <KpiCard icon={PauseCircle} label="Pausados" value={r?.pausado ?? "–"} tone="violet" />
        <KpiCard
          icon={AlertOctagon}
          label="Máquinas paradas"
          value={r?.maquinas_paradas ?? "–"}
          tone={r?.maquinas_paradas ? "red" : "slate"}
        />
        <KpiCard
          icon={CheckCircle2}
          label="Concluídos (30 dias)"
          value={r?.concluidos_30d ?? "–"}
          tone="emerald"
        />
        <KpiCard
          icon={Timer}
          label="Tempo médio de execução"
          value={
            <span className="text-lg">{formatDuracao(r?.tempo_medio_execucao_min ?? null)}</span>
          }
          hint={`Espera média: ${formatDuracao(r?.tempo_medio_espera_min ?? null)}`}
        />
      </div>

      {preventivas.length ? (
        <Panel className="border-amber-200 bg-amber-50/40">
          <SectionTitle
            icon={CalendarClock}
            title="Manutenções recorrentes a programar"
            count={preventivas.length}
            description="Preventivas vencidas ou que vencem nos próximos 7 dias."
          />
          <ul className="divide-y divide-amber-100">
            {preventivas.map((rec) => (
              <li key={rec.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800">{rec.titulo}</p>
                  <p className="text-xs text-slate-500">
                    {rec.maquina_nome} · a cada {rec.periodicidade_dias} dias · prevista para{" "}
                    {formatData(rec.proxima_em)}
                  </p>
                </div>
                {rec.situacao ? (
                  <Badge className={SITUACAO_RECORRENTE_META[rec.situacao].badge}>
                    {rec.situacao === "vencida"
                      ? `Vencida há ${Math.abs(rec.dias_restantes ?? 0)} d`
                      : `Vence em ${rec.dias_restantes ?? 0} d`}
                  </Badge>
                ) : null}
                <button
                  type="button"
                  className={sagraBtn("add", "sm")}
                  onClick={() => onSolicitarRecorrente(rec)}
                >
                  Solicitar
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className={cn(inputClass, "py-2 pl-9")}
            placeholder="Buscar pedido, máquina ou nº…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <select
          className={cn(inputClass, "w-auto py-2")}
          value={maquinaFiltro ?? ""}
          onChange={(e) => setMaquinaFiltro(e.target.value ? Number(e.target.value) : null)}
          aria-label="Filtrar por máquina"
        >
          <option value="">Todas as máquinas</option>
          {(maquinasQ.data ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.nome}
            </option>
          ))}
        </select>
        {filtroAtivo ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
            onClick={() => {
              setBusca("");
              setMaquinaFiltro(null);
            }}
          >
            <X className="h-4 w-4" aria-hidden />
            Limpar filtros
          </button>
        ) : null}
      </div>

      {pedidosQ.isLoading ? (
        <LoadingBlock label="Carregando pedidos…" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <FilaColumn
            fila={fila}
            reorderEnabled={!filtroAtivo}
            onAbrir={onAbrir}
            totalFila={r?.fila}
          />
          <Panel className="flex min-h-[12rem] flex-col">
            <SectionTitle
              icon={PlayCircle}
              title="Em execução"
              count={execucao.length}
              description="Serviços iniciados pelos operadores"
            />
            <div className="flex-1 space-y-2 p-3">
              {execucao.length ? (
                execucao.map((p) => <PedidoCard key={p.id} pedido={p} onAbrir={onAbrir} />)
              ) : (
                <EmptyState
                  icon={PlayCircle}
                  title="Nenhum serviço em andamento"
                  description="Quando um operador iniciar um pedido, ele aparece aqui."
                />
              )}
            </div>
          </Panel>
          <Panel className="flex min-h-[12rem] flex-col">
            <SectionTitle
              icon={CheckCircle2}
              title="Finalizados (30 dias)"
              count={finalizadosVisiveis.length}
              action={
                <label className="flex items-center gap-1.5 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5"
                    checked={mostrarCancelados}
                    onChange={(e) => setMostrarCancelados(e.target.checked)}
                  />
                  Cancelados
                </label>
              }
            />
            <div className="max-h-[60vh] flex-1 space-y-2 overflow-y-auto p-3">
              {finalizadosVisiveis.length ? (
                finalizadosVisiveis.map((p) => (
                  <PedidoCard key={p.id} pedido={p} onAbrir={onAbrir} compact />
                ))
              ) : (
                <EmptyState icon={CheckCircle2} title="Nada finalizado no período" />
              )}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

function FilaColumn({
  fila,
  reorderEnabled,
  onAbrir,
  totalFila,
}: {
  fila: ManutencaoPedido[];
  reorderEnabled: boolean;
  onAbrir: (id: number) => void;
  totalFila?: number;
}) {
  const [ordem, setOrdem] = useState<number[]>(() => fila.map((p) => p.id));
  const [dragId, setDragId] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const serverKey = fila.map((p) => `${p.id}:${p.posicao_fila}`).join(",");

  useEffect(() => {
    if (dragId == null) setOrdem(fila.map((p) => p.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  const byId = useMemo(() => new Map(fila.map((p) => [p.id, p])), [fila]);
  const itens = ordem.map((id) => byId.get(id)).filter(Boolean) as ManutencaoPedido[];

  const reorder = useManutencaoMutation(reorderManutencaoFila, { success: "Fila atualizada" });

  const aplicar = (next: number[]) => {
    setOrdem(next);
    reorder.mutate(next);
  };
  const mover = (from: number, to: number) => {
    if (from === to) return;
    aplicar(moverItem(ordem, from, to));
  };

  return (
    <Panel className="flex min-h-[12rem] flex-col border-amber-200">
      <SectionTitle
        icon={Hourglass}
        title="Fila de atendimento"
        count={itens.length}
        description={
          reorderEnabled
            ? "Arraste ou use as setas para definir a ordem de atendimento"
            : `Limpe os filtros para reordenar (${totalFila ?? itens.length} na fila)`
        }
      />
      <ol className="flex-1 space-y-2 p-3">
        {itens.length ? (
          itens.map((p, idx) => (
            <li
              key={p.id}
              draggable={reorderEnabled}
              onDragStart={(e) => {
                setDragId(p.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (dragId == null) return;
                e.preventDefault();
                setOverIdx(idx);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverIdx(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId != null) mover(ordem.indexOf(dragId), idx);
                setDragId(null);
                setOverIdx(null);
              }}
              className={cn(
                "group relative flex items-stretch gap-2 rounded-lg transition",
                dragId === p.id && "opacity-40",
                overIdx === idx && dragId !== p.id && "ring-2 ring-sky-400 ring-offset-2",
              )}
            >
              <div className="flex w-8 shrink-0 flex-col items-center justify-center gap-0.5">
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                    idx === 0 ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-600",
                  )}
                  title={`${idx + 1}º na fila`}
                >
                  {idx + 1}
                </span>
                {reorderEnabled ? (
                  <GripVertical
                    className="hidden h-4 w-4 cursor-grab text-slate-300 group-hover:text-slate-500 md:block"
                    aria-hidden
                  />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <PedidoCard pedido={p} onAbrir={onAbrir} hideStatus />
              </div>
              {reorderEnabled ? (
                <div className="flex shrink-0 flex-col justify-center gap-0.5">
                  <IconBtn
                    label="Mover para o topo"
                    disabled={idx === 0 || reorder.isPending}
                    onClick={() => mover(idx, 0)}
                  >
                    <ArrowUpToLine className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn
                    label="Subir"
                    disabled={idx === 0 || reorder.isPending}
                    onClick={() => mover(idx, idx - 1)}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn
                    label="Descer"
                    disabled={idx === itens.length - 1 || reorder.isPending}
                    onClick={() => mover(idx, idx + 1)}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </IconBtn>
                </div>
              ) : null}
            </li>
          ))
        ) : (
          <EmptyState
            icon={CheckCircle2}
            title="Fila vazia"
            description="Nenhuma máquina aguardando manutenção."
          />
        )}
      </ol>
    </Panel>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-25"
    >
      {children}
    </button>
  );
}
