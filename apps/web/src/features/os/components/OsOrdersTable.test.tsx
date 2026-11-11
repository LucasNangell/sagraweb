import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUserPreferenceSync } from "@/hooks/useUserPreferenceSync";
import { homeTestIds } from "@/lib/testId";
import {
  OS_HOME_TABLE_COLUMN_IDS,
  OS_HOME_TABLE_DEFAULT_VISIBLE_COLUMNS,
  OS_HOME_TABLE_DEFAULT_WIDTHS,
  OS_HOME_TABLE_LAYOUT_STORAGE_KEY,
  type OsHomeTableLayout,
} from "../osHomeTableLayout";
import type { OsSearchRow } from "../types";
import { OsOrdersTable } from "./OsOrdersTable";

vi.mock("@/api/os", () => ({
  fetchSubOsList: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/features/auth/authStore", () => ({
  useAuthStore: <T,>(selector: (state: { user: { ponto: number } | null }) => T) =>
    selector({ user: { ponto: 999 } }),
}));

vi.mock("@/hooks/useUserPreferenceSync", () => ({
  useUserPreferenceSync: vi.fn(),
}));

vi.mock("./OsContextMenu", () => ({
  OsRowContextMenu: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        start: index * 28,
        end: (index + 1) * 28,
        size: 28,
        key: index,
      })),
    getTotalSize: () => count * 28,
  }),
}));

const row: OsSearchRow = {
  nr_os: 2244,
  ano: 2026,
  titulo: "Ofício",
};

const DEFAULT_IDS = OS_HOME_TABLE_COLUMN_IDS.filter((id) =>
  OS_HOME_TABLE_DEFAULT_VISIBLE_COLUMNS.has(id),
);
const DEFAULT_TOTAL_WIDTH = DEFAULT_IDS.reduce(
  (sum, id) => sum + OS_HOME_TABLE_DEFAULT_WIDTHS[id],
  0,
);

function colWidth(container: HTMLElement, id: string): string {
  return (
    container.querySelector<HTMLElement>(`col[data-column-id="${id}"]`)?.style.width ?? ""
  );
}

function colPercent(container: HTMLElement, id: string): number {
  return Number.parseFloat(colWidth(container, id));
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(useUserPreferenceSync).mockClear();
});

function headerIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("thead th")).map(
    (th) => th.getAttribute("data-column-id") ?? "",
  );
}

function renderTable(extra: Partial<ComponentProps<typeof OsOrdersTable>> = {}) {
  return render(
    <OsOrdersTable
      rows={[row]}
      meta={{ page: 1, limit: 1, total_records: 1 }}
      isLoading={false}
      isError={false}
      selectedRow={null}
      onSelectRow={vi.fn()}
      onSortChange={vi.fn()}
      {...extra}
    />,
  );
}

describe("OsOrdersTable list expand toggle", () => {
  it("não renderiza o toggle sem callback", () => {
    renderTable();
    expect(
      screen.queryByTestId("os-table-expand-toggle"),
    ).not.toBeInTheDocument();
  });

  it("abre e fecha a lista com aria-expanded", () => {
    const onListExpandedChange = vi.fn();
    renderTable({
      listExpanded: false,
      onListExpandedChange,
    });
    const toggle = screen.getByTestId("os-table-expand-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-label", "Expandir lista de OS");

    fireEvent.click(toggle);
    expect(onListExpandedChange).toHaveBeenCalledWith(true);
  });

  it("recolhe ao clicar no toggle expandido", () => {
    const onListExpandedChange = vi.fn();
    renderTable({
      listExpanded: true,
      onListExpandedChange,
    });
    const toggle = screen.getByTestId("os-table-expand-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-label", "Recolher lista de OS");

    fireEvent.click(toggle);
    expect(onListExpandedChange).toHaveBeenCalledWith(false);
  });

  it("recolhe a lista ao selecionar um item", () => {
    const onSelectRow = vi.fn();
    const onListExpandedChange = vi.fn();
    renderTable({
      listExpanded: true,
      onSelectRow,
      onListExpandedChange,
    });

    fireEvent.click(screen.getAllByTestId("os-table-row-2026-2244")[0]);
    expect(onSelectRow).toHaveBeenCalled();
    expect(onListExpandedChange).toHaveBeenCalledWith(false);
  });

  it("desabilita o toggle durante edição de andamento", () => {
    renderTable({
      listExpanded: true,
      onListExpandedChange: vi.fn(),
      selectionLocked: true,
    });
    expect(screen.getByTestId("os-table-expand-toggle")).toBeDisabled();
  });
});

describe("OsOrdersTable column overflow", () => {
  it("sempre ocupa 100% da largura e mantém truncamento nas células", () => {
    const { container } = renderTable({
      rows: [
        {
          ...row,
          situacao: "Em andamento na gráfica com texto longo",
          titulo: "Título muito longo para forçar truncamento visual na célula",
        },
      ],
    });
    const table = container.querySelector("table");
    expect(table?.className).toContain("table-fixed");
    expect(table?.className).toContain("w-full");
    expect(table?.className).toContain("min-w-0");
    expect(table?.style.width).toBe("");
    const section = container.querySelector(
      `[data-testid="${homeTestIds.osTable}"]`,
    );
    expect(section?.querySelector(".overflow-x-hidden")).toBeTruthy();
    const dataRow = container.querySelector(
      `[data-testid="${homeTestIds.osTableRow(2026, 2244)}"]`,
    );
    const cell = dataRow?.querySelector("td");
    expect(cell?.className).toContain("overflow-hidden");
    expect(cell?.className).toContain("max-w-0");
    expect(
      screen.getByTitle("Em andamento na gráfica com texto longo").className,
    ).toContain("truncate");
  });

  it("larguras das colunas são percentuais proporcionais aos pesos (somam 100%)", () => {
    const { container } = renderTable();
    const total = DEFAULT_IDS.reduce((sum, id) => sum + colPercent(container, id), 0);
    expect(total).toBeCloseTo(100, 2);
    expect(colPercent(container, "titulo")).toBeCloseTo(
      (OS_HOME_TABLE_DEFAULT_WIDTHS.titulo / DEFAULT_TOTAL_WIDTH) * 100,
      3,
    );
    expect(colWidth(container, "titulo")).toMatch(/%$/);
  });
});

describe("OsOrdersTable sort header", () => {
  it("mostra o badge acima da seta de classificação", () => {
    renderTable({
      sorts: [
        { column: "ano", dir: "desc" },
        { column: "nr_os", dir: "asc" },
      ],
    });

    const anoHeader = screen.getByTestId(homeTestIds.osTableSort("ano"));
    const nrOsHeader = screen.getByTestId(homeTestIds.osTableSort("nr_os"));
    const anoBadge = screen.getByTestId(homeTestIds.osTableSortBadge("ano"));
    const nrOsBadge = screen.getByTestId(homeTestIds.osTableSortBadge("nr_os"));
    const anoArrow = anoHeader.querySelector(".lucide-arrow-up");
    const nrOsArrow = nrOsHeader.querySelector(".lucide-arrow-down");

    expect(anoBadge).toHaveTextContent("1º");
    expect(nrOsBadge).toHaveTextContent("2º");
    expect(
      screen.queryByTestId(homeTestIds.osTableSortBadge("produto")),
    ).toBeNull();
    expect(anoHeader).toContainElement(anoBadge);
    expect(anoArrow).toBeTruthy();
    expect(nrOsArrow).toBeTruthy();
    expect(anoBadge.compareDocumentPosition(anoArrow!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nrOsBadge.compareDocumentPosition(nrOsArrow!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("OsOrdersTable column resize", () => {
  it("renderiza handle de resize em todas as colunas exceto a última", () => {
    renderTable();
    for (const id of DEFAULT_IDS.slice(0, -1)) {
      expect(screen.getByTestId(homeTestIds.osTableResize(id))).toBeInTheDocument();
    }
    expect(screen.queryByTestId(homeTestIds.osTableResize("data_entrega"))).toBeNull();
  });

  it("clique curto no header continua ordenando", () => {
    const onSortChange = vi.fn();
    renderTable({ onSortChange });
    fireEvent.click(screen.getByTestId(homeTestIds.osTableSort("titulo")));
    expect(onSortChange).toHaveBeenCalledTimes(1);
  });

  it("arrastar a borda troca largura só com a vizinha, sem disparar sort", () => {
    const onSortChange = vi.fn();
    const { container } = renderTable({ onSortChange });
    const handle = screen.getByTestId(homeTestIds.osTableResize("titulo"));
    const before = Object.fromEntries(
      DEFAULT_IDS.map((id) => [id, colPercent(container, id)]),
    );

    fireEvent.mouseDown(handle, { clientX: 500 });
    fireEvent.mouseMove(document, { clientX: 560 });
    fireEvent.mouseUp(document, { clientX: 560 });
    fireEvent.click(handle);
    fireEvent.click(screen.getByTestId(homeTestIds.osTableSort("titulo")));

    expect(onSortChange).not.toHaveBeenCalled();
    // A lista continua 100%.
    const after = Object.fromEntries(
      DEFAULT_IDS.map((id) => [id, colPercent(container, id)]),
    );
    expect(Object.values(after).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
    expect(after.titulo).toBeCloseTo(((350 + 60) / DEFAULT_TOTAL_WIDTH) * 100, 3);
    expect(after.situacao).toBeCloseTo(((140 - 60) / DEFAULT_TOTAL_WIDTH) * 100, 3);
    for (const id of DEFAULT_IDS) {
      if (id === "titulo" || id === "situacao") continue;
      expect(after[id]).toBeCloseTo(before[id]!, 3);
    }
  });

  it("respeita a largura mínima da coluna vizinha", () => {
    const { container } = renderTable();
    const handle = screen.getByTestId(homeTestIds.osTableResize("titulo"));
    fireEvent.mouseDown(handle, { clientX: 500 });
    fireEvent.mouseMove(document, { clientX: 2000 });
    fireEvent.mouseUp(document, { clientX: 2000 });
    // situacao mínima = 70; titulo recebe o resto (350 + 140 - 70).
    expect(colPercent(container, "situacao")).toBeCloseTo((70 / DEFAULT_TOTAL_WIDTH) * 100, 3);
    expect(colPercent(container, "titulo")).toBeCloseTo((420 / DEFAULT_TOTAL_WIDTH) * 100, 3);
  });
});

describe("OsOrdersTable configurar lista", () => {
  it("engrenagem com tooltip abre o modal; não há botão Colunas", () => {
    renderTable();
    expect(screen.queryByText("Colunas")).toBeNull();
    const gear = screen.getByTestId(homeTestIds.osTableConfig);
    expect(gear).toHaveAttribute("title", "Configurar lista");
    expect(screen.queryByTestId(homeTestIds.osListConfigModal)).toBeNull();
    fireEvent.click(gear);
    expect(screen.getByTestId(homeTestIds.osListConfigModal)).toBeInTheDocument();
  });

  it("todos os campos disponíveis podem ser adicionados à lista", () => {
    const { container } = renderTable();
    fireEvent.click(screen.getByTestId(homeTestIds.osTableConfig));
    const extras = OS_HOME_TABLE_COLUMN_IDS.filter(
      (id) => !OS_HOME_TABLE_DEFAULT_VISIBLE_COLUMNS.has(id),
    );
    expect(extras.length).toBeGreaterThan(0);
    for (const id of extras) {
      fireEvent.click(screen.getByTestId(homeTestIds.osListConfigAdd(id)));
    }
    expect(screen.getByText("Todos os campos já estão na lista.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId(homeTestIds.osListConfigApply));

    expect(screen.queryByTestId(homeTestIds.osListConfigModal)).toBeNull();
    expect(headerIds(container)).toEqual([...OS_HOME_TABLE_COLUMN_IDS]);
    const total = OS_HOME_TABLE_COLUMN_IDS.reduce(
      (sum, id) => sum + colPercent(container, id),
      0,
    );
    expect(total).toBeCloseTo(100, 2);
  });

  it("campo adicionado mostra o valor da linha", () => {
    renderTable({ rows: [{ ...row, formato: "A4 210x297" }] });
    fireEvent.click(screen.getByTestId(homeTestIds.osTableConfig));
    fireEvent.click(screen.getByTestId(homeTestIds.osListConfigAdd("formato")));
    fireEvent.click(screen.getByTestId(homeTestIds.osListConfigApply));
    expect(screen.getByTestId(homeTestIds.osTableSort("formato"))).toBeInTheDocument();
    expect(screen.getByTitle("A4 210x297")).toBeInTheDocument();
  });

  it("campos extras não ordenam ao clicar no header", () => {
    const onSortChange = vi.fn();
    localStorage.setItem(
      OS_HOME_TABLE_LAYOUT_STORAGE_KEY,
      JSON.stringify({ visibility: { observacao: true } }),
    );
    renderTable({ onSortChange });
    fireEvent.click(screen.getByTestId(homeTestIds.osTableSort("observacao")));
    expect(onSortChange).not.toHaveBeenCalled();
  });

  it("remover, reordenar e aplicar atualiza a lista; cancelar descarta", () => {
    const { container } = renderTable();
    fireEvent.click(screen.getByTestId(homeTestIds.osTableConfig));
    fireEvent.click(screen.getByTestId(homeTestIds.osListConfigRemove("titulo")));
    fireEvent.click(screen.getByTestId(homeTestIds.osListConfigCancel));
    expect(headerIds(container)).toContain("titulo");

    fireEvent.click(screen.getByTestId(homeTestIds.osTableConfig));
    fireEvent.click(screen.getByTestId(homeTestIds.osListConfigRemove("titulo")));
    fireEvent.click(screen.getByTestId(homeTestIds.osListConfigUp("ano")));
    fireEvent.click(screen.getByTestId(homeTestIds.osListConfigApply));

    const ids = headerIds(container);
    expect(ids).not.toContain("titulo");
    expect(ids.slice(0, 2)).toEqual(["ano", "nr_os"]);
    expect(container.querySelector("table")?.className).toContain("w-full");
  });

  it("Nr OS não pode ser removida", () => {
    renderTable();
    fireEvent.click(screen.getByTestId(homeTestIds.osTableConfig));
    expect(screen.getByTestId(homeTestIds.osListConfigVisible("nr_os"))).toBeInTheDocument();
    expect(screen.queryByTestId(homeTestIds.osListConfigRemove("nr_os"))).toBeNull();
  });

  it("restaurar padrão volta campos, ordem e larguras padrão", () => {
    localStorage.setItem(
      OS_HOME_TABLE_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        order: ["titulo", "nr_os"],
        visibility: { ano: false, formato: true },
        widths: { titulo: 900 },
      }),
    );
    const { container } = renderTable();
    expect(headerIds(container)[0]).toBe("titulo");

    fireEvent.click(screen.getByTestId(homeTestIds.osTableConfig));
    fireEvent.click(screen.getByTestId(homeTestIds.osListConfigReset));
    fireEvent.click(screen.getByTestId(homeTestIds.osListConfigApply));

    expect(headerIds(container)).toEqual(DEFAULT_IDS);
    expect(colPercent(container, "titulo")).toBeCloseTo(
      (350 / DEFAULT_TOTAL_WIDTH) * 100,
      3,
    );
  });
});

describe("OsOrdersTable layout persistence", () => {
  it("carrega defaults quando não há layout salvo", () => {
    const { container } = renderTable();
    expect(headerIds(container)).toEqual(DEFAULT_IDS);
  });

  it("aplica ordem, campos e larguras do cache local", () => {
    localStorage.setItem(
      OS_HOME_TABLE_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        order: ["titulo", "nr_os", "ano"],
        visibility: { produto: false, nr_os: false, observacao: true },
        widths: { titulo: 420 },
      }),
    );
    const { container } = renderTable();
    const ids = headerIds(container);
    expect(ids.slice(0, 3)).toEqual(["titulo", "nr_os", "ano"]);
    expect(ids).not.toContain("produto");
    expect(ids).toContain("observacao");
    const total = ids.reduce(
      (sum, id) => sum + OS_HOME_TABLE_DEFAULT_WIDTHS[id as keyof typeof OS_HOME_TABLE_DEFAULT_WIDTHS],
      0,
    ) - 350 + 420;
    expect(colPercent(container, "titulo")).toBeCloseTo((420 / total) * 100, 3);
  });

  it("sincroniza a chave os_home_table_layout e aplica o layout remoto", () => {
    const { container } = renderTable();
    const call = vi.mocked(useUserPreferenceSync).mock.calls.at(-1)?.[0];
    expect(call?.key).toBe("os_home_table_layout");
    expect(call?.enabled).toBe(true);

    const remote: OsHomeTableLayout = {
      order: ["data_entrega", ...OS_HOME_TABLE_COLUMN_IDS.filter((id) => id !== "data_entrega")],
      visibility: {
        ...Object.fromEntries(
          OS_HOME_TABLE_COLUMN_IDS.map((id) => [id, OS_HOME_TABLE_DEFAULT_VISIBLE_COLUMNS.has(id)]),
        ),
        setor: false,
      } as OsHomeTableLayout["visibility"],
      widths: { ...OS_HOME_TABLE_DEFAULT_WIDTHS },
    };
    act(() => {
      (call?.onRemoteLoaded as (value: OsHomeTableLayout) => void)(remote);
    });

    const ids = headerIds(container);
    expect(ids[0]).toBe("data_entrega");
    expect(ids).not.toContain("setor");

    const latest = vi.mocked(useUserPreferenceSync).mock.calls.at(-1)?.[0];
    expect((latest?.watchValue as OsHomeTableLayout).order[0]).toBe("data_entrega");
  });
});
