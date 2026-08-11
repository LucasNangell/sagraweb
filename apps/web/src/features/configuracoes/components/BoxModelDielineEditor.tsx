import type { BoxModelConfig } from "@/api/boxModels";

export interface BoxModelDielineEditorProps {
  config: BoxModelConfig;
  selectedPanelId: string | null;
  selectedEdgeId: string | null;
  onSelectPanel: (id: string) => void;
  onSelectEdge: (id: string) => void;
}

export function BoxModelDielineEditor({
  config,
  selectedPanelId,
  selectedEdgeId,
  onSelectPanel,
  onSelectEdge,
}: BoxModelDielineEditorProps) {
  const cut = config.cutBboxMm;
  const pad = 8;
  const vbX = (cut?.x0Mm ?? 0) - pad;
  const vbY = (cut?.y0Mm ?? 0) - pad;
  const vbW = (cut?.widthMm ?? 100) + pad * 2;
  const vbH = (cut?.heightMm ?? 100) + pad * 2;
  const opByHinge = new Map(
    (config.operations ?? []).map((o) => [o.hingeId, o]),
  );
  const edges = config.edges ?? [];

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap gap-3 border-b border-slate-100 px-2 py-1.5 text-[10px] text-slate-600">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-sm bg-blue-400/50 ring-1 ring-blue-500" />
          Base
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-slate-800" />
          Corte
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-teal-500" />
          Dobra
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-amber-600" />
          Selecionado
        </span>
      </div>
      <svg
        viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
        className="mx-auto max-h-[420px] w-full"
        role="img"
        aria-label="Faca com painéis, cortes e dobras"
      >
        <rect
          x={cut?.x0Mm ?? 0}
          y={cut?.y0Mm ?? 0}
          width={cut?.widthMm ?? 0}
          height={cut?.heightMm ?? 0}
          fill="#f8fafc"
          stroke="#cbd5e1"
          strokeWidth={0.3}
        />
        {(config.panels ?? [])
          .filter((p) => p.active !== false)
          .map((p) => {
            const selected = p.id === selectedPanelId;
            const isBase = p.id === config.basePanelId;
            return (
              <g key={p.id}>
                <rect
                  x={p.xMm}
                  y={p.yMm}
                  width={p.wMm}
                  height={p.hMm}
                  fill={
                    selected
                      ? "rgba(31,122,77,0.3)"
                      : isBase
                        ? "rgba(59,130,246,0.22)"
                        : "rgba(148,163,184,0.1)"
                  }
                  stroke={selected ? "#1f7a4d" : isBase ? "#3b82f6" : "#94a3b8"}
                  strokeWidth={selected || isBase ? 1 : 0.35}
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectPanel(p.id);
                  }}
                />
                {p.wMm > 14 && p.hMm > 10 ? (
                  <text
                    x={p.xMm + p.wMm / 2}
                    y={p.yMm + p.hMm / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={Math.min(7, Math.max(4, p.wMm / 7))}
                    fill="#334155"
                    className="pointer-events-none select-none"
                  >
                    {p.label || p.id}
                    {isBase ? " ★" : ""}
                  </text>
                ) : null}
              </g>
            );
          })}

        {edges.map((edge) => {
          const selected = edge.id === selectedEdgeId;
          const isFold = edge.kind === "fold";
          const op = edge.hingeId ? opByHinge.get(edge.hingeId) : null;
          const midX = (edge.x1 + edge.x2) / 2;
          const midY = (edge.y1 + edge.y2) / 2;
          return (
            <g
              key={edge.id}
              className="cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onSelectEdge(edge.id);
              }}
            >
              <line
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                stroke="transparent"
                strokeWidth={7}
              />
              <line
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                stroke={
                  selected
                    ? "#b45309"
                    : isFold
                      ? "#0d9488"
                      : "#1e293b"
                }
                strokeWidth={selected ? 2.6 : isFold ? 1.7 : 1.4}
                strokeLinecap="round"
                strokeDasharray={isFold ? "3.5 2" : undefined}
              />
              {op ? (
                <g className="pointer-events-none">
                  <circle
                    cx={midX}
                    cy={midY}
                    r={3.2}
                    fill={selected ? "#b45309" : "#0f766e"}
                  />
                  <text
                    x={midX}
                    y={midY}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={3.5}
                    fontWeight={700}
                    fill="#fff"
                  >
                    {op.order}
                  </text>
                </g>
              ) : null}
            </g>
          );
        })}
      </svg>
      <p className="border-t border-slate-100 px-2 py-1 text-[10px] text-slate-500">
        Clique numa linha para marcar corte/dobra. Em dobras, use “Adicionar à
        sequência” (lista começa vazia). Números = ordem definida por você.
      </p>
    </div>
  );
}
