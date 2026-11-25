import { cn } from "@sagra/ui";
import { CalendarClock, Pencil, Plus, Repeat, Search, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  createManutencaoRecorrente,
  updateManutencaoRecorrente,
  type ManutencaoPrioridade,
  type ManutencaoRecorrente,
  type RecorrenteInput,
} from "@/api/manutencao";
import { sagraBtn } from "@/components/ui/sagraBtn";
import { toast } from "@/components/ui/toastStore";

import { formatData, normalizarBusca, SITUACAO_RECORRENTE_META } from "../manutencaoUi";
import { useMaquinas, useManutencaoMutation, useRecorrentes } from "../useManutencaoData";
import {
  Badge,
  EmptyState,
  Field,
  inputClass,
  LoadingBlock,
  Modal,
  Panel,
  PrioridadeBadge,
  PrioridadeSelector,
} from "./ManutencaoShared";

const PERIODOS_SUGERIDOS = [
  { dias: 7, label: "Semanal" },
  { dias: 15, label: "Quinzenal" },
  { dias: 30, label: "Mensal" },
  { dias: 90, label: "Trimestral" },
  { dias: 180, label: "Semestral" },
  { dias: 365, label: "Anual" },
];

function descreverPeriodo(dias?: number | null): string {
  if (!dias) return "Sob demanda";
  const sugerido = PERIODOS_SUGERIDOS.find((p) => p.dias === dias);
  return sugerido ? `${sugerido.label} (${dias} dias)` : `A cada ${dias} dias`;
}

export function RecorrentesPanel({
  onSolicitar,
}: {
  onSolicitar: (r: ManutencaoRecorrente) => void;
}) {
  const [incluirInativas, setIncluirInativas] = useState(false);
  const q = useRecorrentes(incluirInativas);
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<ManutencaoRecorrente | "nova" | null>(null);

  const itens = useMemo(() => {
    const t = normalizarBusca(busca);
    const list = q.data ?? [];
    if (!t) return list;
    return list.filter((r) =>
      normalizarBusca(`${r.titulo} ${r.descricao ?? ""} ${r.maquina_nome ?? ""}`).includes(t),
    );
  }, [busca, q.data]);

  return (
    <Panel>
      <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3 text-xs text-slate-600">
        <strong className="text-slate-800">Manutenções recorrentes</strong> são modelos de serviço
        (ex.: lubrificação, troca de lâmina) que agilizam a solicitação. Com máquina e periodicidade
        definidas, o sistema avisa quando a preventiva vence.
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
        <div className="relative min-w-[14rem] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className={cn(inputClass, "py-2 pl-9")}
            placeholder="Buscar manutenção recorrente…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={incluirInativas}
            onChange={(e) => setIncluirInativas(e.target.checked)}
          />
          Mostrar inativas
        </label>
        <div className="flex-1" />
        <button type="button" className={sagraBtn("add", "sm")} onClick={() => setEditando("nova")}>
          <Plus className="h-4 w-4" aria-hidden />
          Nova recorrente
        </button>
      </div>

      {q.isLoading ? (
        <LoadingBlock />
      ) : !itens.length ? (
        <EmptyState
          icon={Repeat}
          title="Nenhuma manutenção recorrente"
          description="Cadastre os serviços que se repetem para solicitá-los com um clique."
          action={
            <button
              type="button"
              className={sagraBtn("add", "sm")}
              onClick={() => setEditando("nova")}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Cadastrar a primeira
            </button>
          }
        />
      ) : (
        <ul className="grid gap-3 p-3 md:grid-cols-2 2xl:grid-cols-3">
          {itens.map((r) => (
            <li
              key={r.id}
              className={cn(
                "flex flex-col gap-2 rounded-lg border border-slate-200 p-3",
                !r.ativo && "opacity-60",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{r.titulo}</p>
                  <p className="text-xs text-slate-500">
                    {r.maquina_nome ?? "Qualquer máquina"} · {descreverPeriodo(r.periodicidade_dias)}
                  </p>
                </div>
                <PrioridadeBadge prioridade={r.prioridade_padrao} />
              </div>
              {r.descricao ? (
                <p className="line-clamp-3 whitespace-pre-line text-sm text-slate-600">
                  {r.descricao}
                </p>
              ) : null}
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                {r.situacao ? (
                  <Badge className={SITUACAO_RECORRENTE_META[r.situacao].badge}>
                    <CalendarClock className="h-3 w-3" aria-hidden />
                    {SITUACAO_RECORRENTE_META[r.situacao].label}
                    {r.proxima_em ? ` · ${formatData(r.proxima_em)}` : ""}
                  </Badge>
                ) : null}
                {!r.ativo ? (
                  <Badge className="bg-slate-100 text-slate-500 ring-slate-200">Inativa</Badge>
                ) : null}
                <span className="text-[11px] text-slate-400">
                  {r.total_execucoes} execução(ões)
                  {r.ultima_execucao ? ` · última ${formatData(r.ultima_execucao)}` : ""}
                </span>
                <div className="flex-1" />
                <button type="button" className={sagraBtn("edit", "xs")} onClick={() => setEditando(r)}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                  Editar
                </button>
                {r.ativo ? (
                  <button type="button" className={sagraBtn("add", "xs")} onClick={() => onSolicitar(r)}>
                    <Wrench className="h-3.5 w-3.5" aria-hidden />
                    Solicitar
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <RecorrenteDialog
        recorrente={editando === "nova" ? null : editando}
        open={editando != null}
        onClose={() => setEditando(null)}
      />
    </Panel>
  );
}

function RecorrenteDialog({
  recorrente,
  open,
  onClose,
}: {
  recorrente: ManutencaoRecorrente | null;
  open: boolean;
  onClose: () => void;
}) {
  const maquinasQ = useMaquinas(false);
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [maquinaId, setMaquinaId] = useState<number | null>(null);
  const [periodicidade, setPeriodicidade] = useState<string>("");
  const [prioridade, setPrioridade] = useState<ManutencaoPrioridade>("normal");
  const [ativo, setAtivo] = useState(true);

  useEffect(() => {
    if (!open) return;
    setTitulo(recorrente?.titulo ?? "");
    setDescricao(recorrente?.descricao ?? "");
    setMaquinaId(recorrente?.maquina_id ?? null);
    setPeriodicidade(recorrente?.periodicidade_dias ? String(recorrente.periodicidade_dias) : "");
    setPrioridade(recorrente?.prioridade_padrao ?? "normal");
    setAtivo(recorrente?.ativo ?? true);
  }, [open, recorrente]);

  const salvar = useManutencaoMutation(
    (body: RecorrenteInput) =>
      recorrente
        ? updateManutencaoRecorrente(recorrente.id, body)
        : createManutencaoRecorrente(body),
    {
      success: recorrente ? "Manutenção recorrente atualizada" : "Manutenção recorrente cadastrada",
      onSuccess: () => onClose(),
    },
  );

  const submit = () => {
    if (!titulo.trim()) {
      toast.warning("Informe o título");
      return;
    }
    const dias = periodicidade.trim() ? Number(periodicidade) : null;
    if (dias != null && (!Number.isInteger(dias) || dias < 1)) {
      toast.warning("Periodicidade deve ser um número inteiro de dias");
      return;
    }
    const body: RecorrenteInput = {
      titulo: titulo.trim(),
      descricao: descricao.trim(),
      prioridade_padrao: prioridade,
      ativo,
    };
    if (maquinaId) body.maquina_id = maquinaId;
    else if (recorrente) body.clear_maquina = true;
    if (dias) body.periodicidade_dias = dias;
    else if (recorrente) body.clear_periodicidade = true;
    salvar.mutate(body);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={recorrente ? "Editar manutenção recorrente" : "Nova manutenção recorrente"}
      footer={
        <>
          <button type="button" className={sagraBtn("cancel", "md")} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className={sagraBtn("save", "md")}
            disabled={salvar.isPending}
            onClick={submit}
          >
            {salvar.isPending ? "Salvando…" : "Salvar"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Título" required htmlFor="rec-titulo">
          <input
            id="rec-titulo"
            className={inputClass}
            value={titulo}
            maxLength={200}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ex.: Lubrificação geral"
            autoFocus
          />
        </Field>
        <Field
          label="Instruções / descrição"
          hint="Vai pré-preenchida no pedido — descreva o que o operador deve fazer."
          htmlFor="rec-desc"
        >
          <textarea
            id="rec-desc"
            className={cn(inputClass, "min-h-[96px] resize-y")}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />
        </Field>
        <Field
          label="Máquina"
          hint="Deixe em branco para um serviço aplicável a qualquer máquina."
          htmlFor="rec-maquina"
        >
          <select
            id="rec-maquina"
            className={inputClass}
            value={maquinaId ?? ""}
            onChange={(e) => setMaquinaId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Qualquer máquina</option>
            {(maquinasQ.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome} ({m.codigo})
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Periodicidade (dias)"
          hint={
            maquinaId
              ? "Opcional. Com periodicidade, a gerência é avisada quando a preventiva vencer."
              : "Para acompanhar vencimento, selecione também a máquina."
          }
          htmlFor="rec-periodo"
        >
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {PERIODOS_SUGERIDOS.map((p) => (
                <button
                  key={p.dias}
                  type="button"
                  onClick={() => setPeriodicidade(String(p.dias))}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition",
                    periodicidade === String(p.dias)
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:border-slate-500",
                  )}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPeriodicidade("")}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition",
                  !periodicidade
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:border-slate-500",
                )}
              >
                Sob demanda
              </button>
            </div>
            <input
              id="rec-periodo"
              type="number"
              min={1}
              max={3650}
              inputMode="numeric"
              className={cn(inputClass, "max-w-[10rem]")}
              value={periodicidade}
              onChange={(e) => setPeriodicidade(e.target.value)}
              placeholder="Dias"
            />
          </div>
        </Field>
        <Field label="Prioridade padrão">
          <PrioridadeSelector value={prioridade} onChange={setPrioridade} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={ativo}
            onChange={(e) => setAtivo(e.target.checked)}
          />
          Ativa (aparece como opção ao solicitar manutenção)
        </label>
      </div>
    </Modal>
  );
}
