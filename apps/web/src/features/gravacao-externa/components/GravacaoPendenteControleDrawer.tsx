import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { usePatchGravacaoPendentePagamentoNfMutation } from "@/api/hooks/useGravacaoPendente";
import type { GravacaoPendenteHistoricoItem } from "@/api/gravacaoPendente";
import { formatDateBr, formatDateTimeBr } from "@/lib/format";

interface GravacaoPendenteControleDrawerProps {
  item: GravacaoPendenteHistoricoItem | null;
  onClose: () => void;
}

function formatOsListLabel(item: { nr_os: number; ano: number }): string {
  return `${String(item.nr_os).padStart(5, "0")}/${String(item.ano).slice(-2)}`;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-neutral-900">{value || "—"}</dd>
    </div>
  );
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

export function GravacaoPendenteControleDrawer({
  item,
  onClose,
}: GravacaoPendenteControleDrawerProps) {
  const patchNfMutation = usePatchGravacaoPendentePagamentoNfMutation();
  const [nfDate, setNfDate] = useState("");
  const [nfError, setNfError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    setNfDate(toDateInputValue(item.pagamento_nf_em));
    setNfError(null);
  }, [item]);

  if (!item) {
    return null;
  }

  const chapasLabel =
    item.chapas_por_maquina?.length > 0
      ? item.chapas_por_maquina
          .map((c) => `${c.maquina}: ${c.quantidade}`)
          .join(" · ")
      : "—";

  const fornecedorLabel =
    item.fornecedor_nome?.trim() || item.fornecedor_ponto || "—";

  const recebidoLabel =
    item.recebido_por_nome?.trim() || item.recebido_por_ponto || "—";

  const canEditNf = item.gravacao_externa_id != null;

  const handleSaveNf = async () => {
    if (item.gravacao_externa_id == null) return;
    setNfError(null);
    try {
      await patchNfMutation.mutateAsync({
        gravacaoExternaId: item.gravacao_externa_id,
        pagamento_nf_em: nfDate ? `${nfDate}T12:00:00` : null,
      });
    } catch (e) {
      setNfError(e instanceof Error ? e.message : "Não foi possível salvar a data da NF.");
    }
  };

  return (
    <div className="fixed inset-0 z-[10003]" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Fechar detalhes"
        onClick={onClose}
      />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-neutral-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-neutral-200 px-4 py-3">
          <div>
            <h3 className="text-base font-semibold text-neutral-900">
              OS {formatOsListLabel(item)}
            </h3>
            <p className="mt-0.5 text-xs text-neutral-500">
              Detalhes do controle de chapas
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
            aria-label="Fechar"
          >
            <X className="size-5" />
          </button>
        </div>
        <dl className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
          <Field label="Data inclusão" value={formatDateTimeBr(item.criado_em)} />
          <Field label="Cliente" value={item.solicitante || "—"} />
          <Field label="Título" value={item.titulo || "—"} />
          <Field label="Chapas por máquina" value={chapasLabel} />
          <Field
            label="Total de chapas"
            value={item.total_chapas != null ? String(item.total_chapas) : "—"}
          />
          <Field
            label="Data encaminhamento Externa"
            value={formatDateTimeBr(item.enviada_em)}
          />
          <Field label="Fornecedor" value={fornecedorLabel} />
          <Field
            label="Data/hora conclusão"
            value={formatDateTimeBr(item.concluida_em)}
          />
          <Field
            label="Data recebimento"
            value={formatDateTimeBr(item.entrega_lancada_em)}
          />
          <Field label="Quem recebeu" value={recebidoLabel} />
          {canEditNf ? (
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                Data pagamento NF
              </dt>
              <dd className="mt-1 flex items-center gap-2">
                <input
                  type="date"
                  value={nfDate}
                  onChange={(e) => setNfDate(e.target.value)}
                  className="rounded border border-neutral-300 px-2 py-1 text-sm"
                />
                <button
                  type="button"
                  disabled={patchNfMutation.isPending}
                  onClick={() => void handleSaveNf()}
                  className="inline-flex items-center gap-1 rounded border border-neutral-300 px-2 py-1 text-xs font-medium hover:bg-neutral-50 disabled:opacity-50"
                >
                  {patchNfMutation.isPending ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : null}
                  Salvar
                </button>
              </dd>
              {nfError ? (
                <p className="mt-1 text-xs text-red-600">{nfError}</p>
              ) : null}
              {!nfDate && item.pagamento_nf_em ? null : nfDate ? (
                <p className="mt-0.5 text-xs text-neutral-500">
                  Atual: {formatDateBr(item.pagamento_nf_em) || "—"}
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-neutral-500">Não informado</p>
              )}
            </div>
          ) : (
            <Field
              label="Data pagamento NF"
              value={formatDateBr(item.pagamento_nf_em) || "—"}
            />
          )}
        </dl>
      </aside>
    </div>
  );
}
