import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PapelariaAlignPicker } from "./PapelariaAlignPicker";

describe("PapelariaAlignPicker", () => {
  it("seleciona superior centro", () => {
    const onChange = vi.fn();
    render(
      <PapelariaAlignPicker align_h="esquerda" align_v="topo" onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId("papelaria-align-cell-0-1"));
    expect(onChange).toHaveBeenCalledWith({ align_h: "centro", align_v: "topo" });
  });
});
