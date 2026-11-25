import { cn } from "@sagra/ui";
import {
  Cog,
  History,
  Pencil,
  Plus,
  Search,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  createManutencaoMaquina,
  updateManutencaoMaquina,
  type MaquinaInput,
  type ManutencaoMaquina,
} from "@/api/manutencao";
import { sagraBtn } from "@/components/ui/sagraBtn";
import { toast } from "@/components/ui/toastStore";

import { agruparPedidos, formatData, normalizarBusca } from "../manutencaoUi";
import { useHistoricoMaquina, useMaquinas, useManutencaoMutation } from "../useManutencaoData";
import {
  Badge,
  CodigoMaquina,
  EmptyState,
  Field,
  inputClass,
  LoadingBlock,
  Modal,
  Panel,
} from "./ManutencaoShared";
import { MaquinaQrCode } from "./MaquinaQrCode";
import { PedidoCard } from "./PedidoCard";

function situacaoMaquina(m: ManutencaoMaquina): { label: string; badge: string } {
  if (!m.ativo) return { label: "Inativa", badge: "bg-slate-100 text-slate-500 ring-slate-200" };
  if (m.parada) return { label: "Parada", badge: "bg-red-100 text-red-800 ring-red-200" };
  if (m.em_execucao) return { label: "Em manutenção", badge: "bg-blue-100 text-blue-800 ring-blue-200" };
  if (m.pedidos_abertos)
    return { label: "Aguardando manutenção", badge: "bg-amber-100 text-amber-800 ring-amber-200" };
  return { label: "Operando", badge: "bg-emerald-100 text-emerald-800 ring-emerald-200" };
}

export function MaquinasPanel({
  onSolicitar,
  onAbrirPedido,
}: {
  onSolicitar: (m: ManutencaoMaquina) => void;
  onAbrirPedido: (id: number) => void;
}) {
  const [incluirInativas, setIncluirInativas] = useState(false);
  const q = useMaquinas(incluirInativas);
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<ManutencaoMaquina | "nova" | null>(null);
  const [historico, setHistorico] = useState<ManutencaoMaquina | null>(null);

  const itens = useMemo(() => {
    const t = normalizarBusca(busca);
    const list = q.data ?? [];
    if (!t) return list;
    return list.filter((m) =>
      normalizarBusca(
        `${m.nome} ${m.codigo} ${m.setor ?? ""} ${m.fabricante ?? ""} ${m.modelo ?? ""}`,
      ).includes(t),
    );
  }, [busca, q.data]);

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
        <div className="relative min-w-[14rem] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className={cn(inputClass, "py-2 pl-9")}
            placeholder="Buscar máquina, código, setor…"
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
          Nova máquina
        </button>
      </div>

      {q.isLoading ? (
        <LoadingBlock />
      ) : !itens.length ? (
        <EmptyState icon={Cog} title="Nenhuma máquina encontrada" />
      ) : (
        <>
          {/* Desktop: tabela */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5">Código</th>
                  <th className="px-4 py-2.5">Máquina</th>
                  <th className="px-4 py-2.5">Setor</th>
                  <th className="px-4 py-2.5">Situação</th>
                  <th className="px-4 py-2.5">Última manutenção</th>
                  <th className="px-4 py-2.5 text-right">Concluídas</th>
                  <th className="px-4 py-2.5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {itens.map((m) => {
                  const sit = situacaoMaquina(m);
                  return (
                    <tr key={m.id} className={cn("hover:bg-slate-50", !m.ativo && "opacity-60")}>
                      <td className="px-4 py-2.5">
                        <CodigoMaquina codigo={m.codigo} />
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-900">{m.nome}</p>
                        {m.fabricante || m.modelo ? (
                          <p className="text-xs text-slate-500">
                            {[m.fabricante, m.modelo].filter(Boolean).join(" · ")}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{m.setor || "—"}</td>
                      <td className="px-4 py-2.5">
                        <Badge className={sit.badge}>{sit.label}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {formatData(m.ultima_manutencao)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                        {m.total_concluidas}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          <RowAction label="Histórico" onClick={() => setHistorico(m)}>
                            <History className="h-4 w-4" />
                          </RowAction>
                          <RowAction label="Editar" onClick={() => setEditando(m)}>
                            <Pencil className="h-4 w-4" />
                          </RowAction>
                          {m.ativo ? (
                            <RowAction label="Solicitar manutenção" onClick={() => onSolicitar(m)}>
                              <Wrench className="h-4 w-4" />
                            </RowAction>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: cartões */}
          <ul className="divide-y divide-slate-100 md:hidden">
            {itens.map((m) => {
              const sit = situacaoMaquina(m);
              return (
                <li key={m.id} className={cn("space-y-2 p-3", !m.ativo && "opacity-60")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">{m.nome}</p>
                      <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                        <CodigoMaquina codigo={m.codigo} />
                        {m.setor}
                      </p>
                    </div>
                    <Badge className={sit.badge}>{sit.label}</Badge>
                  </div>
                  <p className="text-xs text-slate-500">
                    Última manutenção: {formatData(m.ultima_manutencao)} · {m.total_concluidas}{" "}
                    concluída(s)
                  </p>
                  <div className="flex gap-2">
                    <button type="button" className={sagraBtn("outline", "sm")} onClick={() => setHistorico(m)}>
                      <History className="h-4 w-4" aria-hidden />
                      Histórico
                    </button>
                    <button type="button" className={sagraBtn("edit", "sm")} onClick={() => setEditando(m)}>
                      <Pencil className="h-4 w-4" aria-hidden />
                      Editar
                    </button>
                    {m.ativo ? (
                      <button type="button" className={sagraBtn("add", "sm")} onClick={() => onSolicitar(m)}>
                        <Wrench className="h-4 w-4" aria-hidden />
                        Solicitar
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <MaquinaDialog
        maquina={editando === "nova" ? null : editando}
        open={editando != null}
        onClose={() => setEditando(null)}
      />
      <HistoricoMaquinaDialog
        maquina={historico}
        onClose={() => setHistorico(null)}
        onAbrirPedido={(id) => {
          setHistorico(null);
          onAbrirPedido(id);
        }}
      />
    </Panel>
  );
}

function RowAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="rounded-md p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
    >
      {children}
    </button>
  );
}

const EMPTY_FORM: Required<Omit<MaquinaInput, "ordem">> = {
  nome: "",
  codigo: "",
  setor: "",
  fabricante: "",
  modelo: "",
  numero_serie: "",
  observacoes: "",
  ativo: true,
};

function MaquinaDialog({
  maquina,
  open,
  onClose,
}: {
  maquina: ManutencaoMaquina | null;
  open: boolean;
  onClose: () => void;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  useEffect(() => {
    if (!open) return;
    setForm(
      maquina
        ? {
            nome: maquina.nome,
            codigo: maquina.codigo,
            setor: maquina.setor ?? "",
            fabricante: maquina.fabricante ?? "",
            modelo: maquina.modelo ?? "",
            numero_serie: maquina.numero_serie ?? "",
            observacoes: maquina.observacoes ?? "",
            ativo: maquina.ativo,
          }
        : EMPTY_FORM,
    );
  }, [open, maquina]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const salvar = useManutencaoMutation(
    (body: MaquinaInput) =>
      maquina ? updateManutencaoMaquina(maquina.id, body) : createManutencaoMaquina(body),
    {
      success: (m) => (maquina ? `Máquina ${m.nome} atualizada` : `Máquina ${m.codigo} cadastrada`),
      onSuccess: () => onClose(),
    },
  );

  const submit = () => {
    if (!form.nome?.trim()) {
      toast.warning("Informe o nome da máquina");
      return;
    }
    salvar.mutate({
      ...form,
      nome: form.nome.trim(),
      codigo: form.codigo?.trim() ? form.codigo.trim().toUpperCase() : undefined,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={maquina ? `Editar ${maquina.nome}` : "Nova máquina"}
      description={
        maquina
          ? "Alterações valem para os próximos pedidos; o histórico é preservado."
          : "O código é gerado automaticamente se ficar em branco."
      }
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
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Nome" required htmlFor="maq-nome">
            <input
              id="maq-nome"
              className={inputClass}
              value={form.nome ?? ""}
              maxLength={160}
              onChange={(e) => set("nome", e.target.value)}
              autoFocus
            />
          </Field>
        </div>
        <Field
          label="Código (ID)"
          hint="Identificador único — será usado no QR Code."
          htmlFor="maq-codigo"
        >
          <input
            id="maq-codigo"
            className={cn(inputClass, "font-mono uppercase")}
            value={form.codigo ?? ""}
            maxLength={32}
            placeholder="Automático (MAQ-0000)"
            onChange={(e) => set("codigo", e.target.value)}
          />
        </Field>
        <Field label="Setor" htmlFor="maq-setor">
          <input
            id="maq-setor"
            className={inputClass}
            value={form.setor ?? ""}
            maxLength={80}
            placeholder="Ex.: Acabamento"
            onChange={(e) => set("setor", e.target.value)}
          />
        </Field>
        <Field label="Fabricante" htmlFor="maq-fab">
          <input
            id="maq-fab"
            className={inputClass}
            value={form.fabricante ?? ""}
            maxLength={120}
            onChange={(e) => set("fabricante", e.target.value)}
          />
        </Field>
        <Field label="Modelo" htmlFor="maq-modelo">
          <input
            id="maq-modelo"
            className={inputClass}
            value={form.modelo ?? ""}
            maxLength={120}
            onChange={(e) => set("modelo", e.target.value)}
          />
        </Field>
        <Field label="Nº de série" htmlFor="maq-serie">
          <input
            id="maq-serie"
            className={inputClass}
            value={form.numero_serie ?? ""}
            maxLength={120}
            onChange={(e) => set("numero_serie", e.target.value)}
          />
        </Field>
        <Field label="Situação no cadastro">
          <label className="flex h-[42px] items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={Boolean(form.ativo)}
              onChange={(e) => set("ativo", e.target.checked)}
            />
            Máquina ativa (disponível para pedidos)
          </label>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Observações" htmlFor="maq-obs">
            <textarea
              id="maq-obs"
              className={cn(inputClass, "min-h-[72px] resize-y")}
              value={form.observacoes ?? ""}
              onChange={(e) => set("observacoes", e.target.value)}
              placeholder="Contato do técnico, peças críticas, cuidados especiais…"
            />
          </Field>
        </div>
        {maquina ? (
          <div className="sm:col-span-2">
            <MaquinaQrCode nome={maquina.nome} codigo={maquina.codigo} />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function HistoricoMaquinaDialog({
  maquina,
  onClose,
  onAbrirPedido,
}: {
  maquina: ManutencaoMaquina | null;
  onClose: () => void;
  onAbrirPedido: (id: number) => void;
}) {
  const q = useHistoricoMaquina(maquina?.id ?? null);
  const { fila, execucao, finalizados } = agruparPedidos(q.data ?? []);
  const todos = [...execucao, ...fila, ...finalizados];
  return (
    <Modal
      open={maquina != null}
      onClose={onClose}
      size="md"
      title={maquina ? `Histórico — ${maquina.nome}` : "Histórico"}
      description={maquina ? <CodigoMaquina codigo={maquina.codigo} /> : undefined}
    >
      {q.isLoading ? (
        <LoadingBlock />
      ) : todos.length ? (
        <div className="space-y-2">
          {todos.map((p) => (
            <PedidoCard key={p.id} pedido={p} onAbrir={onAbrirPedido} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={History}
          title="Sem manutenções registradas"
          description="Os pedidos desta máquina aparecerão aqui."
        />
      )}
    </Modal>
  );
}
