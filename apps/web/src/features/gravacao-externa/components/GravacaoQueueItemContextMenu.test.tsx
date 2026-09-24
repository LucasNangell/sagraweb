import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GravacaoQueueItemContextMenu } from "./GravacaoQueueItemContextMenu";

describe("GravacaoQueueItemContextMenu", () => {
  it("abre no clique direito e executa a remoção", async () => {
    const onRemove = vi.fn();
    render(
      <GravacaoQueueItemContextMenu
        enabled
        label="OS 00101/26"
        onRemove={onRemove}
      >
        <button type="button">OS 00101/26</button>
      </GravacaoQueueItemContextMenu>,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "OS 00101/26" }));
    fireEvent.click(await screen.findByText("Remover da lista"));

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("não disponibiliza o menu quando desabilitado", () => {
    render(
      <GravacaoQueueItemContextMenu
        enabled={false}
        label="OS 00101/26"
        onRemove={vi.fn()}
      >
        <button type="button">OS 00101/26</button>
      </GravacaoQueueItemContextMenu>,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "OS 00101/26" }));
    expect(screen.queryByText("Remover da lista")).toBeNull();
  });
});
