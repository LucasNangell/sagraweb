import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PapelariaRedesPicker, redesIniciais, redesParaDados, type RedeEscolha } from "./PapelariaRedesPicker";

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
    expect(onChange.mock.calls[0][0].map((r: RedeEscolha) => r.chave)).toEqual(["whatsapp", "instagram", "x"]);
  });
});
