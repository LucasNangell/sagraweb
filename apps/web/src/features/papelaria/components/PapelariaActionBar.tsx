import { Loader2 } from "lucide-react";
import { cn } from "@sagra/ui";

export type PapelariaActionBarProps = {
  showAbrirPasta: boolean;
  showTimbradoA4Digital: boolean;
  showFinalizar: boolean;
  busy: boolean;
  folderCheckPending: boolean;
  modelLoading: boolean;
  isJobGenerating: boolean;
  createJobPending: boolean;
  createDigitalPending: boolean;
  imposicaoPending: boolean;
  abrirCorelPending: boolean;
  abrirPastaPending: boolean;
  finalizeCorelPending: boolean;
  hasOs: boolean;
  selectedModelId: number | null;
  /** .cdr utilizável já na pasta da SP: «Criar prova» parte dele. */
  corelDaPasta?: string | null;
  canImposicao: boolean;
  onAbrirPasta: () => void;
  onGerarArquivo: () => void;
  /** Exceção: gerar o arquivo CorelDRAW pelo worker. */
  onGerarCorel?: () => void;
  onTimbradoA4Digital: () => void;
  onAbrirCorel: () => void;
  onFinalizarCorel: () => void;
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
  showAbrirPasta,
  showTimbradoA4Digital,
  showFinalizar,
  busy,
  folderCheckPending,
  modelLoading,
  isJobGenerating,
  createJobPending,
  createDigitalPending,
  imposicaoPending,
  abrirCorelPending,
  abrirPastaPending,
  finalizeCorelPending,
  hasOs,
  selectedModelId,
  corelDaPasta = null,
  canImposicao,
  onAbrirPasta,
  onGerarArquivo,
  onGerarCorel,
  onTimbradoA4Digital,
  onAbrirCorel,
  onFinalizarCorel,
  onImposicao,
  className,
}: PapelariaActionBarProps) {
  const baseDisabled =
    busy || folderCheckPending || modelLoading || !selectedModelId;
  const imposicaoDisabled =
    busy ||
    folderCheckPending ||
    !canImposicao ||
    createJobPending ||
    createDigitalPending ||
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
      {showAbrirPasta ? (
        <ActionButton
          label="Abrir pasta"
          pending={abrirPastaPending}
          disabled={!hasOs || abrirPastaPending}
          title="Abrir pasta da SP selecionada"
          onClick={onAbrirPasta}
        />
      ) : null}
      <ActionButton
        label="Criar prova"
        tone="primary"
        pending={createJobPending}
        title={
          corelDaPasta
            ? `Criar prova a partir do Corel da pasta (${corelDaPasta}), aplicando os campos do formulário`
            : "Criar a prova (Prova PDF, gerada no servidor a partir do PDF do modelo)"
        }
        disabled={
          baseDisabled ||
          createDigitalPending ||
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
                    imposicaoPending ||
            abrirCorelPending
          }
          onClick={onTimbradoA4Digital}
        />
      ) : null}
      <p
        className="mt-1 border-t border-dashed border-sagra-border pt-1.5 text-center text-[9px] font-bold uppercase tracking-wide text-neutral-400 max-md:hidden"
        title="Use só quando a prova precisar de ajuste manual no CorelDRAW"
      >
        Exceção · Corel
      </p>
      {onGerarCorel ? (
        <ActionButton
          label="Gerar Corel"
          pending={false}
          title="Exceção: gerar o arquivo CorelDRAW (.cdr) desta OS a partir do PDF da prova, com os textos editáveis"
          disabled={
            baseDisabled ||
            createJobPending ||
            createDigitalPending ||
            imposicaoPending ||
            abrirCorelPending
          }
          onClick={onGerarCorel}
        />
      ) : null}
      <ActionButton
        label="Abrir Corel"
        pending={abrirCorelPending}
        disabled={
          baseDisabled ||
          createJobPending ||
          createDigitalPending ||
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
          title="Gerar a prova a partir do Corel editado (exceção)"
          onClick={onFinalizarCorel}
        />
      ) : null}
      <ActionButton
        label="Imposição"
        pending={imposicaoPending}
        disabled={imposicaoDisabled}
        title="Enviar JDF de imposição ao Apogee (BaseSefoc.pdf)"
        onClick={onImposicao}
      />
    </aside>
  );
}
