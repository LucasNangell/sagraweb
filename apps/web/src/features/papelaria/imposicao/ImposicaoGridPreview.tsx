import type { PapelariaImposicaoConfig } from "./types";
import {
  fillGridOcupadas,
  type ImposicaoOcupada,
} from "./imposicaoConfigUtils";
import {
  buildImposicaoGridLayout,
  toggleCellOcupada,
} from "./imposicaoGridLayout";

type Props = {
  config: PapelariaImposicaoConfig;
  onChange: (next: PapelariaImposicaoConfig) => void;
};

export function ImposicaoGridPreview({ config, onChange }: Props) {
  const { folhaW, folhaH, cells } = buildImposicaoGridLayout(config);
  const cols = Math.max(1, config.grid.colunas);
  const rows = Math.max(1, config.grid.linhas);
  const ocupadasCount =
    config.grid.ocupadas?.length ?? cols * rows;
  const maxSide = Math.max(folhaW, folhaH, 1);
  const viewBox = `0 0 ${folhaW} ${folhaH}`;

  const setOcupadas = (ocupadas: ImposicaoOcupada[] | undefined) => {
    onChange({
      ...config,
      grid: {
        ...config.grid,
        ocupadas,
      },
    });
  };

  const handleCellClick = (col: number, row: number) => {
    const next = toggleCellOcupada(
      config.grid.ocupadas,
      cols,
      rows,
      col,
      row,
    );
    if (next.length < 1) return;
    setOcupadas(next);
  };

  return (
    <section className="flex max-w-3xl flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold text-slate-700">
            Preview da grade
          </h3>
          <p className="text-[10px] text-slate-400">
            Clique numa célula para numerar ou limpar (espaço em branco).{" "}
            {ocupadasCount} página{ocupadasCount === 1 ? "" : "s"} na folha.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => setOcupadas(fillGridOcupadas(cols, rows))}
          >
            Preencher grade
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => setOcupadas(undefined)}
          >
            Limpar números
          </button>
        </div>
      </div>

      <div
        className="overflow-hidden rounded-lg border border-slate-300 bg-slate-100 p-3"
        data-testid="imposicao-grid-preview"
      >
        <svg
          viewBox={viewBox}
          className="mx-auto block w-full max-w-lg bg-white shadow-sm"
          style={{ aspectRatio: `${folhaW} / ${folhaH}` }}
          role="img"
          aria-label={`Folha ${folhaW}×${folhaH} mm, grade ${cols}×${rows}`}
        >
          <rect
            x={0}
            y={0}
            width={folhaW}
            height={folhaH}
            fill="#f8fafc"
            stroke="#94a3b8"
            strokeWidth={maxSide * 0.004}
          />
          {cells.map((cell) => {
            const occupied = cell.pagina != null;
            const fontSize = Math.min(cell.wMm, cell.hMm) * 0.35;
            return (
              <g key={`${cell.col}-${cell.row}`}>
                <rect
                  x={cell.xMm}
                  y={cell.yMmFromTop}
                  width={cell.wMm}
                  height={cell.hMm}
                  rx={Math.min(cell.wMm, cell.hMm) * 0.04}
                  fill={occupied ? "#dbeafe" : "#f1f5f9"}
                  stroke={occupied ? "#2563eb" : "#cbd5e1"}
                  strokeWidth={maxSide * 0.003}
                  strokeDasharray={occupied ? undefined : `${maxSide * 0.01}`}
                  className="cursor-pointer"
                  onClick={() => handleCellClick(cell.col, cell.row)}
                >
                  <title>
                    {occupied
                      ? `Página ${cell.pagina} — clique para limpar`
                      : "Em branco — clique para numerar"}
                  </title>
                </rect>
                {occupied ? (
                  <text
                    x={cell.xMm + cell.wMm / 2}
                    y={cell.yMmFromTop + cell.hMm / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={fontSize}
                    fontWeight={700}
                    fill="#1e3a8a"
                    className="pointer-events-none select-none"
                  >
                    {cell.pagina}
                  </text>
                ) : (
                  <text
                    x={cell.xMm + cell.wMm / 2}
                    y={cell.yMmFromTop + cell.hMm / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={Math.min(fontSize * 0.45, 8)}
                    fill="#94a3b8"
                    className="pointer-events-none select-none"
                  >
                    vazio
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
