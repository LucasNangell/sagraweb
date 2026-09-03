export function ProducaoGanttLegend() {
  return (
    <div className="flex flex-wrap gap-3 border-t border-sagra-border bg-white px-3 py-2 text-[10px] text-slate-600">
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-2.5 w-5 rounded-sm border border-dashed border-slate-400" />
        Previsto pelo sistema
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-2.5 w-5 rounded-sm bg-emerald-500" />
        Concluído
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-2.5 w-5 rounded-sm bg-sky-500" />
        Em execução
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-2.5 w-5 rounded-sm border-2 border-dashed border-orange-500" />
        Atrasado
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-2.5 w-5 rounded-sm bg-slate-300" />
        Pendente
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-2.5 w-5 rounded-sm bg-[repeating-linear-gradient(135deg,#fde68a_0_4px,#fbbf24_4px_8px)]" />
        Pausa cliente
      </span>
    </div>
  );
}
