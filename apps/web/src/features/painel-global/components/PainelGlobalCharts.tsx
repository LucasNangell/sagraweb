import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
  type Chart,
  type ChartOptions,
} from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { fetchPainelChartYearData } from "../painelGlobalApi";
import {
  getOpCategoryLabel,
  painelDisplayLabel,
  PAINEL_MONTH_NAMES,
  parseOpDateMonth,
} from "../painelGlobalUtils";
import type {
  PainelColumnDetail,
  PainelDrillDownParams,
  PainelOpItem,
  PainelRawOp,
  PainelTheme,
} from "../types";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarController,
  BarElement,
  Tooltip,
  Legend,
  ChartDataLabels,
);

function getChartColors(root: HTMLElement | null) {
  const target = root ?? document.documentElement;
  const style = getComputedStyle(target);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    textPrimary: read("--text-primary") || "#e1e1e6",
    chartGrid: read("--chart-grid") || "rgba(255, 255, 255, 0.05)",
    chartTicks: read("--chart-ticks") || "rgba(255, 255, 255, 0.5)",
  };
}

function isPainelChartCompactLayout() {
  return window.matchMedia("(max-width: 768px)").matches;
}

/** Libera o canvas mesmo quando a ref da instância foi perdida (ex.: StrictMode). */
function releaseChartOnCanvas(canvas: HTMLCanvasElement | null | undefined) {
  if (!canvas) {
    return;
  }
  const existing = ChartJS.getChart(canvas);
  if (existing) {
    existing.destroy();
  }
}

const PAINEL_CHART_CATEGORY_LABELS = [
  "Em andamento",
  "Entregue",
  "Cancelado",
] as const;

interface PainelGlobalChartsProps {
  theme: PainelTheme;
  availableYears: number[];
  includeOs: boolean;
  includeSp: boolean;
  selectedColumnDetail: PainelColumnDetail | null;
  onCloseColumnDetail: () => void;
  rootRef: React.RefObject<HTMLElement | null>;
}

export function PainelGlobalCharts({
  theme,
  availableYears,
  includeOs,
  includeSp,
  selectedColumnDetail,
  onCloseColumnDetail,
  rootRef,
}: PainelGlobalChartsProps) {
  const opsChartRef = useRef<HTMLCanvasElement>(null);
  const drillChartRef = useRef<HTMLCanvasElement>(null);
  const opsChartInstance = useRef<Chart | null>(null);
  const drillChartInstance = useRef<Chart | null>(null);

  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [selectedMonthForDrillDown, setSelectedMonthForDrillDown] = useState<
    string | null
  >(null);
  const [drillDownLevel, setDrillDownLevel] = useState(1);
  const [drillDownParams, setDrillDownParams] = useState<PainelDrillDownParams>({
    month: null,
    category: null,
    sector: null,
  });
  const allOpsForYearRef = useRef<PainelRawOp[]>([]);
  const drillDownLevelRef = useRef(drillDownLevel);
  const drillDownParamsRef = useRef(drillDownParams);
  drillDownLevelRef.current = drillDownLevel;
  drillDownParamsRef.current = drillDownParams;

  const showMainChart =
    !selectedColumnDetail && selectedMonthForDrillDown === null;
  const showDrillChart =
    !selectedColumnDetail && selectedMonthForDrillDown !== null;

  const destroyOpsChart = useCallback(() => {
    if (opsChartInstance.current) {
      opsChartInstance.current.destroy();
      opsChartInstance.current = null;
    }
    releaseChartOnCanvas(opsChartRef.current);
  }, []);

  const destroyDrillChart = useCallback(() => {
    if (drillChartInstance.current) {
      drillChartInstance.current.destroy();
      drillChartInstance.current = null;
    }
    releaseChartOnCanvas(drillChartRef.current);
  }, []);

  const renderDrillDownChartRef = useRef<
    ((data: { name: string; count: number }[], indexAxis?: "x" | "y") => void) | null
  >(null);

  const showDrillDownLevel3 = useCallback(
    (sectorName: string) => {
      const { month } = drillDownParamsRef.current;
      if (month == null) {
        return;
      }

      const monthName = PAINEL_MONTH_NAMES[month];
      setDrillDownLevel(3);
      setDrillDownParams((prev) => ({ ...prev, sector: sectorName }));
      setSelectedMonthForDrillDown(`${monthName} - ${sectorName} (por Andamento)`);

      const sectorOps = allOpsForYearRef.current.filter((op) => {
        const opMonth = parseOpDateMonth(op);
        if (opMonth !== month) {
          return false;
        }
        const situ = (op.situacao ?? op.SituacaoLink ?? "").trim();
        const opSector = (op.setor ?? "N/I").trim();
        const isEmAndamento =
          situ !== "Entregue" &&
          situ !== "Cancelado" &&
          situ !== "Cancelada";
        return isEmAndamento && opSector === sectorName;
      });

      const statusCounts: Record<string, number> = {};
      for (const op of sectorOps) {
        const st = (op.situacao ?? "Desconhecido").trim();
        statusCounts[st] = (statusCounts[st] ?? 0) + 1;
      }

      const sortedData = Object.entries(statusCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      renderDrillDownChartRef.current?.(sortedData, "y");
    },
    [],
  );

  const renderDrillDownChart = useCallback(
    (data: { name: string; count: number }[], indexAxis: "x" | "y" = "y") => {
      const canvas = drillChartRef.current;
      if (!canvas) {
        return;
      }

      destroyDrillChart();
      const colors = getChartColors(rootRef.current);
      const compact = isPainelChartCompactLayout();

      try {
        drillChartInstance.current = new ChartJS(canvas, {
        type: "bar",
        data: {
          labels: data.map((d) => d.name),
          datasets: [
            {
              label: "Quantidade",
              data: data.map((d) => d.count),
              backgroundColor:
                indexAxis === "x"
                  ? "rgba(52, 152, 219, 0.6)"
                  : "rgba(155, 127, 240, 0.6)",
              borderColor:
                indexAxis === "x"
                  ? "rgba(52, 152, 219, 1)"
                  : "rgba(155, 127, 240, 1)",
              borderWidth: 1,
              borderRadius: 4,
              hoverBackgroundColor:
                indexAxis === "x"
                  ? "rgba(52, 152, 219, 0.8)"
                  : "rgba(155, 127, 240, 0.8)",
            },
          ],
        },
        options: {
          indexAxis,
          responsive: true,
          maintainAspectRatio: false,
          layout: {
            padding: {
              right: indexAxis === "y" ? (compact ? 45 : 65) : 10,
              top: compact ? 10 : 25,
              bottom: 10,
            },
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "#1c1c1f",
              titleColor: indexAxis === "x" ? "#3498db" : "#9b7ff0",
              bodyColor: "#fff",
              borderColor: "#333",
              borderWidth: 1,
            },
            datalabels: {
              color: colors.textPrimary,
              anchor: "end",
              align: indexAxis === "y" ? "right" : "top",
              offset: 4,
              font: { weight: "bold", size: 11 },
              formatter: (value: number) => value,
            },
          },
          scales: {
            x: {
              beginAtZero: true,
              grid: {
                display: indexAxis === "y",
                color: colors.chartGrid,
              },
              ticks: { color: colors.chartTicks, stepSize: 1 },
            },
            y: {
              grid: {
                display: indexAxis === "x",
                color: colors.chartGrid,
              },
              ticks: {
                color: colors.chartTicks,
                font: { size: compact ? 9 : 10 },
                autoSkip: false,
              },
            },
          },
          onClick: (_event, elements) => {
            if (
              elements.length > 0 &&
              drillDownLevelRef.current === 2 &&
              drillDownParamsRef.current.category === 0
            ) {
              const index = elements[0]!.index;
              const sectorName = data[index]?.name;
              if (sectorName) {
                showDrillDownLevel3(sectorName);
              }
            }
          },
        },
      });
      } catch (err) {
        console.error("[Chart] Falha ao criar gráfico drill-down:", err);
      }
    },
    [destroyDrillChart, rootRef, showDrillDownLevel3],
  );

  renderDrillDownChartRef.current = renderDrillDownChart;

  const showDrillDown = useCallback(
    (monthIndex: number, datasetIndex = 0) => {
      const monthName = PAINEL_MONTH_NAMES[monthIndex]!;
      const categoryLabel =
        PAINEL_CHART_CATEGORY_LABELS[datasetIndex] ?? "Em andamento";

      setDrillDownLevel(2);
      setDrillDownParams({
        month: monthIndex,
        category: datasetIndex,
        sector: null,
      });
      setSelectedMonthForDrillDown(`${monthName} - ${categoryLabel}`);

      const monthOps = allOpsForYearRef.current.filter((op) => {
        const opMonth = parseOpDateMonth(op);
        if (opMonth !== monthIndex) {
          return false;
        }
        return getOpCategoryLabel(op) === categoryLabel;
      });

      const counts: Record<string, number> = {};
      const isEmAndamento = categoryLabel === "Em andamento";

      for (const op of monthOps) {
        const key = isEmAndamento
          ? (op.setor ?? "N/I")
          : (op.produto ?? op.Produto ?? "Não informado");
        counts[key] = (counts[key] ?? 0) + 1;
      }

      const sortedData = Object.entries(counts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      renderDrillDownChart(sortedData, isEmAndamento ? "x" : "y");
    },
    [renderDrillDownChart],
  );

  const closeDrillDown = useCallback(() => {
    if (drillDownLevelRef.current === 3) {
      const params = drillDownParamsRef.current;
      if (params.month != null && params.category != null) {
        showDrillDown(params.month, params.category);
      }
      return;
    }

    setSelectedMonthForDrillDown(null);
    setDrillDownLevel(1);
    setDrillDownParams({ month: null, category: null, sector: null });
    destroyDrillChart();
  }, [destroyDrillChart, showDrillDown]);

  const showDrillDownRef = useRef(showDrillDown);
  showDrillDownRef.current = showDrillDown;

  const updateChartData = useCallback(async () => {
    if (!opsChartInstance.current) {
      return;
    }

    const dataEmAndamento = new Array<number>(12).fill(0);
    const dataEntregue = new Array<number>(12).fill(0);
    const dataCancelado = new Array<number>(12).fill(0);

    try {
      const items = await fetchPainelChartYearData(selectedYear, {
        includeOs,
        includeSp,
      });
      allOpsForYearRef.current = items;

      for (const os of items) {
        const month = parseOpDateMonth(os);
        if (month == null) {
          continue;
        }
        const category = getOpCategoryLabel(os);
        if (category === "Entregue") {
          dataEntregue[month]! += 1;
        } else if (category === "Cancelado") {
          dataCancelado[month]! += 1;
        } else {
          dataEmAndamento[month]! += 1;
        }
      }
    } catch (err) {
      console.warn("[Chart] Error fetching data for year", selectedYear, err);
    }

    opsChartInstance.current.data.datasets[0]!.data = dataEmAndamento;
    opsChartInstance.current.data.datasets[1]!.data = dataEntregue;
    opsChartInstance.current.data.datasets[2]!.data = dataCancelado;
    opsChartInstance.current.update();

    const params = drillDownParamsRef.current;
    if (params.month != null && params.category != null) {
      showDrillDownRef.current(params.month, params.category);
    }
  }, [includeOs, includeSp, selectedYear]);

  const updateChartDataRef = useRef(updateChartData);
  updateChartDataRef.current = updateChartData;

  const initOpsChart = useCallback(() => {
    const canvas = opsChartRef.current;
    if (!canvas) {
      return;
    }

    destroyOpsChart();
    const colors = getChartColors(rootRef.current);
    const compact = isPainelChartCompactLayout();

    try {
      opsChartInstance.current = new ChartJS(canvas, {
        type: "bar",
        data: {
          labels: [
          "Jan",
          "Fev",
          "Mar",
          "Abr",
          "Mai",
          "Jun",
          "Jul",
          "Ago",
          "Set",
          "Out",
          "Nov",
          "Dez",
        ],
        datasets: [
          {
            label: "Em andamento",
            data: new Array(12).fill(0),
            backgroundColor: "rgba(52, 152, 219, 0.6)",
            borderColor: "rgba(52, 152, 219, 1)",
            borderWidth: 1,
            borderRadius: 4,
            hoverBackgroundColor: "rgba(52, 152, 219, 0.8)",
          },
          {
            label: "Entregue",
            data: new Array(12).fill(0),
            backgroundColor: "rgba(46, 204, 113, 0.6)",
            borderColor: "rgba(46, 204, 113, 1)",
            borderWidth: 1,
            borderRadius: 4,
            hoverBackgroundColor: "rgba(46, 204, 113, 0.8)",
          },
          {
            label: "Cancelado",
            data: new Array(12).fill(0),
            backgroundColor: "rgba(231, 76, 60, 0.6)",
            borderColor: "rgba(231, 76, 60, 1)",
            borderWidth: 1,
            borderRadius: 4,
            hoverBackgroundColor: "rgba(231, 76, 60, 0.8)",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: compact ? "bottom" : "top",
            labels: {
              color: colors.textPrimary,
              boxWidth: compact ? 10 : 12,
              font: { size: compact ? 9 : 10 },
              padding: compact ? 8 : 12,
            },
          },
          tooltip: {
            backgroundColor: "#1c1c1f",
            titleColor: "#fff",
            bodyColor: "#fff",
            borderColor: "#333",
            borderWidth: 1,
          },
          datalabels: {
            color: colors.textPrimary,
            anchor: "end",
            align: "top",
            offset: 2,
            font: { weight: "bold", size: 10 },
            formatter: (value: number) => (value > 0 ? value : ""),
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: colors.chartGrid },
            ticks: { color: colors.chartTicks, stepSize: 1 },
          },
          x: {
            grid: { display: false },
            ticks: {
              color: colors.chartTicks,
              font: { size: compact ? 9 : 12 },
            },
          },
        },
        onClick: (_event, elements) => {
          if (elements.length > 0) {
            showDrillDownRef.current(elements[0]!.index, elements[0]!.datasetIndex);
          }
        },
      } satisfies ChartOptions<"bar">,
      });
    } catch (err) {
      console.error("[Chart] Falha ao criar gráfico principal:", err);
    }
  }, [destroyOpsChart, rootRef]);

  const initOpsChartRef = useRef(initOpsChart);
  initOpsChartRef.current = initOpsChart;

  useLayoutEffect(() => {
    if (!showMainChart) {
      destroyOpsChart();
      return;
    }

    let cancelled = false;

    const mountChartWhenReady = () => {
      if (cancelled || !opsChartRef.current) {
        return;
      }

      const canvas = opsChartRef.current;
      const container =
        canvas.closest(".chart-content") ?? canvas.parentElement;
      if (!container || container.clientWidth < 1) {
        return;
      }

      if (opsChartInstance.current) {
        opsChartInstance.current.resize();
        return;
      }

      initOpsChartRef.current();
      if (opsChartInstance.current) {
        void updateChartDataRef.current();
      }
    };

    const frame = requestAnimationFrame(mountChartWhenReady);

    const container =
      opsChartRef.current?.closest(".chart-content") ??
      opsChartRef.current?.parentElement;
    const resizeObserver =
      container &&
      new ResizeObserver(() => {
        if (cancelled || !opsChartInstance.current) {
          return;
        }
        opsChartInstance.current.resize();
      });

    if (resizeObserver && container) {
      resizeObserver.observe(container);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      destroyOpsChart();
    };
  }, [destroyOpsChart, includeOs, includeSp, showMainChart, theme, selectedYear]);

  useEffect(() => {
    if (!showDrillChart) {
      destroyDrillChart();
      return;
    }

    let cancelled = false;

    const mountDrillChartWhenReady = () => {
      if (cancelled || !drillChartRef.current) {
        return;
      }

      const container =
        drillChartRef.current.closest(".chart-content") ??
        drillChartRef.current.parentElement;
      if (!container || container.clientWidth < 1) {
        return;
      }

      const params = drillDownParamsRef.current;
      if (params.month != null && params.category != null) {
        showDrillDownRef.current(params.month, params.category);
        return;
      }

      drillChartInstance.current?.resize();
    };

    const frame = requestAnimationFrame(mountDrillChartWhenReady);
    const container = drillChartRef.current?.parentElement;
    const resizeObserver =
      container &&
      new ResizeObserver(() => {
        mountDrillChartWhenReady();
      });

    if (resizeObserver && container) {
      resizeObserver.observe(container);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
    };
  }, [destroyDrillChart, showDrillChart, theme]);

  useEffect(() => {
    if (!showMainChart) {
      return;
    }
    const chartTimer = window.setInterval(() => {
      void updateChartDataRef.current();
    }, 60_000);
    return () => window.clearInterval(chartTimer);
  }, [includeOs, includeSp, showMainChart, selectedYear]);

  useEffect(() => {
    return () => {
      destroyOpsChart();
      destroyDrillChart();
    };
  }, [destroyDrillChart, destroyOpsChart]);

  if (selectedColumnDetail) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <div
          className="charts-header"
          style={{
            background: "var(--card-bg)",
            borderBottom: "1px solid var(--border-color)",
          }}
        >
          <span className="charts-title">
            Detalhes:{" "}
            <span style={{ color: "var(--highlight)" }}>
              {selectedColumnDetail.title}
            </span>
            <span
              style={{
                fontSize: "0.8rem",
                marginLeft: "0.5rem",
                opacity: 0.6,
                fontWeight: "normal",
                color: "var(--text-secondary)",
              }}
            >
              ({selectedColumnDetail.items.length} OPs)
            </span>
          </span>
          <button type="button" className="year-select" onClick={onCloseColumnDetail}>
            ✕ Voltar ao gráfico
          </button>
        </div>
        <div
          className="summary-list-container"
          style={{ flex: 1, overflowY: "auto", background: "#121214" }}
        >
          <table className="summary-list-table">
            <tbody>
              {selectedColumnDetail.items.map((os) => (
                <PainelListRow key={os.uniqueKey} os={os} solicitanteWidth={250} />
              ))}
              {selectedColumnDetail.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    style={{ textAlign: "center", padding: "2rem", opacity: 0.5 }}
                  >
                    Nenhuma OP neste setor no momento.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="charts-panel">
      {selectedMonthForDrillDown === null ? (
        <div className="charts-header">
          <span className="charts-title">Volume de OPs por Mês</span>
          <div className="year-selector-container">
            <label
              htmlFor="year-select"
              style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}
            >
              Ano:
            </label>
            <select
              id="year-select"
              className="year-select"
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
            >
              {availableYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <div className="charts-header">
          <span className="charts-title">{selectedMonthForDrillDown}</span>
          <button type="button" className="year-select" onClick={closeDrillDown}>
            {drillDownLevel === 3 ? (
              <span>✕ Voltar para Setores</span>
            ) : (
              <span>✕ Voltar para Geral</span>
            )}
          </button>
        </div>
      )}

      <div
        className="chart-content"
        style={{
          display: showMainChart ? "flex" : "none",
          flex: showMainChart ? "1 1 0" : "0 0 auto",
        }}
      >
        <canvas id="opsChart" ref={opsChartRef} />
      </div>
      <div
        className="chart-content"
        style={{
          display: showDrillChart ? "flex" : "none",
          flex: showDrillChart ? "1 1 0" : "0 0 auto",
        }}
      >
        <canvas id="drillDownChart" ref={drillChartRef} />
      </div>
    </div>
  );
}

function PainelListRow({
  os,
  solicitanteWidth = 220,
}: {
  os: PainelOpItem;
  solicitanteWidth?: number;
}) {
  return (
    <tr className={os.priorityType ?? undefined}>
      <td style={{ width: 100, fontWeight: 950 }}>
        {painelDisplayLabel(os)}
      </td>
      <td>
        <div style={{ fontWeight: 900 }}>
          {os.titulo ?? os.Titulo ?? "Sem título"}
        </div>
        <div style={{ fontSize: "0.75rem", opacity: 0.8 }}>
          {os.produto ?? os.Produto ?? os.prod_nome ?? "Prod. não inf."}
        </div>
      </td>
      <td style={{ width: solicitanteWidth }}>
        <div style={{ fontWeight: 900, opacity: 0.9 }}>
          {os.normalizedSolicitante}
        </div>
      </td>
      <td style={{ width: 150 }}>
        <div style={{ fontWeight: 900 }}>{os.setor}</div>
        <div style={{ fontSize: "0.75rem", opacity: 0.8 }}>
          {os.displaySituacao || os.situacao}
        </div>
      </td>
      <td style={{ width: 180, textAlign: "right" }}>
        <div style={{ fontWeight: 900, color: "var(--text-primary)" }}>
          {os.prioridade || "Normal"}
        </div>
        <div
          style={{
            fontSize: "0.75rem",
            color: "var(--text-secondary)",
            whiteSpace: "nowrap",
          }}
        >
          Entrega: {os.normalizedEntrega || "Não inf."}{" "}
          {os.normalizedTurno ? `(${os.normalizedTurno})` : ""}
        </div>
      </td>
    </tr>
  );
}
