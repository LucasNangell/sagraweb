import { Loader2 } from "lucide-react";
import { cn } from "@sagra/ui";

export type PapelariaActionBarProps = {
  showTimbradoA4Digital: boolean;
  showGerarProvaCdr: boolean;
  showFinalizar: boolean;
  busy: boolean;
  folderCheckPending: boolean;
  modelLoading: boolean;
  isJobGenerating: boolean;
  createJobPending: boolean;
  createDigitalPending: boolean;
  exportCdrPending: boolean;
  imposicaoPending: boolean;
  abrirCorelPending: boolean;
  finalizeCorelPending: boolean;
  selectedModelId: number | null;
  cdrDisponivel: boolean;
  onGerarArquivo: () => void;
  onTimbradoA4Digital: () => void;
  onAbrirCorel: () => void;
  onFinalizarCorel: () => void;
  onGerarProvaCdr: () => void;
  onImposicao: () => void;
  className?: string;
};

function ActionButton({
  label,
  onClick,
  disabled,
  pending,
  tone = "default",
  title,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pending?: boolean;
  tone?: "default" | "primary" | "success" | "violet";
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-h-[4.25rem] w-full min-w-[4.75rem] flex-col items-center justify-center gap-1 rounded-lg border px-1.5 py-2 text-center text-[10px] font-semibold leading-tight shadow-sm transition disabled:opacity-55",
        tone === "primary" &&
          "border-secondary-blue bg-secondary-blue text-white hover:bg-secondary-blue/90",
        tone === "default" &&
          "border-secondary-blue bg-white text-secondary-blue hover:bg-secondary-blue/5",
        tone === "success" &&
          "border-emerald-600 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
        tone === "violet" &&
          "border-violet-600 bg-violet-50 text-violet-900 hover:bg-violet-100",
      )}
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
      <span>{pending ? "…" : label}</span>
    </button>
  );
}

export function PapelariaActionBar({
  showTimbradoA4Digital,
  showGerarProvaCdr,
  showFinalizar,
  busy,
  folderCheckPending,
  modelLoading,
  isJobGenerating,
  createJobPending,
  createDigitalPending,
  exportCdrPending,
  imposicaoPending,
  abrirCorelPending,
  finalizeCorelPending,
  selectedModelId,
  cdrDisponivel,
  onGerarArquivo,
  onTimbradoA4Digital,
  onAbrirCorel,
  onFinalizarCorel,
  onGerarProvaCdr,
  onImposicao,
  className,
}: PapelariaActionBarProps) {
  const baseDisabled =
    busy || folderCheckPending || modelLoading || !selectedModelId;
  const imposicaoDisabled =
    busy ||
    folderCheckPending ||
    !cdrDisponivel ||
    createJobPending ||
    createDigitalPending ||
    exportCdrPending ||
    imposicaoPending ||
    abrirCorelPending ||
    finalizeCorelPending ||
    isJobGenerating;

  return (
    <aside
      className={cn(
        "flex w-[5.75rem] shrink-0 flex-col gap-2 overflow-y-auto rounded-lg border border-sagra-border bg-white p-1.5 shadow-sm",
        className,
      )}
      aria-label="Ações da papelaria"
      data-testid="papelaria-action-bar"
    >
      <ActionButton
        label="Gerar arquivo"
        tone="primary"
        pending={createJobPending}
        disabled={
          baseDisabled ||
          createDigitalPending ||
          exportCdrPending ||
          imposicaoPending ||
          abrirCorelPending
        }
        onClick={onGerarArquivo}
      />
      {showTimbradoA4Digital ? (
        <ActionButton
          label="Timb A4 Digital"
          pending={createDigitalPending}
          disabled={
            baseDisabled ||
            createJobPending ||
            exportCdrPending ||
            imposicaoPending ||
            abrirCorelPending
          }
          onClick={onTimbradoA4Digital}
        />
      ) : null}
      <ActionButton
        label="Abrir Corel"
        pending={abrirCorelPending}
        disabled={
          baseDisabled ||
          createJobPending ||
          createDigitalPending ||
          exportCdrPending ||
          imposicaoPending ||
          finalizeCorelPending
        }
        onClick={onAbrirCorel}
      />
      {showFinalizar ? (
        <ActionButton
          label="Finalizar"
          tone="success"
          pending={finalizeCorelPending}
          disabled={finalizeCorelPending}
          title="Finalizar edição no Corel e montar a prova"
          onClick={onFinalizarCorel}
        />
      ) : null}
      {showGerarProvaCdr ? (
        <ActionButton
          label="Prova do Corel pronto"
          tone="violet"
          pending={exportCdrPending}
          disabled={
            baseDisabled ||
            createJobPending ||
            exportCdrPending ||
            imposicaoPending ||
            abrirCorelPending ||
            finalizeCorelPending ||
            isJobGenerating
          }
          title="Gerar prova do Corel pronto"
          onClick={onGerarProvaCdr}
        />
      ) : null}
      <ActionButton
        label="Imposição"
        pending={imposicaoPending}
        disabled={imposicaoDisabled}
        title="Gerar PDF de imposição (BordaF/BordaV)"
        onClick={onImposicao}
      />
    </aside>
  );
}
