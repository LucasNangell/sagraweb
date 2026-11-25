import { cn } from "@sagra/ui";

import {
  alignParaCelula,
  celulaParaAlign,
  type CampoExtraAlignH,
  type CampoExtraAlignV,
} from "@/features/papelaria/papelariaCamposExtras";

type Props = {
  align_h: CampoExtraAlignH;
  align_v: CampoExtraAlignV;
  onChange: (next: { align_h: CampoExtraAlignH; align_v: CampoExtraAlignV }) => void;
  className?: string;
};

const LABELS = [
  ["Superior esquerda", "Superior centro", "Superior direita"],
  ["Meio esquerda", "Centro", "Meio direita"],
  ["Inferior esquerda", "Inferior centro", "Inferior direita"],
] as const;

/**
 * Grade 3×3 para alinhamento/ancoragem do conteúdo — fundo claro, padrão SAGRA.
 */
export function PapelariaAlignPicker({ align_h, align_v, onChange, className }: Props) {
  const sel = alignParaCelula(align_h, align_v);
  return (
    <div
      role="group"
      aria-label="Alinhamento do conteúdo"
      data-testid="papelaria-align-picker"
      title="Alinhamento / ancoragem"
      className={cn(
        "inline-grid h-7 w-7 shrink-0 grid-cols-3 place-items-center gap-px rounded-md border border-sagra-border bg-white p-0.5",
        className,
      )}
    >
      {([0, 1, 2] as const).map((row) =>
        ([0, 1, 2] as const).map((col) => {
          const active = sel.row === row && sel.col === col;
          return (
            <button
              key={`${row}-${col}`}
              type="button"
              title={LABELS[row][col]}
              aria-label={LABELS[row][col]}
              aria-pressed={active}
              data-testid={`papelaria-align-cell-${row}-${col}`}
              className={cn(
                "size-[6px] rounded-[1px] transition-colors",
                active
                  ? "bg-secondary-blue"
                  : "bg-slate-300 hover:bg-slate-400",
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChange(celulaParaAlign(row, col))}
            />
          );
        }),
      )}
    </div>
  );
}
