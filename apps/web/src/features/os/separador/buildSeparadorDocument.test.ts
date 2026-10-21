import { describe, expect, it } from "vitest";

import { buildSeparadorDocument } from "./buildSeparadorDocument";
import { cadSequence } from "./format";

describe("buildSeparadorDocument", () => {
  const html = buildSeparadorDocument({
    osLabel: "2532/2026",
    cadNumbers: cadSequence(3),
    logoSrc: "logo.png",
    titulo: "Ata da sessão",
    solicitante: "Gabinete 12",
    produto: "Livro",
  });

  it("gera uma página por caderno com OS e CAD", () => {
    expect(html.match(/data-page="/g)).toHaveLength(3);
    expect(html).toContain('data-os>2532/2026<');
    expect(html).toContain('data-cad="01"');
    expect(html).toContain('data-cad="02"');
    expect(html).toContain('data-cad="03"');
  });

  it("inclui título, solicitante e produto abaixo da OS", () => {
    expect(html).toContain("data-titulo>Ata da sessão<");
    expect(html).toContain("data-solicitante>Gabinete 12<");
    expect(html).toContain("data-produto>Livro<");
  });

  it("mostra traço quando título, solicitante ou produto estão vazios", () => {
    const empty = buildSeparadorDocument({
      osLabel: "1/2026",
      cadNumbers: ["01"],
      logoSrc: "logo.png",
      titulo: "—",
      solicitante: "—",
      produto: "—",
    });
    expect(empty).toContain("data-titulo>—<");
    expect(empty).toContain("data-solicitante>—<");
    expect(empty).toContain("data-produto>—<");
  });

  it("declara papel 102x297 mm e deixa impressão/dobra/obs vazios", () => {
    expect(html).toContain("size: 102mm 297mm");
    expect(html).toContain("IMPRESSÃO");
    expect(html).toContain("DOBRA");
    expect(html).toContain("OBS:");
    expect(html).not.toContain("data-impressor");
  });
});
