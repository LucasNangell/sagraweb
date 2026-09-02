import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { OsDetails, OsSearchRow } from "../types";
import { OsDetailsPanel } from "./OsDetailsPanel";

const details: OsDetails = {
  MaquinaLink: "A1",
  Tiragem: 100,
  Pags: 4,
  FormatoLink: "A4",
  EntregPrazoLink: "Prometido p/",
  EntregData: "2026-09-02",
  EntregPeriodo: "Noite",
};

vi.mock("@/api/hooks/useOsDetails", () => ({
  useOsDetails: () => ({
    isSuccess: true,
    isFetching: false,
    isPending: false,
    isLoading: false,
    isError: false,
    data: details,
  }),
}));

vi.mock("@/api/hooks/useSubOs", () => ({
  useOsComponentes: () => ({
    data: [],
    isPending: false,
  }),
}));

const selected: OsSearchRow = {
  nr_os: 2244,
  ano: 2026,
};

describe("OsDetailsPanel entrega", () => {
  it("mostra data de entrega em DD/MM/YYYY e o turno de EntregPeriodo", () => {
    render(<OsDetailsPanel selected={selected} />);

    expect(screen.getByText("Data de entrega")).toBeInTheDocument();
    expect(screen.getByTestId("os-details-data")).toHaveValue("02/09/2026");
    expect(screen.getByText("Turno")).toBeInTheDocument();
    expect(screen.getByTestId("os-details-turno")).toHaveValue("Noite");
  });
});
