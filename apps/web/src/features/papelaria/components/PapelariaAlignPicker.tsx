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
 * Grade 3×3 para alinhamento do conteúdo (como no ícone de alinhamento).
 */
export function PapelariaAlignPicker({ align_h, align_v, onChange, className }: Props) {
  const sel = alignParaCelula(align_h, align_v);
  return (
    <div
      role="group"
      aria-label="Alinhamento do conteúdo"
      data-testid="papelaria-align-picker"
      className={cn(
        "inline-grid grid-cols-3 gap-0.5 rounded-md border border-slate-700 bg-slate-900 p-1",
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
                "size-4 rounded-[2px] border transition-colors",
                active
                  ? "border-slate-300 bg-slate-300"
                  : "border-slate-500 bg-transparent hover:border-slate-400",
              )}
              onClick={() => onChange(celulaParaAlign(row, col))}
            />
          );
        }),
      )}
    </div>
  );
}
