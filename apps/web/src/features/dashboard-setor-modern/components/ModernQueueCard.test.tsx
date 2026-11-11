import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { DashboardOsItem } from "@/features/dashboard-setor/types";
import { ModernQueueCard } from "./ModernQueueCard";

afterEach(cleanup);

const item: DashboardOsItem = {
  nr_os: 1428,
  ano: 2026,
  uniqueKey: "1428-2026",
  pcp_ordem: null,
  displaySituacao: "Em Execução",
  priorityType: "priority-high",
  isNew: true,
};

describe("prioridades no painel de TV", () => {
  it.each([
    ["priority-high", "Prometido"],
    ["priority-medium", "Solicitado"],
  ] as const)(
    "mantém a cor de %s sem exibir selo ao atualizar a OP",
    (priorityType, label) => {
      render(<ModernQueueCard item={{ ...item, priorityType }} index={0} />);
      expect(screen.queryByText(label)).not.toBeInTheDocument();
      expect(screen.getByRole("article")).toHaveClass(priorityType);
      expect(screen.queryByText("Atualizada")).not.toBeInTheDocument();
      expect(screen.getByRole("article")).toHaveAccessibleName(
        expect.stringContaining(label),
      );
    },
  );

  it("não atribui prioridade a uma OP comum", () => {
    render(
      <ModernQueueCard
        item={{ ...item, priorityType: null, isNew: false }}
        index={0}
      />,
    );
    expect(screen.queryByText("Prometido")).not.toBeInTheDocument();
    expect(screen.queryByText("Solicitado")).not.toBeInTheDocument();
  });

  it("exibe quem registrou o andamento e omite o título e o solicitante", () => {
    render(
      <ModernQueueCard
        item={{
          ...item,
          titulo: "Título da publicação",
          nome_usuario: "Solicitante da OS",
          andamento_usuario: "Ana Silva",
        }}
        index={0}
      />,
    );
    expect(screen.getByText("Ana Silva")).toBeVisible();
    expect(screen.queryByText("Título da publicação")).not.toBeInTheDocument();
    expect(screen.queryByText("Solicitante da OS")).not.toBeInTheDocument();
  });

  it("não inventa o autor quando o andamento não informa um nome", () => {
    const { container } = render(
      <ModernQueueCard
        item={{
          ...item,
          nome_usuario: "Solicitante da OS",
          andamento_usuario: "  ",
        }}
        index={0}
      />,
    );
    expect(container.querySelector(".setor-modern-card-author")).toBeNull();
    expect(screen.queryByText("Solicitante da OS")).not.toBeInTheDocument();
  });

  it("oculta o relógio quando a configuração desliga o tempo da OS", () => {
    render(<ModernQueueCard item={item} index={0} showTime={false} />);
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(screen.queryByText("Sem horário")).not.toBeInTheDocument();
  });

  it("renderiza a composição HTML do laboratório com OS, situação e carimbo", () => {
    const { container } = render(
      <ModernQueueCard
        item={{ ...item, andamento_usuario: "Ana Silva" }}
        index={0}
        cardStyle={{
          models: {
            high: { effect: "lab-vidro-fosco" },
            medium: { effect: "" },
            normal: { effect: "" },
          },
          entryAnimation: "none",
        }}
      />,
    );
    const card = container.querySelector(".setor-modern-card");
    expect(card).toHaveAttribute("data-model", "lab-vidro-fosco");
    expect(container.querySelector(".mx-shell")).not.toBeNull();
    expect(container.querySelector(".mx-mat-1")).not.toBeNull();
    expect(screen.getByText("OS 1428/26")).toBeVisible();
    expect(screen.getByText("Em Execução")).toBeVisible();
    expect(screen.getByText("Ana Silva")).toBeVisible();
    expect(screen.getByText("PRIORIDADE")).toBeVisible();
    expect(container.querySelector("[data-cm-motion='pulse']")).not.toBeNull();
    expect(container.querySelector("[data-cm-motion='fill']")).not.toBeNull();
    expect(container.querySelector(".setor-modern-card-motion")).not.toHaveAttribute(
      "data-entry",
    );
  });

  it("desenha a luz do Laser orbit e aplica a velocidade escolhida", () => {
    const { container } = render(
      <ModernQueueCard
        item={{ ...item, isNew: false }}
        index={0}
        cardStyle={{
          models: {
            high: { effect: "v37", beamSpeed: 1.6 },
            medium: { effect: "" },
            normal: { effect: "" },
          },
          entryAnimation: "none",
        }}
      />,
    );
    const card = container.querySelector(".setor-modern-card");
    expect(card).toHaveAttribute("data-model", "v37");
    expect(card).toHaveStyle({ "--sm-beam-speed": "1.6" });
    expect(container.querySelector(".setor-modern-laser-orbit")).toBeNull();
  });
});
