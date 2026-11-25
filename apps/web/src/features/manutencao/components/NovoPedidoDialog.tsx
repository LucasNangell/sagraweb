import { cn } from "@sagra/ui";
import { AlertOctagon, Check, Repeat, Search, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  createManutencaoPedido,
  type ManutencaoMaquina,
  type ManutencaoPrioridade,
  type ManutencaoRecorrente,
} from "@/api/manutencao";
import { sagraBtn } from "@/components/ui/sagraBtn";

import { normalizarBusca } from "../manutencaoUi";
import { useMaquinas, useManutencaoMutation, useRecorrentes } from "../useManutencaoData";
import {
  CodigoMaquina,
  Field,
  inputClass,
  Modal,
  PrioridadeSelector,
} from "./ManutencaoShared";

export interface NovoPedidoPreset {
  maquinaId?: number | null;
  recorrenteId?: number | null;
}

export function NovoPedidoDialog({
  open,
  onClose,
  preset,
}: {
  open: boolean;
  onClose: () => void;
  preset?: NovoPedidoPreset | null;
}) {
  const maquinasQ = useMaquinas(false);
  const recorrentesQ = useRecorrentes(false);
  const maquinas = maquinasQ.data ?? [];
  const recorrentes = recorrentesQ.data ?? [];

  const [maquinaId, setMaquinaId] = useState<number | null>(null);
  const [recorrenteId, setRecorrenteId] = useState<number | null>(null);
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [prioridade, setPrioridade] = useState<ManutencaoPrioridade>("normal");
  const [parada, setParada] = useState(false);
  const [busca, setBusca] = useState("");
  const [tentouEnviar, setTentouEnviar] = useState(false);

  const aplicarRecorrente = (rec: ManutencaoRecorrente | null) => {
    setRecorrenteId(rec?.id ?? null);
    if (rec) {
      setTitulo(rec.titulo);
      setDescricao(rec.descricao ?? "");
      setPrioridade(rec.prioridade_padrao);
      if (rec.maquina_id) setMaquinaId(rec.maquina_id);
    }
  };

  useEffect(() => {
    if (!open) return;
    setMaquinaId(preset?.maquinaId ?? null);
    setRecorrenteId(null);
    setTitulo("");
    setDescricao("");
    setPrioridade("normal");
    setParada(false);
    setBusca("");
    setTentouEnviar(false);
  }, [open, preset?.maquinaId, preset?.recorrenteId]);

  // Preset de recorrente (ex.: botão "Solicitar" em uma preventiva vencida).
  useEffect(() => {
    if (!open || !preset?.recorrenteId) return;
    const rec = recorrentes.find((r) => r.id === preset.recorrenteId);
    if (rec) aplicarRecorrente(rec);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preset?.recorrenteId, recorrentes.length]);

  const maquinaSel = maquinas.find((m) => m.id === maquinaId) ?? null;

  const maquinasFiltradas = useMemo(() => {
    const q = normalizarBusca(busca);
    if (!q) return maquinas;
    return maquinas.filter((m) =>
      normalizarBusca(`${m.nome} ${m.codigo} ${m.setor ?? ""}`).includes(q),
    );
  }, [busca, maquinas]);

  const recorrentesAplicaveis = useMemo(
    () =>
      recorrentes.filter((r) => !r.maquina_id || maquinaId == null || r.maquina_id === maquinaId),
    [recorrentes, maquinaId],
  );

  const criar = useManutencaoMutation(createManutencaoPedido, {
    success: (p) => `Pedido #${p.id} enviado para a fila (${p.posicao_fila ?? "-"}º)`,
    onSuccess: () => onClose(),
  });

  const erroMaquina = tentouEnviar && !maquinaId;
  const erroTitulo = tentouEnviar && !titulo.trim();

  const enviar = () => {
    setTentouEnviar(true);
    if (!maquinaId || !titulo.trim()) return;
    criar.mutate({
      maquina_id: maquinaId,
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
      prioridade,
      recorrente_id: recorrenteId,
      maquina_parada: parada,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Nova solicitação de manutenção"
      description="O pedido entra na fila e os operadores são notificados."
      footer={
        <>
          <button type="button" className={sagraBtn("cancel", "md")} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className={sagraBtn("confirm", "md")}
            onClick={enviar}
            disabled={criar.isPending}
          >
            <Send className="h-4 w-4" aria-hidden />
            {criar.isPending ? "Enviando…" : "Enviar para a fila"}
          </button>
        </>
      }
    >
      <div className="space-y-6">
        {/* 1. Máquina */}
        <section className="space-y-2">
          <StepTitle n={1} title="Qual máquina?" done={Boolean(maquinaSel)} />
          {maquinaSel ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-900 bg-slate-50 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{maquinaSel.nome}</p>
                <p className="flex items-center gap-2 text-xs text-slate-500">
                  <CodigoMaquina codigo={maquinaSel.codigo} />
                  {maquinaSel.setor}
                  {maquinaSel.pedidos_abertos > 0 ? (
                    <span className="font-medium text-amber-700">
                      · {maquinaSel.pedidos_abertos} pedido(s) em aberto
                    </span>
                  ) : null}
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 text-sm font-medium text-slate-600 underline-offset-2 hover:underline"
                onClick={() => setMaquinaId(null)}
              >
                Trocar
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  className={cn(inputClass, "pl-9")}
                  placeholder="Buscar por nome, código ou setor…"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  autoFocus
                />
              </div>
              <div
                className={cn(
                  "grid max-h-64 grid-cols-1 gap-1.5 overflow-y-auto rounded-lg border p-1.5 sm:grid-cols-2",
                  erroMaquina ? "border-red-400" : "border-slate-200",
                )}
              >
                {maquinasFiltradas.map((m) => (
                  <MaquinaOption key={m.id} maquina={m} onSelect={() => setMaquinaId(m.id)} />
                ))}
                {!maquinasFiltradas.length ? (
                  <p className="col-span-full py-4 text-center text-sm text-slate-500">
                    Nenhuma máquina encontrada.
                  </p>
                ) : null}
              </div>
              {erroMaquina ? (
                <p className="text-xs font-medium text-red-600">Selecione a máquina.</p>
              ) : null}
            </div>
          )}
        </section>

        {/* 2. O que fazer */}
        <section className="space-y-3">
          <StepTitle n={2} title="O que deve ser feito?" done={Boolean(titulo.trim())} />
          {recorrentesAplicaveis.length ? (
            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <Repeat className="h-3.5 w-3.5" aria-hidden />
                Usar uma manutenção recorrente (opcional)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {recorrentesAplicaveis.map((r) => {
                  const sel = recorrenteId === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => aplicarRecorrente(sel ? null : r)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                        sel
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-300 bg-white text-slate-700 hover:border-slate-500",
                      )}
                    >
                      {sel ? <Check className="h-3 w-3" aria-hidden /> : null}
                      {r.titulo}
                      {r.maquina_nome ? (
                        <span className={sel ? "text-slate-300" : "text-slate-400"}>
                          · {r.maquina_nome}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <Field label="Título" required htmlFor="manut-titulo">
            <input
              id="manut-titulo"
              className={cn(inputClass, erroTitulo && "border-red-400")}
              placeholder="Ex.: Trocar blanqueta da unidade 2"
              value={titulo}
              maxLength={200}
              onChange={(e) => setTitulo(e.target.value)}
            />
          </Field>
          <Field
            label="Descrição"
            hint="Sintomas observados, quando começou, o que já foi tentado."
            htmlFor="manut-desc"
          >
            <textarea
              id="manut-desc"
              className={cn(inputClass, "min-h-[96px] resize-y")}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Descreva o problema ou o serviço esperado…"
            />
          </Field>
        </section>

        {/* 3. Prioridade */}
        <section className="space-y-3">
          <StepTitle n={3} title="Qual a prioridade?" done />
          <PrioridadeSelector value={prioridade} onChange={setPrioridade} />
          <label
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition",
              parada ? "border-red-300 bg-red-50" : "border-slate-200 bg-white hover:border-slate-400",
            )}
          >
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-red-600"
              checked={parada}
              onChange={(e) => {
                setParada(e.target.checked);
                if (e.target.checked && prioridade !== "urgente") setPrioridade("urgente");
              }}
            />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                <AlertOctagon className="h-4 w-4 text-red-600" aria-hidden />A máquina está parada
              </span>
              <span className="text-xs text-slate-500">
                Sinaliza para toda a equipe que a produção nesta máquina está interrompida.
              </span>
            </span>
          </label>
        </section>
      </div>
    </Modal>
  );
}

function StepTitle({ n, title, done }: { n: number; title: string; done?: boolean }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
      <span
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
          done ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700",
        )}
      >
        {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : n}
      </span>
      {title}
    </h3>
  );
}

function MaquinaOption({
  maquina,
  onSelect,
}: {
  maquina: ManutencaoMaquina;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left transition hover:bg-slate-100"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-slate-800">{maquina.nome}</span>
        <span className="block text-[11px] text-slate-500">
          {maquina.codigo}
          {maquina.setor ? ` · ${maquina.setor}` : ""}
        </span>
      </span>
      {maquina.parada ? (
        <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" title="Máquina parada" />
      ) : maquina.pedidos_abertos > 0 ? (
        <span
          className="shrink-0 rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800"
          title="Pedidos em aberto"
        >
          {maquina.pedidos_abertos}
        </span>
      ) : null}
    </button>
  );
}
