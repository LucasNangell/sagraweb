import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { homeTestIds } from "@/lib/testId";
import type { OsSearchRow } from "../types";
import { OsOrdersTable } from "./OsOrdersTable";

vi.mock("@/api/os", () => ({
  fetchSubOsList: vi.fn().mockResolvedValue([]),
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
