import { CheckCircle2, Loader2, MessageSquareWarning } from "lucide-react";

import { ClienteProofPontoInput } from "./ClienteProofPontoInput";

interface ClienteProofActionsProps {
  nomeCliente: string;
  ponto: string;
  observacao: string;
  onNomeChange: (value: string) => void;
  onPontoChange: (value: string) => void;
  onObservacaoChange: (value: string) => void;
  onApproveClick: () => void;
  onRejectClick: () => void;
  isPending: boolean;
  errorMsg: string | null;
  disabled?: boolean;
  /** Papelaria: alterações via campos — observação livre opcional no primeiro passo. */
  requireObsForReject?: boolean;
  /** Portal público /portal/aprovacao — layout e validação específicos. */
  publicPortal?: boolean;
}

export function ClienteProofActions({
  nomeCliente,
  ponto,
  observacao,
  onNomeChange,
  onPontoChange,
  onObservacaoChange,
  onApproveClick,
  onRejectClick,
  isPending,
  errorMsg,
  disabled = false,
  requireObsForReject = true,
  publicPortal = false,
}: ClienteProofActionsProps) {
  const nomeOk = nomeCliente.trim().length > 0;
  const pontoOk = ponto.replace(/\D/g, "").length > 0;
  const obsOk = observacao.trim().length > 0;
  const requireObs = requireObsForReject && !publicPortal;

  return (
    <section className="rounded-2xl border border-sagra-border bg-white p-4 shadow-sm sm:p-5">
      <h2 className="text-base font-bold text-secondary-blue">Sua resposta</h2>
      <p className="mt-1 text-sm text-neutral-600">
        Confira o arquivo enviado e registre sua aprovação ou solicitação de ajuste.
      </p>

      <label className="mt-4 flex flex-col gap-1 text-sm">
        <span className="font-medium text-neutral-700">
          Nome <span className="text-red-600">*</span>
        </span>
        <input
          className="min-h-11 rounded-xl border border-sagra-border px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary-blue"
          value={nomeCliente}
          onChange={(e) => onNomeChange(e.target.value)}
          placeholder="Nome completo"
          disabled={disabled || isPending}
          required
          aria-required="true"
        />
      </label>

      <label className="mt-3 flex flex-col gap-1 text-sm">
        <span className="font-medium text-neutral-700">
          Número de ponto <span className="text-red-600">*</span>
        </span>
        <ClienteProofPontoInput
          value={ponto}
          onChange={onPontoChange}
          withPrefix={publicPortal}
          disabled={disabled || isPending}
        />
      </label>

      {!publicPortal ? (
        <label className="mt-3 flex flex-col gap-1 text-sm">
          <span className="font-medium text-neutral-700">
            Observações{" "}
            <span className="font-normal text-neutral-500">(obrigatório para solicitar alterações)</span>
          </span>
          <textarea
            className="min-h-28 rounded-xl border border-sagra-border px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary-blue"
            value={observacao}
            onChange={(e) => onObservacaoChange(e.target.value)}
            placeholder="Informe ajustes necessários ou observações sobre a prova."
            disabled={disabled || isPending}
          />
        </label>
      ) : null}

      {errorMsg ? (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {errorMsg}
        </p>
      ) : null}

      <div
        className={
          publicPortal
            ? "mt-5 flex flex-row gap-2"
            : "mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap"
        }
      >
        <button
          type="button"
          disabled={
            disabled ||
            isPending ||
            !nomeOk ||
            !pontoOk ||
            (requireObs && !obsOk)
          }
          onClick={onRejectClick}
          className={
            publicPortal
              ? "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
              : "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60 sm:flex-none"
          }
        >
          <MessageSquareWarning className="size-4" aria-hidden />
          Solicitar alterações
        </button>
        <button
          type="button"
          disabled={disabled || isPending || !nomeOk || !pontoOk}
          onClick={onApproveClick}
          className={
            publicPortal
              ? "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary-green px-4 py-2 text-sm font-semibold text-white hover:bg-primary-green/90 disabled:opacity-60"
              : "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary-green px-4 py-2 text-sm font-semibold text-white hover:bg-primary-green/90 disabled:opacity-60 sm:flex-none"
          }
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <CheckCircle2 className="size-4" aria-hidden />
          )}
          Aprovar prova
        </button>
      </div>
    </section>
  );
}
