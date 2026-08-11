import { TOOLS, type AnaliseLabTool } from "./AnaliseLabMarkTools";

interface AnaliseLabToolPaletteProps {
  tool: AnaliseLabTool;
  onToolChange: (tool: AnaliseLabTool) => void;
  busy?: boolean;
  compact?: boolean;
}

export function AnaliseLabToolPalette({
  tool,
  onToolChange,
  busy = false,
  compact = false,
}: AnaliseLabToolPaletteProps) {
  const size = compact ? "size-7" : "size-8";
  return (
    <div className="flex flex-wrap items-center gap-0.5">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          disabled={busy}
          title={t.label}
          aria-label={t.label}
          onClick={() => onToolChange(t.id)}
          className={
            tool === t.id
              ? `inline-flex ${size} items-center justify-center rounded bg-primary-green text-white`
              : `inline-flex ${size} items-center justify-center rounded border border-sagra-border bg-white text-neutral-700 hover:bg-neutral-50 disabled:opacity-50`
          }
        >
          {t.icon}
        </button>
      ))}
    </div>
  );
}
