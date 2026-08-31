import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import type { AcabamentoCatalogItem, PapelLombadaItem } from "@/api/auxLookups";
import { queryKeys } from "@/api/query-keys";
import { AcabamentoField } from "./AcabamentoField";
import type { TechSpec } from "../techSpec";

const catalog: AcabamentoCatalogItem[] = [
  { id: 1, label: "Grampo", variacoes: [] },
  {
    id: 2,
    label: "Laminação",
    variacoes: [
      { id: 21, label: "Fosca" },
      { id: 22, label: "Brilho" },
    ],
  },
];

describe("AcabamentoField", () => {
  it("mostra o texto das seleções no campo compacto", () => {
    render(
      <AcabamentoField
        catalog={catalog}
        selected={[
          { catalog_id: 1, label: "Grampo" },
          {
            catalog_id: 2,
            label: "Laminação",
            variacao_id: 21,
            variacao_label: "Fosca",
          },
        ]}
        readOnly={false}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Acabamento específico")).toHaveValue(
      "Grampo, Laminação Fosca",
    );
    expect(screen.getByLabelText("Acabamento específico")).toHaveAttribute(
      "aria-haspopup",
      "dialog",
    );
    expect(
      screen.queryByRole("button", { name: "Alterar" }),
    ).not.toBeInTheDocument();
  });

  it("abre o seletor ao clicar no campo e não abre em somente leitura", () => {
    const { rerender } = render(
      <AcabamentoField
        catalog={catalog}
        selected={[]}
        readOnly={false}
        onChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("Acabamento específico"));
    expect(
      screen.getByRole("dialog", { name: "Incluir acabamentos" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    rerender(
      <AcabamentoField
        catalog={catalog}
        selected={[]}
        readOnly
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Acabamento específico"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("abre o modal, seleciona variação e aplica o texto no campo", () => {
    const onChange = vi.fn();
    render(
      <AcabamentoField
        catalog={catalog}
        selected={[]}
        readOnly={false}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByLabelText("Acabamento específico"));
    const dialog = screen.getByRole("dialog", { name: "Incluir acabamentos" });

    fireEvent.click(within(dialog).getByRole("button", { name: /Laminação/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Fosca/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Aplicar" }));

    expect(onChange).toHaveBeenCalledWith([
      {
        catalog_id: 2,
        label: "Laminação",
        variacao_id: 21,
        variacao_label: "Fosca",
      },
    ]);
  });

  it("cancela sem persistir a seleção", () => {
    const onChange = vi.fn();
    render(
      <AcabamentoField
        catalog={catalog}
        selected={[]}
        readOnly={false}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByLabelText("Acabamento específico"));
    fireEvent.click(screen.getByRole("button", { name: /Grampo/ }));
    fireEvent.click(screen.getByRole("button", { name: "Incluir na OS" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Escape fecha o seletor sem persistir", () => {
    const onChange = vi.fn();
    render(
      <AcabamentoField
        catalog={catalog}
        selected={[]}
        readOnly={false}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByLabelText("Acabamento específico"));
    expect(
      screen.getByRole("dialog", { name: "Incluir acabamentos" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("grava a obs da variação ao aplicar", () => {
    const onChange = vi.fn();
    render(
      <AcabamentoField
        catalog={catalog}
        selected={[]}
        readOnly={false}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByLabelText("Acabamento específico"));
    const dialog = screen.getByRole("dialog", { name: "Incluir acabamentos" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Laminação/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Fosca/ }));
    fireEvent.change(within(dialog).getByLabelText("Obs Fosca"), {
      target: { value: "só na capa" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Aplicar" }));

    expect(onChange).toHaveBeenCalledWith([
      {
        catalog_id: 2,
        label: "Laminação",
        variacao_id: 21,
        variacao_label: "Fosca",
        obs: "só na capa",
      },
    ]);
  });

  it("campo Acabamentos multilinha usa textarea com quebras de linha", () => {
    render(
      <AcabamentoField
        catalog={catalog}
        selected={[]}
        label="Acabamentos"
        multiline
        displayValue={"Capa:\n  Grampo"}
        readOnly={false}
        onChange={vi.fn()}
      />,
    );
    const field = screen.getByLabelText("Acabamentos");
    expect(field.tagName).toBe("TEXTAREA");
    expect(field).toHaveValue("Capa:\n  Grampo");
  });

  it("mostra a calculadora de lombada preenchida com os componentes", () => {
    const catalogWithLombada: AcabamentoCatalogItem[] = [
      ...catalog,
      { id: 9, label: "Lombada", variacoes: [] },
    ];
    const papeis: PapelLombadaItem[] = [
      { codPapel: 1, papel: "ap 75gr AA", espessura: 80 },
      { codPapel: 23, papel: "Couché Fosco 250gr", espessura: 220 },
    ];
    const spec: TechSpec = {
      version: 1,
      componentes: [
        {
          nome: "Capa",
          tipo: "CAPA",
          lotes: [
            {
              id: "c",
              paginas: 4,
              maquina_link: "",
              papel_link: "Couché Fosco 250g",
              cores_link: "4x4",
              papel_desc: "",
              cores_desc: "",
              frente_verso: false,
              acabamentos: [],
            },
          ],
        },
        {
          nome: "Miolo",
          tipo: "MIOLO",
          lotes: [
            {
              id: "m",
              paginas: 200,
              maquina_link: "",
              papel_link: "ap 75gr AA",
              cores_link: "P/B",
              papel_desc: "",
              cores_desc: "",
              frente_verso: false,
              acabamentos: [],
            },
          ],
        },
      ],
    };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(queryKeys.aux.papeisLombada, papeis);

    render(
      <QueryClientProvider client={client}>
        <AcabamentoField
          catalog={catalogWithLombada}
          selected={[]}
          readOnly={false}
          onChange={vi.fn()}
          techSpec={spec}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByLabelText("Acabamento específico"));
    const dialog = screen.getByRole("dialog", { name: "Incluir acabamentos" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Lombada/ }));

    expect(within(dialog).getByText("Calculadora de lombada")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Páginas do miolo")).toHaveValue(200);
    expect(within(dialog).getByLabelText("Papel da capa")).toHaveValue("c:23");
    expect(within(dialog).getByLabelText("Papel do miolo")).toHaveValue("c:1");
    expect(within(dialog).getByText("9,94 mm")).toBeInTheDocument();
    expect(within(dialog).getByText("10 mm")).toBeInTheDocument();
  });
});
