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
              ? "sagra-btn sagra-btn--primary sagra-btn--icon"
              : "sagra-btn sagra-btn--outline sagra-btn--icon"
          }
          style={compact ? { width: "1.75rem", height: "1.75rem" } : undefined}
        >
          {t.icon}
        </button>
      ))}
    </div>
  );
}
