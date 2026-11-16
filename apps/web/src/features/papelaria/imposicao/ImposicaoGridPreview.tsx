import { useState } from "react";

import type { PapelariaImposicaoConfig } from "./types";
import {
  fillGridOcupadas,
  fillGridWithPagina,
  type ImposicaoOcupada,
} from "./imposicaoConfigUtils";
import {
  buildImposicaoGridLayout,
  paintCellOcupada,
  rotateCellOcupada,
  type ImposicaoGridFace,
} from "./imposicaoGridLayout";

type Props = {
  config: PapelariaImposicaoConfig;
  onChange: (next: PapelariaImposicaoConfig) => void;
};

function FaceSvg({
  config,
  face,
  paintPagina,
  onCellClick,
  onCellRotate,
  label,
}: {
  config: PapelariaImposicaoConfig;
  face: ImposicaoGridFace;
  paintPagina: number;
  onCellClick: (col: number, row: number) => void;
  onCellRotate: (col: number, row: number) => void;
  label: string;
}) {
  const { folhaW, folhaH, cells } = buildImposicaoGridLayout(config, face);
  const cols = Math.max(1, config.grid.colunas);
  const rows = Math.max(1, config.grid.linhas);
  const maxSide = Math.max(folhaW, folhaH, 1);
  const viewBox = `0 0 ${folhaW} ${folhaH}`;
  const accent = face === "verso" ? "#7c3aed" : "#2563eb";
  const fillOcc = face === "verso" ? "#ede9fe" : "#dbeafe";
  const textOcc = face === "verso" ? "#4c1d95" : "#1e3a8a";

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <div className="overflow-hidden rounded-lg border border-slate-300 bg-slate-100 p-3">
        <svg
          viewBox={viewBox}
          className="mx-auto block w-full max-w-md bg-white shadow-sm"
          style={{ aspectRatio: `${folhaW} / ${folhaH}` }}
          role="img"
          aria-label={`${label}: folha ${folhaW}×${folhaH} mm, grade ${cols}×${rows}`}
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
            const fontSize = Math.min(cell.wMm, cell.hMm) * 0.28;
            const cx = cell.xMm + cell.wMm / 2;
            const cy = cell.yMmFromTop + cell.hMm / 2;
            const rot = cell.rotacao || 0;
            return (
              <g key={`${face}-${cell.col}-${cell.row}`}>
                <rect
                  x={cell.xMm}
                  y={cell.yMmFromTop}
                  width={cell.wMm}
                  height={cell.hMm}
                  rx={Math.min(cell.wMm, cell.hMm) * 0.04}
                  fill={occupied ? fillOcc : "#f1f5f9"}
                  stroke={occupied ? accent : "#cbd5e1"}
                  strokeWidth={maxSide * 0.003}
                  strokeDasharray={occupied ? undefined : `${maxSide * 0.01}`}
                  className="cursor-pointer"
                  onClick={() => onCellClick(cell.col, cell.row)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (occupied) onCellRotate(cell.col, cell.row);
                  }}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    if (occupied) onCellRotate(cell.col, cell.row);
                  }}
                >
                  <title>
                    {occupied
                      ? `Pág. ${cell.pagina}${rot ? ` · ${rot}°` : ""} — clique: pintar/limpar; duplo clique / botão direito: girar`
                      : `Em branco — clique para página ${paintPagina}`}
                  </title>
                </rect>
                {occupied ? (
                  <g transform={`rotate(${rot} ${cx} ${cy})`}>
                    <text
                      x={cx}
                      y={cy}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={fontSize}
                      fontWeight={700}
                      fill={textOcc}
                      className="pointer-events-none select-none"
                    >
                      {cell.pagina}
                    </text>
                    {rot ? (
                      <text
                        x={cx}
                        y={cy + fontSize * 0.85}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={Math.min(fontSize * 0.45, 7)}
                        fill={textOcc}
                        className="pointer-events-none select-none"
                      >
                        {rot}°
                      </text>
                    ) : null}
                  </g>
                ) : (
                  <text
                    x={cx}
                    y={cy}
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
    </div>
  );
}

export function ImposicaoGridPreview({ config, onChange }: Props) {
  const duplex = config.work_style === "Duplex";
  const cols = Math.max(1, config.grid.colunas);
  const rows = Math.max(1, config.grid.linhas);
  const [paintPagina, setPaintPagina] = useState(1);
  const [activeFace, setActiveFace] = useState<ImposicaoGridFace>("frente");

  const ocupadasFrenteCount =
    config.grid.ocupadas?.length ?? cols * rows;
  const ocupadasVersoCount =
    config.grid.ocupadas_verso?.length ?? cols * rows;

  const setFaceOcupadas = (
    face: ImposicaoGridFace,
    ocupadas: ImposicaoOcupada[] | undefined,
  ) => {
    if (face === "verso") {
      onChange({
        ...config,
        grid: {
          ...config.grid,
          ocupadas_verso: ocupadas,
        },
      });
      return;
    }
    onChange({
      ...config,
      grid: {
        ...config.grid,
        ocupadas,
      },
    });
  };

  const handleCellClick = (face: ImposicaoGridFace, col: number, row: number) => {
    setActiveFace(face);
    const current =
      face === "verso" ? config.grid.ocupadas_verso : config.grid.ocupadas;
    const next = paintCellOcupada(current, cols, rows, col, row, paintPagina);
    if (next.length < 1) return;
    setFaceOcupadas(face, next);
  };

  const handleCellRotate = (
    face: ImposicaoGridFace,
    col: number,
    row: number,
  ) => {
    setActiveFace(face);
    const current =
      face === "verso" ? config.grid.ocupadas_verso : config.grid.ocupadas;
    setFaceOcupadas(face, rotateCellOcupada(current, cols, rows, col, row));
  };

  const fillSequential = (face: ImposicaoGridFace) => {
    setFaceOcupadas(face, fillGridOcupadas(cols, rows));
  };

  const fillWithPaintPagina = (face: ImposicaoGridFace) => {
    setFaceOcupadas(face, fillGridWithPagina(cols, rows, paintPagina));
  };

  const clearNumbers = (face: ImposicaoGridFace) => {
    setFaceOcupadas(face, undefined);
  };

  return (
    <section
      className={`flex flex-col gap-2 ${duplex ? "max-w-5xl" : "max-w-3xl"}`}
      data-testid="imposicao-grid-preview"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold text-slate-700">
            Preview da grade
          </h3>
          <p className="text-[10px] text-slate-400">
            Clique: pintar página. Duplo clique ou botão direito: girar 90°.
            {duplex
              ? ` Frente: ${ocupadasFrenteCount} · Verso: ${ocupadasVersoCount}.`
              : ` ${ocupadasFrenteCount} página${ocupadasFrenteCount === 1 ? "" : "s"} na folha.`}
          </p>
        </div>
        <label className="flex flex-col gap-0.5 text-[10px] text-slate-600">
          Página ao clicar
          <input
            type="number"
            min={1}
            step={1}
            className="w-20 rounded border border-slate-300 px-2 py-1 text-xs text-slate-800"
            value={paintPagina}
            onChange={(e) =>
              setPaintPagina(Math.max(1, Math.floor(Number(e.target.value)) || 1))
            }
            data-testid="imposicao-paint-pagina"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
          onClick={() => fillWithPaintPagina(activeFace)}
          title={`Preenche ${duplex ? activeFace : "a grade"} com a página ${paintPagina}`}
        >
          Preencher com pág. {paintPagina}
          {duplex ? ` (${activeFace})` : ""}
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
          onClick={() => fillSequential(activeFace)}
        >
          Sequência 1…N{duplex ? ` (${activeFace})` : ""}
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
          onClick={() => clearNumbers(activeFace)}
        >
          Limpar números{duplex ? ` (${activeFace})` : ""}
        </button>
        {duplex ? (
          <>
            <button
              type="button"
              className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-medium text-blue-800 hover:bg-blue-100"
              onClick={() => fillWithPaintPagina("frente")}
            >
              Frente = pág. {paintPagina}
            </button>
            <button
              type="button"
              className="rounded border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-medium text-violet-800 hover:bg-violet-100"
              onClick={() => fillWithPaintPagina("verso")}
            >
              Verso = pág. {paintPagina}
            </button>
          </>
        ) : null}
      </div>

      <div className={`flex gap-3 ${duplex ? "flex-col sm:flex-row" : ""}`}>
        <FaceSvg
          config={config}
          face="frente"
          paintPagina={paintPagina}
          label={duplex ? "Frente" : "Folha"}
          onCellClick={(col, row) => handleCellClick("frente", col, row)}
          onCellRotate={(col, row) => handleCellRotate("frente", col, row)}
        />
        {duplex ? (
          <FaceSvg
            config={config}
            face="verso"
            paintPagina={paintPagina}
            label="Verso"
            onCellClick={(col, row) => handleCellClick("verso", col, row)}
            onCellRotate={(col, row) => handleCellRotate("verso", col, row)}
          />
        ) : null}
      </div>
    </section>
  );
}
