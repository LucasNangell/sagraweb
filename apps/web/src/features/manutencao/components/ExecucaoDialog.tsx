import { cn } from "@sagra/ui";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  CornerUpLeft,
  PauseCircle,
  PlayCircle,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  concluirManutencaoPedido,
  devolverManutencaoPedido,
  iniciarManutencaoPedido,
  pausarManutencaoPedido,
  salvarProgressoManutencao,
  type ManutencaoPedido,
} from "@/api/manutencao";
import { sagraBtn } from "@/components/ui/sagraBtn";

import { cleanPonto, formatDataHora, moverItem, pessoa, tempoRelativo } from "../manutencaoUi";
import { useManutencaoMutation, usePedido } from "../useManutencaoData";
import {
  CodigoMaquina,
  Field,
  inputClass,
  LoadingBlock,
  Modal,
  ParadaBadge,
  PrioridadeBadge,
  StatusBadge,
  Timeline,
} from "./ManutencaoShared";
import { HistoricoBuscaDialog, SimilaresPanel } from "./SolucoesHistorico";

type Modo = "editar" | "pausar" | "concluir" | "devolver";

const MOTIVOS_PAUSA = [
  "Aguardando peça",
  "Aguardando técnico externo",
  "Fim do turno",
  "Máquina liberada para produção temporariamente",
];

export function ExecucaoDialog({
  pedidoId,
  ponto,
  onClose,
}: {
  pedidoId: number | null;
  ponto: string;
  onClose: () => void;
}) {
  const q = usePedido(pedidoId);
  const pedido = q.data;
  const dirtyRef = useRef(false);

  const fechar = () => {
    if (
      dirtyRef.current &&
      !window.confirm("Há alterações não salvas no diagnóstico/passos. Sair mesmo assim?")
    ) {
      return;
    }
    dirtyRef.current = false;
    onClose();
  };

  return (
    <Modal
      open={pedidoId != null}
      onClose={fechar}
      size="xl"
      title={
        pedido ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate">{pedido.maquina_nome}</span>
            <StatusBadge status={pedido.status} />
          </span>
        ) : (
          "Execução da manutenção"
        )
      }
      description={
        pedido ? (
          <span className="flex flex-wrap items-center gap-2">
            <CodigoMaquina codigo={pedido.maquina_codigo} />
            Pedido #{pedido.id}
            <PrioridadeBadge prioridade={pedido.prioridade} />
            {pedido.maquina_parada ? <ParadaBadge /> : null}
          </span>
        ) : undefined
      }
    >
      {!pedido ? (
        <LoadingBlock />
      ) : (
        <ExecucaoBody
          key={pedido.id}
          pedido={pedido}
          ponto={ponto}
          onDirtyChange={(d) => {
            dirtyRef.current = d;
          }}
          onDone={() => {
            dirtyRef.current = false;
            onClose();
          }}
        />
      )}
    </Modal>
  );
}

function ExecucaoBody({
  pedido,
  ponto,
  onDirtyChange,
  onDone,
}: {
  pedido: ManutencaoPedido;
  ponto: string;
  onDirtyChange: (dirty: boolean) => void;
  onDone: () => void;
}) {
  const [diagnostico, setDiagnostico] = useState(pedido.diagnostico ?? "");
  const [passos, setPassos] = useState<string[]>(pedido.solucao_passos);
  const [modo, setModo] = useState<Modo>("editar");
  const [motivo, setMotivo] = useState("");
  const [conclusao, setConclusao] = useState("");
  const [liberada, setLiberada] = useState(false);
  const [buscaAberta, setBuscaAberta] = useState(false);

  const ativo = pedido.status === "em_execucao" || pedido.status === "pausado";
  const pausado = pedido.status === "pausado";
  const meu = cleanPonto(pedido.iniciado_por) === cleanPonto(ponto);

  const dirty =
    (diagnostico.trim() || "") !== (pedido.diagnostico ?? "").trim() ||
    JSON.stringify(passos.map((p) => p.trim()).filter(Boolean)) !==
      JSON.stringify(pedido.solucao_passos);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const passosLimpos = () => passos.map((p) => p.trim()).filter(Boolean);

  const salvar = useManutencaoMutation(
    () =>
      salvarProgressoManutencao(pedido.id, {
        diagnostico: diagnostico.trim(),
        passos: passosLimpos(),
      }),
    { success: "Progresso salvo" },
  );
  const pausar = useManutencaoMutation(
    async () => {
      if (dirty) {
        await salvarProgressoManutencao(pedido.id, {
          diagnostico: diagnostico.trim(),
          passos: passosLimpos(),
        });
      }
      return pausarManutencaoPedido(pedido.id, motivo.trim());
    },
    { success: "Serviço pausado", onSuccess: () => setModo("editar") },
  );
  const retomar = useManutencaoMutation(() => iniciarManutencaoPedido(pedido.id), {
    success: "Serviço retomado",
  });
  const devolver = useManutencaoMutation(
    () => devolverManutencaoPedido(pedido.id, motivo.trim() || undefined),
    { success: "Pedido devolvido ao topo da fila", onSuccess: onDone },
  );
  const concluir = useManutencaoMutation(
    () =>
      concluirManutencaoPedido(pedido.id, {
        conclusao: conclusao.trim(),
        diagnostico: diagnostico.trim(),
        passos: passosLimpos(),
      }),
    { success: "Manutenção concluída! Quem solicitou foi notificado.", onSuccess: onDone },
  );

  const busy =
    salvar.isPending || pausar.isPending || retomar.isPending || devolver.isPending || concluir.isPending;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)]">
      <div className="space-y-5">
        {/* Solicitação */}
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            O que foi solicitado
          </p>
          <p className="mt-1 text-base font-semibold text-slate-900">{pedido.titulo}</p>
          {pedido.descricao ? (
            <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{pedido.descricao}</p>
          ) : null}
          <p className="mt-2 text-xs text-slate-500">
            {pessoa(pedido.solicitado_por_nome, pedido.solicitado_por)} ·{" "}
            {formatDataHora(pedido.solicitado_em)}
            {pedido.iniciado_em
              ? ` · iniciado ${tempoRelativo(pedido.iniciado_em)} por ${
                  meu ? "você" : pessoa(pedido.iniciado_por_nome, pedido.iniciado_por)
                }`
              : ""}
          </p>
        </section>

        {ativo ? (
          <SimilaresPanel pedidoId={pedido.id} onBuscarHistorico={() => setBuscaAberta(true)} />
        ) : null}

        {pausado ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-violet-300 bg-violet-50 p-4">
            <PauseCircle className="h-6 w-6 text-violet-600" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-violet-900">Serviço pausado</p>
              <p className="text-sm text-violet-800">{pedido.pausa_motivo}</p>
            </div>
            <button
              type="button"
              className={sagraBtn("confirm", "md")}
              disabled={busy}
              onClick={() => retomar.mutate(undefined)}
            >
              <PlayCircle className="h-4 w-4" aria-hidden />
              Retomar serviço
            </button>
          </div>
        ) : null}

        {/* 1. Diagnóstico */}
        <section className="space-y-2">
          <StepHeader n={1} title="Diagnóstico do problema" />
          <textarea
            className={cn(inputClass, "min-h-[110px] resize-y")}
            value={diagnostico}
            onChange={(e) => setDiagnostico(e.target.value)}
            disabled={!ativo}
            placeholder="Descreva com mais detalhes o que foi encontrado: causa, peças afetadas, medições…"
          />
        </section>

        {/* 2. Passos */}
        <section className="space-y-2">
          <StepHeader
            n={2}
            title="Passo a passo da solução"
            hint="Registre cada ação executada, na ordem. Isso vira o histórico técnico da máquina."
          />
          <PassosEditor passos={passos} onChange={setPassos} disabled={!ativo} />
        </section>

        {ativo && modo === "editar" ? (
          <div className="sticky bottom-0 -mx-5 flex flex-col gap-2 border-t border-slate-200 bg-white/95 px-5 py-3 backdrop-blur sm:flex-row sm:flex-wrap">
            <button
              type="button"
              className={cn(sagraBtn("save", "lg"), "justify-center")}
              disabled={!dirty || busy}
              onClick={() => salvar.mutate(undefined)}
            >
              <Save className="h-4 w-4" aria-hidden />
              {salvar.isPending ? "Salvando…" : dirty ? "Salvar progresso" : "Progresso salvo"}
            </button>
            <button
              type="button"
              className={cn(sagraBtn("success", "lg"), "justify-center sm:ml-auto")}
              disabled={busy}
              onClick={() => setModo("concluir")}
            >
              <CheckCircle2 className="h-5 w-5" aria-hidden />
              Concluir serviço
            </button>
            <div className="flex gap-2">
              {!pausado ? (
                <button
                  type="button"
                  className={cn(sagraBtn("pending", "md"), "flex-1 justify-center")}
                  disabled={busy}
                  onClick={() => {
                    setMotivo("");
                    setModo("pausar");
                  }}
                >
                  <PauseCircle className="h-4 w-4" aria-hidden />
                  Pausar
                </button>
              ) : null}
              <button
                type="button"
                className={cn(sagraBtn("outline", "md"), "flex-1 justify-center")}
                disabled={busy}
                onClick={() => {
                  setMotivo("");
                  setModo("devolver");
                }}
              >
                <CornerUpLeft className="h-4 w-4" aria-hidden />
                Devolver à fila
              </button>
            </div>
          </div>
        ) : null}

        {modo === "pausar" ? (
          <ActionBox
            tone="violet"
            title="Pausar serviço"
            description="O pedido continua com você e pode ser retomado depois."
            onCancel={() => setModo("editar")}
            confirmLabel={pausar.isPending ? "Pausando…" : "Confirmar pausa"}
            confirmDisabled={!motivo.trim() || busy}
            onConfirm={() => pausar.mutate(undefined)}
          >
            <div className="flex flex-wrap gap-1.5">
              {MOTIVOS_PAUSA.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMotivo(m)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium",
                    motivo === m
                      ? "border-violet-700 bg-violet-700 text-white"
                      : "border-violet-200 bg-white text-violet-800",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
            <input
              className={inputClass}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Motivo da pausa"
              maxLength={500}
            />
          </ActionBox>
        ) : null}

        {modo === "devolver" ? (
          <ActionBox
            tone="amber"
            title="Devolver à fila"
            description="O pedido volta para o topo da fila e fica disponível para outro operador. O diagnóstico e os passos já salvos são mantidos."
            onCancel={() => setModo("editar")}
            confirmLabel={devolver.isPending ? "Devolvendo…" : "Devolver à fila"}
            confirmDisabled={busy}
            onConfirm={() => devolver.mutate(undefined)}
          >
            <input
              className={inputClass}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Motivo (opcional)"
              maxLength={500}
            />
          </ActionBox>
        ) : null}

        {modo === "concluir" ? (
          <ActionBox
            tone="emerald"
            title="Concluir manutenção"
            description="Confira o diagnóstico e os passos acima. Ao concluir, o registro é finalizado e a gerência é avisada."
            onCancel={() => setModo("editar")}
            confirmLabel={concluir.isPending ? "Concluindo…" : "Concluir manutenção"}
            confirmDisabled={
              !conclusao.trim() || !liberada || !passosLimpos().length || busy
            }
            onConfirm={() => concluir.mutate(undefined)}
          >
            {!passosLimpos().length ? (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                Registre ao menos um passo da solução antes de concluir.
              </p>
            ) : null}
            <Field label="Resumo da conclusão" required htmlFor="exec-conclusao">
              <textarea
                id="exec-conclusao"
                className={cn(inputClass, "min-h-[90px] resize-y")}
                value={conclusao}
                onChange={(e) => setConclusao(e.target.value)}
                placeholder="Ex.: Correia substituída, tensão ajustada e máquina testada com 200 folhas."
                autoFocus
              />
            </Field>
            <label className="flex items-start gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-emerald-600"
                checked={liberada}
                onChange={(e) => setLiberada(e.target.checked)}
              />
              Confirmo que a máquina foi testada e está liberada para produção.
            </label>
          </ActionBox>
        ) : null}

        {!ativo ? (
          <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
            Este pedido não está mais em execução.
          </p>
        ) : null}
      </div>

      <aside className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Linha do tempo</h3>
        <Timeline eventos={pedido.eventos ?? []} />
      </aside>
      <HistoricoBuscaDialog
        open={buscaAberta}
        onClose={() => setBuscaAberta(false)}
        maquinaIdInicial={pedido.maquina_id}
        termoInicial={pedido.titulo}
      />
    </div>
  );
}

function StepHeader({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
          {n}
        </span>
        {title}
      </h3>
      {hint ? <p className="ml-8 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function ActionBox({
  tone,
  title,
  description,
  children,
  onCancel,
  onConfirm,
  confirmLabel,
  confirmDisabled,
}: {
  tone: "violet" | "amber" | "emerald";
  title: string;
  description: string;
  children: React.ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  confirmDisabled?: boolean;
}) {
  const tones = {
    violet: "border-violet-300 bg-violet-50",
    amber: "border-amber-300 bg-amber-50",
    emerald: "border-emerald-300 bg-emerald-50",
  };
  const btn = { violet: "pending", amber: "next", emerald: "success" } as const;
  return (
    <section className={cn("space-y-3 rounded-xl border p-4", tones[tone])}>
      <div>
        <p className="font-semibold text-slate-900">{title}</p>
        <p className="text-sm text-slate-600">{description}</p>
      </div>
      {children}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={sagraBtn("cancel", "md")} onClick={onCancel}>
          Voltar
        </button>
        <button
          type="button"
          className={cn(sagraBtn(btn[tone], "md"), "justify-center")}
          disabled={confirmDisabled}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </section>
  );
}

export function PassosEditor({
  passos,
  onChange,
  disabled,
}: {
  passos: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [novo, setNovo] = useState("");
  const adicionar = () => {
    const t = novo.trim();
    if (!t) return;
    onChange([...passos, t]);
    setNovo("");
  };
  return (
    <div className="space-y-2">
      {passos.length ? (
        <ol className="space-y-2">
          {passos.map((passo, idx) => (
            <li key={idx} className="flex items-start gap-2">
              <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700">
                {idx + 1}
              </span>
              <textarea
                className={cn(inputClass, "min-h-[44px] flex-1 resize-y py-2")}
                rows={1}
                value={passo}
                disabled={disabled}
                onChange={(e) => {
                  const next = [...passos];
                  next[idx] = e.target.value;
                  onChange(next);
                }}
                aria-label={`Passo ${idx + 1}`}
              />
              {!disabled ? (
                <div className="flex shrink-0 flex-col">
                  <button
                    type="button"
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-20"
                    disabled={idx === 0}
                    onClick={() => onChange(moverItem(passos, idx, idx - 1))}
                    aria-label="Subir passo"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-20"
                    disabled={idx === passos.length - 1}
                    onClick={() => onChange(moverItem(passos, idx, idx + 1))}
                    aria-label="Descer passo"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() => onChange(passos.filter((_, i) => i !== idx))}
                    aria-label="Remover passo"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">
          Nenhum passo registrado ainda.
        </p>
      )}
      {!disabled ? (
        <div className="flex gap-2">
          <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-slate-300 text-xs font-bold text-slate-400">
            {passos.length + 1}
          </span>
          <input
            className={cn(inputClass, "flex-1")}
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                adicionar();
              }
            }}
            placeholder="Descreva o próximo passo e tecle Enter…"
            maxLength={1000}
          />
          <button
            type="button"
            className={sagraBtn("add", "md")}
            onClick={adicionar}
            disabled={!novo.trim()}
            aria-label="Adicionar passo"
          >
            <Plus className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Adicionar</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
