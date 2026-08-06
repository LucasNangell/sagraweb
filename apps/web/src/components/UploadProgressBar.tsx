interface UploadProgressBarProps {
  pct: number;
  label?: string;
}

export function UploadProgressBar({ pct, label }: UploadProgressBarProps) {
  const safe = Math.min(100, Math.max(0, Math.round(pct)));
  return (
    <div
      className="space-y-1"
      role="progressbar"
      aria-valuenow={safe}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? "Progresso do envio"}
    >
      <div className="flex justify-between gap-2 text-xs text-slate-600">
        <span className="min-w-0 truncate">{label ?? "Enviando…"}</span>
        <span className="shrink-0 tabular-nums">{safe}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-primary-green transition-[width] duration-150 ease-out"
          style={{ width: `${safe}%` }}
        />
      </div>
    </div>
  );
}
