import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  lembrarRedes,
  PapelariaRedesPicker,
  redesIniciais,
  redesParaBloco,
  redesParaDados,
  type RedeEscolha,
} from "./PapelariaRedesPicker";

const bloco = {
  max: 2,
  redes: [
    { chave: "instagram", nome: "Instagram", exemplo: "@usuario", logo_url: "/papelaria/redes/instagram/logo.png" },
    { chave: "whatsapp", nome: "WhatsApp", exemplo: "+55 61 9…", logo_url: null },
    { chave: "x", nome: "X", exemplo: "@usuario", logo_url: null },
  ],
};

describe("PapelariaRedesPicker", () => {
  it("monta os dados só com as redes marcadas e preenchidas, na ordem", () => {
    const escolha: RedeEscolha[] = [
      { chave: "x", valor: "@ana", ativo: true },
      { chave: "instagram", valor: "  ", ativo: true },
      { chave: "whatsapp", valor: "+55", ativo: false },
    ];
    expect(JSON.parse(redesParaDados(escolha))).toEqual([{ chave: "x", valor: "@ana" }]);
    expect(redesIniciais(bloco).every((r) => !r.ativo)).toBe(true);
  });

  it("respeita o máximo do modelo e reordena", () => {
    const onChange = vi.fn();
    const value: RedeEscolha[] = [
      { chave: "instagram", valor: "@a", ativo: true },
      { chave: "whatsapp", valor: "1", ativo: true },
      { chave: "x", valor: "", ativo: false },
    ];
    render(<PapelariaRedesPicker bloco={bloco} value={value} onChange={onChange} />);
    expect(screen.getByText("2 de até 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Incluir X")).toBeDisabled();
    expect(screen.getByLabelText("Perfil no X")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Descer Instagram"));
    expect(onChange.mock.calls[0]![0].map((r: RedeEscolha) => r.chave)).toEqual(["whatsapp", "instagram", "x"]);
  });
});


describe("PapelariaRedesPicker · estilo dos logos", () => {
  const comEstilos = {
    max: 3,
    estilo_padrao: "quadrado_policromia" as const,
    estilos: [
      { id: "quadrado_policromia" as const, rotulo: "Quadrado policromia" },
      { id: "pb" as const, rotulo: "PB" },
    ],
    redes: [
      { chave: "instagram", nome: "Instagram", exemplo: "@u", logo_url: null, logos_url: { quadrado_policromia: "/a.png", pb: "/b.png" } },
      { chave: "linkedin", nome: "LinkedIn", exemplo: "@u", logo_url: null, logos_url: { quadrado_policromia: "/c.png" } },
    ],
  };

  it("troca o estilo de todas as redes e tira a que não tem logo nele", () => {
    const onChange = vi.fn();
    const onEstiloChange = vi.fn();
    const value: RedeEscolha[] = [
      { chave: "instagram", valor: "@a", ativo: true },
      { chave: "linkedin", valor: "in/a", ativo: true },
    ];
    const { rerender } = render(
      <PapelariaRedesPicker bloco={comEstilos} value={value} onChange={onChange} estilo="quadrado_policromia" onEstiloChange={onEstiloChange} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "PB" }));
    expect(onEstiloChange).toHaveBeenCalledWith("pb");
    expect(onChange.mock.calls[0]![0]).toEqual([
      { chave: "instagram", valor: "@a", ativo: true },
      { chave: "linkedin", valor: "in/a", ativo: false },
    ]);
    rerender(
      <PapelariaRedesPicker bloco={comEstilos} value={onChange.mock.calls[0]![0]} onChange={onChange} estilo="pb" onEstiloChange={onEstiloChange} />,
    );
    expect(screen.getByLabelText("Incluir LinkedIn")).toBeDisabled();
    expect(screen.getByLabelText("Perfil no LinkedIn")).toHaveAttribute("placeholder", "Sem logo neste estilo");
  });
});


describe("redes preenchidas ao trocar de modelo", () => {
  const blocoA = {
    max: 3,
    redes: [
      { chave: "instagram", nome: "Instagram", exemplo: "", logo_url: null },
      { chave: "whatsapp", nome: "WhatsApp", exemplo: "", logo_url: null },
      { chave: "x", nome: "X", exemplo: "", logo_url: null },
    ],
  };
  const blocoB = {
    max: 3,
    redes: [
      { chave: "x", nome: "X", exemplo: "", logo_url: null },
      { chave: "instagram", nome: "Instagram", exemplo: "", logo_url: null },
      { chave: "youtube", nome: "YouTube", exemplo: "", logo_url: null },
    ],
  };

  it("mantém perfis, marcações e ordem; redes novas entram desmarcadas", () => {
    const escolhaA: RedeEscolha[] = [
      { chave: "whatsapp", valor: "+55 61 9", ativo: true },
      { chave: "instagram", valor: "@ana", ativo: true },
      { chave: "x", valor: "", ativo: false },
    ];
    const memoria = lembrarRedes([], escolhaA);
    expect(redesParaBloco(blocoB, memoria)).toEqual([
      { chave: "instagram", valor: "@ana", ativo: true },
      { chave: "x", valor: "", ativo: false },
      { chave: "youtube", valor: "", ativo: false },
    ]);
  });

  it("guarda redes que o novo modelo não aceita para quando voltar", () => {
    const escolhaA: RedeEscolha[] = [{ chave: "whatsapp", valor: "+55", ativo: true }, ...redesIniciais(blocoA).slice(0, 1)];
    let memoria = lembrarRedes([], escolhaA);
    const escolhaB = redesParaBloco(blocoB, memoria).map((r) => (r.chave === "youtube" ? { ...r, valor: "yt/ana", ativo: true } : r));
    memoria = lembrarRedes(memoria, escolhaB);
    const deVoltaA = redesParaBloco(blocoA, memoria);
    expect(deVoltaA.find((r) => r.chave === "whatsapp")).toEqual({ chave: "whatsapp", valor: "+55", ativo: true });
    expect(redesParaBloco(blocoB, memoria).find((r) => r.chave === "youtube")?.valor).toBe("yt/ana");
  });
});
