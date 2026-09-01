import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OsUnirSubOsModal } from "./OsUnirSubOsModal";

describe("OsUnirSubOsModal", () => {
  it("confirma união na OS principal por padrão", () => {
    const onConfirm = vi.fn();
    render(
      <OsUnirSubOsModal
        open
        setor="SEFOC"
        osLabel="1396/2026"
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByTestId("os-unir-sub-os-root")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("os-unir-sub-os-confirm"));
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it("confirma somente neste componente", () => {
    const onConfirm = vi.fn();
    render(
      <OsUnirSubOsModal
        open
        setor="SEFOC"
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByLabelText("Somente neste componente"));
    fireEvent.click(screen.getByTestId("os-unir-sub-os-confirm"));
    expect(onConfirm).toHaveBeenCalledWith(false);
  });
});
