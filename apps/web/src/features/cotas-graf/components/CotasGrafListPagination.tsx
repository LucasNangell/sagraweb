import { ChevronLeft, ChevronRight } from "lucide-react";

export function CotasGrafListPagination({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
  itemLabel,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  itemLabel: string;
}) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const canPrev = page > 1;
  const canNext = page < totalPages;
  const plural = total !== 1 ? "s" : "";

  return (
    <div className="flex flex-col gap-2 border-t border-slate-100 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-center text-xs text-neutral-500 sm:text-left">
        {start}–{end} de {total} {itemLabel}
        {plural}
      </span>
      <div className="flex items-center justify-center gap-1">
        <button
          type="button"
          disabled={!canPrev}
          onClick={() => onPageChange(page - 1)}
          className="flex size-7 items-center justify-center rounded border border-sagra-border hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Página anterior"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-[2rem] text-center text-xs font-medium tabular-nums">
          {page}
        </span>
        <button
          type="button"
          disabled={!canNext}
          onClick={() => onPageChange(page + 1)}
          className="flex size-7 items-center justify-center rounded border border-sagra-border hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Próxima página"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
