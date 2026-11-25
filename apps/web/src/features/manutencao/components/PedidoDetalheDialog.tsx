import { cn } from "@sagra/ui";
import { ArrowUpToLine, Ban, MessageSquarePlus, Save } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import {
  cancelarManutencaoPedido,
  comentarManutencaoPedido,
  updateManutencaoPedido,
  type ManutencaoPedido,
  type ManutencaoPrioridade,
} from "@/api/manutencao";
import { sagraBtn } from "@/components/ui/sagraBtn";

import { formatDataHora, formatDuracao, minutosDesde, pessoa } from "../manutencaoUi";
import { useManutencaoMutation, usePedido } from "../useManutencaoData";
import {
  CodigoMaquina,
  Field,
  inputClass,
  LoadingBlock,
  Modal,
  ParadaBadge,
  PrioridadeBadge,
  PrioridadeSelector,
  StatusBadge,
  Timeline,
} from "./ManutencaoShared";
import { SimilaresPanel } from "./SolucoesHistorico";

export function PedidoDetalheDialog({
  pedidoId,
  onClose,
  canManage,
  onMoverTopo,
}: {
  pedidoId: number | null;
  onClose: () => void;
  /** Gerência pode editar prioridade/descrição e cancelar. */
  canManage: boolean;
  onMoverTopo?: (id: number) => void;
}) {
  const q = usePedido(pedidoId);
  const pedido = q.data;
  return (
    <Modal
      open={pedidoId != null}
      onClose={onClose}
      size="lg"
      title={
        pedido ? (
          <span className="flex flex-wrap items-center gap-2">
            <span>Pedido #{pedido.id}</span>
            <StatusBadge status={pedido.status} />
            <PrioridadeBadge prioridade={pedido.prioridade} />
            {pedido.maquina_parada ? <ParadaBadge /> : null}
          </span>
        ) : (
          "Pedido de manutenção"
        )
      }
      description={
        pedido ? (
          <span className="flex flex-wrap items-center gap-2">
            <CodigoMaquina codigo={pedido.maquina_codigo} />
            <span className="font-medium text-slate-700">{pedido.maquina_nome}</span>
            {pedido.maquina_setor ? <span>· {pedido.maquina_setor}</span> : null}
          </span>
        ) : undefined
      }
    >
      {!pedido ? (
        <LoadingBlock />
      ) : (
        <PedidoDetalheBody
          pedido={pedido}
          canManage={canManage}
          onMoverTopo={onMoverTopo}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="w-32 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-400 sm:pt-0.5">
        {label}
      </dt>
      <dd className="min-w-0 text-sm text-slate-800">{children}</dd>
    </div>
  );
}

function PedidoDetalheBody({
  pedido,
  canManage,
  onMoverTopo,
  onClose,
}: {
  pedido: ManutencaoPedido;
  canManage: boolean;
  onMoverTopo?: (id: number) => void;
  onClose: () => void;
}) {
  const aberto = ["fila", "em_execucao", "pausado"].includes(pedido.status);
  const editavel = canManage && aberto;

  const [titulo, setTitulo] = useState(pedido.titulo);
  const [descricao, setDescricao] = useState(pedido.descricao ?? "");
  const [prioridade, setPrioridade] = useState<ManutencaoPrioridade>(pedido.prioridade);
  const [parada, setParada] = useState(pedido.maquina_parada);
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [comentario, setComentario] = useState("");

  useEffect(() => {
    setTitulo(pedido.titulo);
    setDescricao(pedido.descricao ?? "");
    setPrioridade(pedido.prioridade);
    setParada(pedido.maquina_parada);
  }, [pedido.id, pedido.titulo, pedido.descricao, pedido.prioridade, pedido.maquina_parada]);

  const dirty =
    titulo.trim() !== pedido.titulo ||
    (descricao.trim() || null) !== (pedido.descricao ?? null) ||
    prioridade !== pedido.prioridade ||
    parada !== pedido.maquina_parada;

  const salvar = useManutencaoMutation(
    () =>
      updateManutencaoPedido(pedido.id, {
        titulo: titulo.trim(),
        descricao: descricao.trim() || "",
        prioridade,
        maquina_parada: parada,
      }),
    { success: "Pedido atualizado" },
  );
  const cancelar = useManutencaoMutation(() => cancelarManutencaoPedido(pedido.id, motivo), {
    success: "Pedido cancelado",
    onSuccess: () => onClose(),
  });
  const comentar = useManutencaoMutation(
    () => comentarManutencaoPedido(pedido.id, comentario),
    { success: "Comentário adicionado", onSuccess: () => setComentario("") },
  );

  const espera =
    pedido.status === "fila"
      ? minutosDesde(pedido.solicitado_em)
      : pedido.iniciado_em && pedido.solicitado_em
        ? (new Date(pedido.iniciado_em).getTime() - new Date(pedido.solicitado_em).getTime()) / 60000
        : null;
  const fimExecucao = pedido.concluido_em
    ? new Date(pedido.concluido_em)
    : pedido.status === "em_execucao" || pedido.status === "pausado"
      ? new Date()
      : null;
  const execucao =
    pedido.iniciado_em && fimExecucao
      ? (fimExecucao.getTime() - new Date(pedido.iniciado_em).getTime()) / 60000
      : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
      <div className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Solicitação</h3>
          {editavel ? (
            <div className="space-y-3">
              <Field label="Título" htmlFor="det-titulo">
                <input
                  id="det-titulo"
                  className={inputClass}
                  value={titulo}
                  maxLength={200}
                  onChange={(e) => setTitulo(e.target.value)}
                />
              </Field>
              <Field label="Descrição" htmlFor="det-desc">
                <textarea
                  id="det-desc"
                  className={cn(inputClass, "min-h-[80px] resize-y")}
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                />
              </Field>
              <Field label="Prioridade">
                <PrioridadeSelector value={prioridade} onChange={setPrioridade} />
              </Field>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-red-600"
                  checked={parada}
                  onChange={(e) => setParada(e.target.checked)}
                />
                Máquina parada
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={sagraBtn("save", "sm")}
                  disabled={!dirty || salvar.isPending || !titulo.trim()}
                  onClick={() => salvar.mutate(undefined)}
                >
                  <Save className="h-4 w-4" aria-hidden />
                  {salvar.isPending ? "Salvando…" : "Salvar alterações"}
                </button>
                {pedido.status === "fila" && onMoverTopo && (pedido.posicao_fila ?? 1) > 1 ? (
                  <button
                    type="button"
                    className={sagraBtn("outline", "sm")}
                    onClick={() => onMoverTopo(pedido.id)}
                  >
                    <ArrowUpToLine className="h-4 w-4" aria-hidden />
                    Mover para o topo da fila
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <dl className="space-y-2">
              <InfoRow label="Título">{pedido.titulo}</InfoRow>
              {pedido.descricao ? (
                <InfoRow label="Descrição">
                  <span className="whitespace-pre-line">{pedido.descricao}</span>
                </InfoRow>
              ) : null}
            </dl>
          )}
          <dl className="space-y-2 rounded-lg bg-slate-50 p-3">
            {pedido.recorrente_titulo ? (
              <InfoRow label="Recorrente">{pedido.recorrente_titulo}</InfoRow>
            ) : null}
            <InfoRow label="Solicitado">
              {pessoa(pedido.solicitado_por_nome, pedido.solicitado_por)} ·{" "}
              {formatDataHora(pedido.solicitado_em)}
            </InfoRow>
            {pedido.status === "fila" ? (
              <InfoRow label="Posição">{pedido.posicao_fila}º na fila</InfoRow>
            ) : null}
            {espera != null ? (
              <InfoRow label={pedido.status === "fila" ? "Aguardando" : "Espera"}>
                {formatDuracao(espera)}
              </InfoRow>
            ) : null}
            {pedido.iniciado_em ? (
              <InfoRow label="Iniciado">
                {pessoa(pedido.iniciado_por_nome, pedido.iniciado_por)} ·{" "}
                {formatDataHora(pedido.iniciado_em)}
              </InfoRow>
            ) : null}
            {execucao != null ? (
              <InfoRow label="Execução">{formatDuracao(execucao)}</InfoRow>
            ) : null}
            {pedido.concluido_em ? (
              <InfoRow label="Concluído">
                {pessoa(pedido.concluido_por_nome, pedido.concluido_por)} ·{" "}
                {formatDataHora(pedido.concluido_em)}
              </InfoRow>
            ) : null}
            {pedido.cancelado_em ? (
              <InfoRow label="Cancelado">
                {pessoa(pedido.cancelado_por_nome, pedido.cancelado_por)} ·{" "}
                {formatDataHora(pedido.cancelado_em)} — {pedido.motivo_cancelamento}
              </InfoRow>
            ) : null}
          </dl>
        </section>

        {pedido.status === "pausado" && pedido.pausa_motivo ? (
          <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
            <strong>Pausado:</strong> {pedido.pausa_motivo}
          </div>
        ) : null}

        {pedido.diagnostico || pedido.solucao_passos.length || pedido.conclusao ? (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Execução</h3>
            {pedido.diagnostico ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Diagnóstico
                </p>
                <p className="whitespace-pre-line text-sm text-slate-800">{pedido.diagnostico}</p>
              </div>
            ) : null}
            {pedido.solucao_passos.length ? (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Passo a passo da solução
                </p>
                <ol className="space-y-1.5">
                  {pedido.solucao_passos.map((passo, i) => (
                    <li key={i} className="flex gap-2 text-sm text-slate-800">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">
                        {i + 1}
                      </span>
                      <span className="whitespace-pre-line">{passo}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            {pedido.conclusao ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  Conclusão
                </p>
                <p className="whitespace-pre-line text-sm text-emerald-900">{pedido.conclusao}</p>
              </div>
            ) : null}
          </section>
        ) : null}

        {editavel ? (
          <section className="rounded-lg border border-red-200 p-3">
            {!cancelando ? (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-red-700 hover:underline"
                onClick={() => setCancelando(true)}
              >
                <Ban className="h-4 w-4" aria-hidden />
                Cancelar este pedido
              </button>
            ) : (
              <div className="space-y-2">
                <Field label="Motivo do cancelamento" required htmlFor="det-motivo">
                  <input
                    id="det-motivo"
                    className={inputClass}
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Ex.: Solicitação duplicada"
                    autoFocus
                  />
                </Field>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={sagraBtn("delete", "sm")}
                    disabled={!motivo.trim() || cancelar.isPending}
                    onClick={() => cancelar.mutate(undefined)}
                  >
                    Confirmar cancelamento
                  </button>
                  <button
                    type="button"
                    className={sagraBtn("cancel", "sm")}
                    onClick={() => setCancelando(false)}
                  >
                    Voltar
                  </button>
                </div>
              </div>
            )}
          </section>
        ) : null}
      </div>

      <aside className="space-y-3">
        {aberto ? <SimilaresPanel pedidoId={pedido.id} /> : null}
        <h3 className="text-sm font-semibold text-slate-900">Linha do tempo</h3>
        <Timeline eventos={pedido.eventos ?? []} />
        <div className="flex gap-2 pt-2">
          <input
            className={inputClass}
            placeholder="Adicionar comentário…"
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && comentario.trim()) comentar.mutate(undefined);
            }}
          />
          <button
            type="button"
            className={sagraBtn("add", "icon")}
            aria-label="Adicionar comentário"
            disabled={!comentario.trim() || comentar.isPending}
            onClick={() => comentar.mutate(undefined)}
          >
            <MessageSquarePlus className="h-4 w-4" />
          </button>
        </div>
      </aside>
    </div>
  );
}
