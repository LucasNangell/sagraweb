import { Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useGravacaoPendenteFornecedores } from "@/api/hooks/useGravacaoPendente";
import type {
  GravacaoPendenteControleUpdateBody,
  GravacaoPendenteHistoricoItem,
} from "@/api/gravacaoPendente";
import { formatOsJuntadaLabel } from "../utils/formatOsJuntadaLabel";

const MAQUINAS = ["Komori", "SM74", "PM52"] as const;

interface GravacaoPendenteControleEditModalProps {
  open: boolean;
  item: GravacaoPendenteHistoricoItem | null;
  saving?: boolean;
  onClose: () => void;
  onSave: (body: GravacaoPendenteControleUpdateBody) => void | Promise<void>;
}

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function datetimeLocalToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function dateToIsoNoon(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return `${trimmed}T12:00:00`;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value || "—"}</dd>
    </div>
  );
}

export function GravacaoPendenteControleEditModal({
  open,
  item,
  saving = false,
  onClose,
  onSave,
}: GravacaoPendenteControleEditModalProps) {
  const fornecedoresQuery = useGravacaoPendenteFornecedores(open);
  const fornecedores = fornecedoresQuery.data?.items ?? [];

  const [chapasQty, setChapasQty] = useState<Record<string, string>>({
    Komori: "",
    SM74: "",
    PM52: "",
  });
  const [criadoEm, setCriadoEm] = useState("");
  const [enviadaEm, setEnviadaEm] = useState("");
  const [fornecedorPonto, setFornecedorPonto] = useState("");
  const [concluidaEm, setConcluidaEm] = useState("");
  const [entregaEm, setEntregaEm] = useState("");
  const [recebidoPonto, setRecebidoPonto] = useState("");
  const [recebidoNome, setRecebidoNome] = useState("");
  const [pagamentoNf, setPagamentoNf] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !item) return;
    const next: Record<string, string> = { Komori: "", SM74: "", PM52: "" };
    for (const c of item.chapas_por_maquina ?? []) {
      if (c.maquina in next) {
        next[c.maquina] = String(c.quantidade);
      }
    }
    setChapasQty(next);
    setCriadoEm(toDatetimeLocalValue(item.criado_em));
    setEnviadaEm(toDatetimeLocalValue(item.enviada_em));
    setFornecedorPonto(item.fornecedor_ponto || "");
    setConcluidaEm(toDatetimeLocalValue(item.concluida_em));
    setEntregaEm(toDatetimeLocalValue(item.entrega_lancada_em));
    setRecebidoPonto(item.recebido_por_ponto || "");
    setRecebidoNome(item.recebido_por_nome || "");
    setPagamentoNf(toDateInputValue(item.pagamento_nf_em));
    setError(null);
  }, [open, item]);

  const osLabel = useMemo(() => {
    if (!item) return "";
    return formatOsJuntadaLabel(item.membros, item);
  }, [item]);

  const isJuntada = Boolean(
    item?.juntada_grupo_id && (item.membros?.length ?? 0) > 1,
  );

  if (!open || !item) {
    return null;
  }

  const handleSubmit = async () => {
    setError(null);
    const chapas: { maquina: string; quantidade: number }[] = [];
    for (const maquina of MAQUINAS) {
      const raw = (chapasQty[maquina] || "").trim();
      if (!raw) continue;
      const quantidade = Number(raw);
      if (!Number.isFinite(quantidade) || quantidade <= 0 || !Number.isInteger(quantidade)) {
        setError(`Quantidade inválida para ${maquina}.`);
        return;
      }
      chapas.push({ maquina, quantidade });
    }

    const body: GravacaoPendenteControleUpdateBody = {
      chapas,
      criado_em: datetimeLocalToIso(criadoEm),
      enviada_em: datetimeLocalToIso(enviadaEm),
      fornecedor_ponto: fornecedorPonto.trim() || null,
      concluida_em: datetimeLocalToIso(concluidaEm),
      entrega_lancada_em: datetimeLocalToIso(entregaEm),
      recebido_por_ponto: recebidoPonto.trim() || null,
      recebido_por_nome: recebidoNome.trim() || null,
      pagamento_nf_em: dateToIsoNoon(pagamentoNf),
    };

    try {
      await onSave(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar as alterações.");
    }
  };

  const inputClass =
    "w-full rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900 disabled:bg-slate-100";

  return (
    <div
      className="fixed inset-0 z-[10004] flex items-center justify-center bg-black/60 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Editar controle de chapas"
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-base font-semibold text-secondary-blue">
              Editar controle de chapas
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">OS {osLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
            aria-label="Fechar"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {isJuntada ? (
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Alterações serão aplicadas a todas as OSs juntadas.
            </p>
          ) : null}

          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ReadOnlyField label="OS / Ano" value={osLabel} />
            <ReadOnlyField label="Cliente" value={item.solicitante || "—"} />
            <div className="sm:col-span-2">
              <ReadOnlyField label="Título" value={item.titulo || "—"} />
            </div>
          </dl>

          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Chapas por máquina
            </h4>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {MAQUINAS.map((maquina) => (
                <label key={maquina} className="block text-xs text-slate-600">
                  {maquina}
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={chapasQty[maquina] ?? ""}
                    onChange={(e) =>
                      setChapasQty((prev) => ({ ...prev, [maquina]: e.target.value }))
                    }
                    disabled={saving}
                    className={`${inputClass} mt-0.5`}
                    aria-label={`Chapas ${maquina}`}
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs text-slate-600">
              Disp. p/ Gravação
              <input
                type="datetime-local"
                value={criadoEm}
                onChange={(e) => setCriadoEm(e.target.value)}
                disabled={saving}
                className={`${inputClass} mt-0.5`}
                aria-label="Disp. p/ Gravação"
              />
            </label>
            <label className="block text-xs text-slate-600">
              Saída p/ Birô
              <input
                type="datetime-local"
                value={enviadaEm}
                onChange={(e) => setEnviadaEm(e.target.value)}
                disabled={saving}
                className={`${inputClass} mt-0.5`}
                aria-label="Saída p/ Birô"
              />
            </label>
            <label className="block text-xs text-slate-600 sm:col-span-2">
              Fornecedor
              <select
                value={fornecedorPonto}
                onChange={(e) => setFornecedorPonto(e.target.value)}
                disabled={saving || fornecedoresQuery.isPending}
                className={`${inputClass} mt-0.5`}
                aria-label="Fornecedor"
              >
                <option value="">—</option>
                {fornecedores.map((f) => (
                  <option key={f.ponto} value={f.ponto}>
                    {f.nome?.trim() || f.ponto}
                  </option>
                ))}
                {fornecedorPonto &&
                !fornecedores.some((f) => f.ponto === fornecedorPonto) ? (
                  <option value={fornecedorPonto}>
                    {item.fornecedor_nome?.trim() || fornecedorPonto}
                  </option>
                ) : null}
              </select>
            </label>
            <label className="block text-xs text-slate-600">
              Grav. Concluída
              <input
                type="datetime-local"
                value={concluidaEm}
                onChange={(e) => setConcluidaEm(e.target.value)}
                disabled={saving}
                className={`${inputClass} mt-0.5`}
                aria-label="Grav. Concluída"
              />
            </label>
            <label className="block text-xs text-slate-600">
              Receb. CGRAF
              <input
                type="datetime-local"
                value={entregaEm}
                onChange={(e) => setEntregaEm(e.target.value)}
                disabled={saving}
                className={`${inputClass} mt-0.5`}
                aria-label="Receb. CGRAF"
              />
            </label>
            <label className="block text-xs text-slate-600">
              Recebido por (ponto)
              <input
                type="text"
                value={recebidoPonto}
                onChange={(e) => setRecebidoPonto(e.target.value)}
                disabled={saving}
                className={`${inputClass} mt-0.5`}
                aria-label="Recebido por ponto"
              />
            </label>
            <label className="block text-xs text-slate-600">
              Recebido por (nome)
              <input
                type="text"
                value={recebidoNome}
                onChange={(e) => setRecebidoNome(e.target.value)}
                disabled={saving}
                className={`${inputClass} mt-0.5`}
                aria-label="Recebido por nome"
              />
            </label>
            <label className="block text-xs text-slate-600 sm:col-span-2">
              Pagamento NF
              <input
                type="date"
                value={pagamentoNf}
                onChange={(e) => setPagamentoNf(e.target.value)}
                disabled={saving}
                className={`${inputClass} mt-0.5`}
                aria-label="Pagamento NF"
              />
            </label>
          </div>

          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving || item.gravacao_pendente_id == null}
            className="inline-flex items-center gap-1.5 rounded bg-secondary-blue px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
